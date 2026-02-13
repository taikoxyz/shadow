#!/usr/bin/env node
/**
 * DO NOT RUN IN CI.
 *
 * Helper script that downloads a block header + account proof from an Ethereum
 * JSON-RPC endpoint and writes them into fixtures plus test inputs.
 */
import { writeFileSync, mkdirSync } from "fs";
import path from "path";
import process from "process";

const RPC_URL = process.env.ETH_RPC_URL;
if (!RPC_URL) {
  throw new Error("ETH_RPC_URL must be provided");
}

const NETWORK = process.env.NETWORK || "mainnet";
const BLOCK_NUMBER = process.env.BLOCK_NUMBER || "latest";
const ACCOUNT_ADDRESS = process.env.ACCOUNT_ADDRESS?.toLowerCase();
const OUTPUT_DIR =
  process.env.OUTPUT_DIR || path.join(process.cwd(), "fixtures", NETWORK);
const INPUTS_DIR = path.join(process.cwd(), "inputs");
const GENERATE_TEST_INPUTS = process.env.GENERATE_TEST_INPUTS !== "0";

async function rpc(method, params) {
  const res = await fetch(RPC_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  if (!res.ok) {
    throw new Error(`RPC ${method} failed with status ${res.status}`);
  }
  const json = await res.json();
  if (!json.result) {
    throw new Error(`RPC ${method} error: ${json.error?.message || "unknown"}`);
  }
  return json.result;
}

async function sha3(hex) {
  return rpc("web3_sha3", [hex]);
}

function hexToBytes(hex) {
  const cleanHex = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (cleanHex.length % 2 !== 0) {
    throw new Error(`Invalid hex string length: ${hex}`);
  }
  const bytes = new Uint8Array(cleanHex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(cleanHex.substr(i * 2, 2), 16);
  }
  return bytes;
}

function bytesToHex(bytes) {
  return (
    "0x" +
    Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")
  );
}

function normalizeHex(value) {
  if (!value) return "0x";
  const prefixed = value.startsWith("0x") ? value.slice(2) : value;
  if (prefixed.length === 0) return "0x";
  return prefixed.length % 2 === 0 ? `0x${prefixed}` : `0x0${prefixed}`;
}

function hexBytes(value) {
  return hexToBytes(normalizeHex(value));
}

function bigIntToBytes(value) {
  if (value === 0n) return new Uint8Array();
  let hex = value.toString(16);
  if (hex.length % 2 !== 0) hex = `0${hex}`;
  return hexToBytes(`0x${hex}`);
}

function encodeBytes(data) {
  if (data.length === 1 && data[0] < 0x80) {
    return data;
  }
  if (data.length < 56) {
    return concat(Uint8Array.of(0x80 + data.length), data);
  }
  const lenBytes = bigIntToBytes(BigInt(data.length));
  return concat(Uint8Array.of(0xb7 + lenBytes.length), lenBytes, data);
}

function encode(value) {
  if (value instanceof Uint8Array) {
    return encodeBytes(value);
  }
  if (typeof value === "bigint") {
    return encodeBytes(bigIntToBytes(value));
  }
  return encodeList(value);
}

function encodeList(values) {
  const encodedItems = values.map((v) => encode(v));
  const payload = concat(...encodedItems);
  if (payload.length < 56) {
    return concat(Uint8Array.of(0xc0 + payload.length), payload);
  }
  const lenBytes = bigIntToBytes(BigInt(payload.length));
  return concat(Uint8Array.of(0xf7 + lenBytes.length), lenBytes, payload);
}

function concat(...arrays) {
  const total = arrays.reduce((sum, arr) => sum + arr.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const arr of arrays) {
    result.set(arr, offset);
    offset += arr.length;
  }
  return result;
}

function encodeBlockHeader(block) {
  const baseFields = [
    hexBytes(block.parentHash),
    hexBytes(block.sha3Uncles),
    hexBytes(block.miner),
    hexBytes(block.stateRoot),
    hexBytes(block.transactionsRoot),
    hexBytes(block.receiptsRoot),
    hexBytes(block.logsBloom),
    BigInt(block.difficulty),
    BigInt(block.number),
    BigInt(block.gasLimit),
    BigInt(block.gasUsed),
    BigInt(block.timestamp),
    hexBytes(block.extraData),
    hexBytes(block.mixHash),
    hexBytes(block.nonce),
  ];

  const optionalFields = [];
  if (block.baseFeePerGas != null) optionalFields.push(BigInt(block.baseFeePerGas));
  if (block.withdrawalsRoot != null) optionalFields.push(hexBytes(block.withdrawalsRoot));
  if (block.blobGasUsed != null) optionalFields.push(BigInt(block.blobGasUsed));
  if (block.excessBlobGas != null) optionalFields.push(BigInt(block.excessBlobGas));
  if (block.parentBeaconBlockRoot != null) optionalFields.push(hexBytes(block.parentBeaconBlockRoot));

  return encodeList([...baseFields, ...optionalFields]);
}

function encodeAccountRlp(nonceHex, balanceHex, storageHex, codeHex) {
  return encodeList([
    BigInt(nonceHex),
    BigInt(balanceHex),
    hexToBytes(storageHex),
    hexToBytes(codeHex),
  ]);
}

async function main() {
  console.log(`Fetching block ${BLOCK_NUMBER} ...`);
  const block = await rpc("eth_getBlockByNumber", [BLOCK_NUMBER, false]);
  const resolvedBlockNumber = block.number;
  const resolvedAccount = (ACCOUNT_ADDRESS || block.miner).toLowerCase();

  const headerRlpBytes = encodeBlockHeader(block);
  const headerRlp = bytesToHex(headerRlpBytes);

  console.log(`Fetching proof for ${resolvedAccount} ...`);
  const proofResponse = await rpc("eth_getProof", [resolvedAccount, [], resolvedBlockNumber]);

  console.log("Computing keccak hashes via web3_sha3 ...");
  const addressHashHex = await sha3(resolvedAccount);
  const proofNodeHashes = await Promise.all(proofResponse.accountProof.map((node) => sha3(node)));

  mkdirSync(OUTPUT_DIR, { recursive: true });

  const blockNumberDec = Number.parseInt(resolvedBlockNumber, 16);
  const blockFixturePath = path.join(OUTPUT_DIR, `block-${blockNumberDec}.json`);
  const blockFixture = {
    network: NETWORK,
    blockNumber: blockNumberDec,
    blockHash: block.hash,
    header: block,
    headerRlp,
    generated: new Date().toISOString(),
  };
  writeFileSync(blockFixturePath, JSON.stringify(blockFixture, null, 2));
  console.log(`Wrote ${blockFixturePath}`);

  const accountSuffix = resolvedAccount.slice(2, 10);
  const accountFixturePath = path.join(OUTPUT_DIR, `account-${accountSuffix}.json`);
  const accountFixture = {
    network: NETWORK,
    blockNumber: blockNumberDec,
    address: resolvedAccount,
    proof: proofResponse,
    computed: {
      addressHash: addressHashHex,
      proofNodeHashes,
    },
  };
  writeFileSync(accountFixturePath, JSON.stringify(accountFixture, null, 2));
  console.log(`Wrote ${accountFixturePath}`);

  if (!GENERATE_TEST_INPUTS) return;

  const headerBytes = hexToBytes(headerRlp);
  const accountRlp = encodeAccountRlp(
    proofResponse.nonce,
    proofResponse.balance,
    proofResponse.storageHash,
    proofResponse.codeHash
  );

  const rlpInputDir = path.join(INPUTS_DIR, "rlp_test");
  mkdirSync(rlpInputDir, { recursive: true });
  const rlpHeaderPath = path.join(rlpInputDir, "block_header.json");
  const rlpHeaderFixture = {
    header: Array.from(headerBytes),
    headerLength: headerBytes.length,
    expectedStateRoot: block.stateRoot,
    expectedBlockNumber: resolvedBlockNumber,
  };
  writeFileSync(rlpHeaderPath, JSON.stringify(rlpHeaderFixture, null, 2));
  console.log(`Wrote ${rlpHeaderPath}`);

  const rlpAccountPath = path.join(rlpInputDir, "account.json");
  const rlpAccountFixture = {
    account: Array.from(accountRlp),
    accountLength: accountRlp.length,
    expectedNonce: proofResponse.nonce,
    expectedBalance: proofResponse.balance,
    expectedStorageRoot: proofResponse.storageHash,
    expectedCodeHash: proofResponse.codeHash,
  };
  writeFileSync(rlpAccountPath, JSON.stringify(rlpAccountFixture, null, 2));
  console.log(`Wrote ${rlpAccountPath}`);

  const mptInputDir = path.join(INPUTS_DIR, "mpt_test");
  mkdirSync(mptInputDir, { recursive: true });

  const proofNodes = proofResponse.accountProof.map((node) => hexToBytes(node));
  const proofNodeLengths = proofNodes.map((node) => node.length);
  const maxNodeBytes = Math.max(...proofNodeLengths);
  const paddedLayers = proofNodes.map((node) => {
    const padded = new Array(maxNodeBytes).fill(0);
    for (let i = 0; i < node.length; i++) padded[i] = node[i];
    return padded;
  });

  const mptValidPath = path.join(mptInputDir, "valid_proof.json");
  const mptValidFixture = {
    stateRoot: Array.from(hexToBytes(block.stateRoot)),
    layers: paddedLayers,
    layerLengths: proofNodeLengths,
    numLayers: proofNodes.length,
    addressHash: Array.from(hexToBytes(addressHashHex)),
    expectedNonce: proofResponse.nonce,
    expectedBalance: proofResponse.balance,
    expectedStorageRoot: proofResponse.storageHash,
    expectedCodeHash: proofResponse.codeHash,
  };
  writeFileSync(mptValidPath, JSON.stringify(mptValidFixture, null, 2));
  console.log(`Wrote ${mptValidPath}`);

  const invalidStateRoot = Array.from(hexToBytes(block.stateRoot));
  invalidStateRoot[0] = (invalidStateRoot[0] + 1) % 256;
  const mptInvalidPath = path.join(mptInputDir, "invalid_root.json");
  const mptInvalidFixture = {
    ...mptValidFixture,
    stateRoot: invalidStateRoot,
  };
  writeFileSync(mptInvalidPath, JSON.stringify(mptInvalidFixture, null, 2));
  console.log(`Wrote ${mptInvalidPath}`);
}

main().catch((err) => {
  console.error("Fixture generation failed:", err);
  process.exit(1);
});
