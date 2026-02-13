#!/usr/bin/env ts-node
/**
 * DO NOT RUN IN CI.
 *
 * Helper script that downloads a block header + account proof from an Ethereum
 * JSON-RPC endpoint and writes them into fixtures plus test inputs.
 */
import { writeFileSync, mkdirSync } from "fs";
import path from "path";
import process from "process";
import { encodeBlockHeader, BlockHeaderData } from "../src/block-header";
import { parseAccountProof, EthGetProofResponse } from "../src/eth-proof";
import { bytesToHex, hexToBytes } from "../src/utils";

interface EthBlockResponse {
  hash: string;
  parentHash: string;
  sha3Uncles: string;
  miner: string;
  stateRoot: string;
  transactionsRoot: string;
  receiptsRoot: string;
  logsBloom: string;
  difficulty: string;
  number: string;
  gasLimit: string;
  gasUsed: string;
  timestamp: string;
  extraData: string;
  mixHash: string;
  nonce: string;
  baseFeePerGas?: string;
  withdrawalsRoot?: string;
  blobGasUsed?: string;
  excessBlobGas?: string;
  parentBeaconBlockRoot?: string;
}

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

async function rpc<T>(method: string, params: unknown[]): Promise<T> {
  const res = await fetch(RPC_URL!, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  if (!res.ok) {
    throw new Error(`RPC ${method} failed with status ${res.status}`);
  }
  const json = (await res.json()) as { result?: T; error?: { message: string } };
  if (!json.result) {
    throw new Error(`RPC ${method} error: ${json.error?.message || "unknown"}`);
  }
  return json.result;
}

async function main() {
  console.log(`Fetching block ${BLOCK_NUMBER} ...`);
  const block = await rpc<EthBlockResponse>("eth_getBlockByNumber", [BLOCK_NUMBER, false]);
  const resolvedBlockNumber = block.number;
  const resolvedAccount = (ACCOUNT_ADDRESS || block.miner).toLowerCase();

  const headerData: BlockHeaderData = {
    parentHash: block.parentHash,
    sha3Uncles: block.sha3Uncles,
    miner: block.miner,
    stateRoot: block.stateRoot,
    transactionsRoot: block.transactionsRoot,
    receiptsRoot: block.receiptsRoot,
    logsBloom: block.logsBloom,
    difficulty: block.difficulty,
    number: block.number,
    gasLimit: block.gasLimit,
    gasUsed: block.gasUsed,
    timestamp: block.timestamp,
    extraData: block.extraData,
    mixHash: block.mixHash,
    nonce: block.nonce,
    baseFeePerGas: block.baseFeePerGas,
    withdrawalsRoot: block.withdrawalsRoot,
    blobGasUsed: block.blobGasUsed,
    excessBlobGas: block.excessBlobGas,
    parentBeaconBlockRoot: block.parentBeaconBlockRoot,
  };
  const headerRlp = bytesToHex(encodeBlockHeader(headerData));

  console.log(`Fetching proof for ${resolvedAccount} ...`);
  const proofResponse = await rpc<EthGetProofResponse>("eth_getProof", [
    resolvedAccount,
    [],
    resolvedBlockNumber,
  ]);
  const parsedProof = parseAccountProof(proofResponse);

  mkdirSync(OUTPUT_DIR, { recursive: true });

  const blockNumberDec = Number.parseInt(resolvedBlockNumber, 16);
  const blockFixturePath = path.join(OUTPUT_DIR, `block-${blockNumberDec}.json`);
  const blockFixture = {
    network: NETWORK,
    blockNumber: blockNumberDec,
    blockHash: block.hash,
    header: headerData,
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
      addressHash: bytesToHex(parsedProof.addressHash),
      proofNodeHashes: parsedProof.proofNodeHashes.map((node) => bytesToHex(node)),
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

  const maxNodeBytes = Math.max(...parsedProof.proofNodes.map((node) => node.length));
  const paddedLayers = parsedProof.proofNodes.map((node) => {
    const padded = new Array(maxNodeBytes).fill(0);
    for (let i = 0; i < node.length; i++) padded[i] = node[i];
    return padded;
  });

  const mptValidPath = path.join(mptInputDir, "valid_proof.json");
  const mptValidFixture = {
    stateRoot: Array.from(hexToBytes(block.stateRoot)),
    layers: paddedLayers,
    layerLengths: parsedProof.proofNodeLengths,
    numLayers: parsedProof.proofNodes.length,
    addressHash: Array.from(parsedProof.addressHash),
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

type RlpValue = Uint8Array | bigint | RlpValue[];

function encodeAccountRlp(nonceHex: string, balanceHex: string, storageHex: string, codeHex: string): Uint8Array {
  return encodeList([
    BigInt(nonceHex),
    BigInt(balanceHex),
    hexToBytes(storageHex),
    hexToBytes(codeHex),
  ]);
}

function encode(value: RlpValue): Uint8Array {
  if (value instanceof Uint8Array) {
    return encodeBytes(value);
  }
  if (typeof value === "bigint") {
    return encodeBytes(bigIntToBytes(value));
  }
  return encodeList(value);
}

function encodeBytes(data: Uint8Array): Uint8Array {
  if (data.length === 1 && data[0] < 0x80) {
    return data;
  }
  if (data.length < 56) {
    return concat(Uint8Array.of(0x80 + data.length), data);
  }
  const lenBytes = bigIntToBytes(BigInt(data.length));
  return concat(Uint8Array.of(0xb7 + lenBytes.length), lenBytes, data);
}

function encodeList(values: RlpValue[]): Uint8Array {
  const encodedItems = values.map((v) => encode(v));
  const payload = concat(...encodedItems);
  if (payload.length < 56) {
    return concat(Uint8Array.of(0xc0 + payload.length), payload);
  }
  const lenBytes = bigIntToBytes(BigInt(payload.length));
  return concat(Uint8Array.of(0xf7 + lenBytes.length), lenBytes, payload);
}

function bigIntToBytes(value: bigint): Uint8Array {
  if (value === 0n) return new Uint8Array();
  let hex = value.toString(16);
  if (hex.length % 2 !== 0) hex = `0${hex}`;
  return hexToBytes(`0x${hex}`);
}

function concat(...arrays: Uint8Array[]): Uint8Array {
  const total = arrays.reduce((sum, arr) => sum + arr.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const arr of arrays) {
    result.set(arr, offset);
    offset += arr.length;
  }
  return result;
}
