#!/usr/bin/env node
/**
 * Generate a real Shadow claim input from live Ethereum RPC data.
 *
 * Required env:
 *   ETH_RPC_URL   JSON-RPC endpoint
 *   RECIPIENT     0x-prefixed 20-byte address
 *   NOTE_AMOUNTS  Comma-separated wei amounts (e.g. "1000000000000")
 *
 * Optional env:
 *   SECRET        0x-prefixed 32-byte hex secret (if omitted, a random secret is generated)
 *   NOTE_INDEX    Index of note to claim (default: 0)
 *   CHAIN_ID      Override chainId (otherwise fetched from RPC)
 *   BLOCK_NUMBER  Block tag/number (default: "latest")
 *   OUTPUT        Output JSON path (default: inputs/shadow/real.json)
 *   DRY_RUN       If "1", only prints derived target address and exits
 *   ALLOW_INSUFFICIENT_BALANCE  If "1", allow writing input even when balance < sum(amounts)
 */

import { createHash, randomBytes } from "crypto";
import fs from "fs";
import path from "path";
import process from "process";
import { keccak_256 } from "@noble/hashes/sha3";

const MAGIC = {
  RECIPIENT: "shadow.recipient.v1",
  ADDRESS: "shadow.address.v1",
};

const MAX_NOTES = 5;
const MAX_PROOF_DEPTH = 64;
const MAX_NODE_BYTES = 4096;

const RPC_URL = process.env.ETH_RPC_URL;
const RECIPIENT = process.env.RECIPIENT;
const NOTE_AMOUNTS = process.env.NOTE_AMOUNTS;
const NOTE_INDEX = Number(process.env.NOTE_INDEX || "0");
const CHAIN_ID_ENV = process.env.CHAIN_ID;
const BLOCK_NUMBER = process.env.BLOCK_NUMBER || "latest";
const OUTPUT = process.env.OUTPUT || path.join(process.cwd(), "inputs", "shadow", "real.json");
const DRY_RUN = process.env.DRY_RUN === "1";

if (!RECIPIENT || !NOTE_AMOUNTS) {
  console.error("Missing RECIPIENT or NOTE_AMOUNTS env vars.");
  process.exit(1);
}

function hexToBytes(hex) {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (clean.length % 2 !== 0) throw new Error(`Invalid hex length: ${hex}`);
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
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

function sha256(bytes) {
  const hash = createHash("sha256");
  hash.update(bytes);
  return new Uint8Array(hash.digest());
}

function keccak256(bytes) {
  return keccak_256(bytes);
}

function padMagicLabel(label) {
  const raw = new TextEncoder().encode(label);
  const padded = new Uint8Array(32);
  padded.set(raw.slice(0, 32));
  return padded;
}

function bigintToBytes32(value) {
  const hex = value.toString(16).padStart(64, "0");
  return hexToBytes(hex);
}

function computeRecipientHash(recipientHex) {
  const magic = padMagicLabel(MAGIC.RECIPIENT);
  const recipientBytes = hexToBytes(recipientHex);
  if (recipientBytes.length !== 20) throw new Error("recipient must be 20 bytes");

  const paddedRecipient = new Uint8Array(32);
  paddedRecipient.set(recipientBytes, 12);

  const input = new Uint8Array(64);
  input.set(magic, 0);
  input.set(paddedRecipient, 32);
  return sha256(input);
}

function computeNotesHash(notes) {
  const noteData = new Uint8Array(MAX_NOTES * 64);
  for (let i = 0; i < notes.length; i++) {
    noteData.set(bigintToBytes32(notes[i].amount), i * 64);
    noteData.set(notes[i].recipientHash, i * 64 + 32);
  }
  return sha256(noteData);
}

function deriveTargetAddress(secretBytes, chainId, notesHash) {
  const magic = padMagicLabel(MAGIC.ADDRESS);
  const input = new Uint8Array(128);
  input.set(magic, 0);
  input.set(bigintToBytes32(chainId), 32);
  input.set(secretBytes, 64);
  input.set(notesHash, 96);
  const hash = sha256(input);
  return hash.slice(12);
}

function computePowDigest(notesHash, secretBytes) {
  const input = new Uint8Array(64);
  input.set(notesHash, 0);
  input.set(secretBytes, 32);
  const digest = sha256(input);
  const valid = digest[29] === 0 && digest[30] === 0 && digest[31] === 0;
  return { digest, valid };
}

function bytesToDecStrings(bytes) {
  return Array.from(bytes).map((b) => b.toString());
}

function padArray(arr, length, fill) {
  const out = arr.slice();
  while (out.length < length) {
    out.push(typeof fill === "function" ? fill() : fill);
  }
  return out;
}

async function rpc(method, params) {
  if (!RPC_URL) throw new Error("ETH_RPC_URL must be provided");
  const res = await fetch(RPC_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  if (!res.ok) throw new Error(`RPC ${method} failed with status ${res.status}`);
  const json = await res.json();
  if (!json.result) throw new Error(`RPC ${method} error: ${json.error?.message || "unknown"}`);
  return json.result;
}

async function main() {
  const amounts = NOTE_AMOUNTS.split(",").map((v) => BigInt(v.trim()));
  const totalAmount = amounts.reduce((acc, v) => acc + v, 0n);
  if (amounts.length === 0 || amounts.length > MAX_NOTES) {
    throw new Error(`NOTE_AMOUNTS must have 1..${MAX_NOTES} values`);
  }
  if (NOTE_INDEX < 0 || NOTE_INDEX >= amounts.length) {
    throw new Error("NOTE_INDEX out of range for NOTE_AMOUNTS");
  }

  const recipientHash = computeRecipientHash(RECIPIENT);
  const notes = amounts.map((amount) => ({ amount, recipientHash }));
  const notesHash = computeNotesHash(notes);

  let secretBytes;
  if (process.env.SECRET) {
    secretBytes = hexToBytes(process.env.SECRET);
  } else {
    secretBytes = randomBytes(32);
    console.log("Generated random SECRET:", bytesToHex(secretBytes));
  }
  if (secretBytes.length !== 32) throw new Error("SECRET must be 32 bytes");

  const chainId = CHAIN_ID_ENV ? BigInt(CHAIN_ID_ENV) : BigInt(await rpc("eth_chainId", []));
  const targetAddress = deriveTargetAddress(secretBytes, chainId, notesHash);
  const targetAddressHex = bytesToHex(targetAddress);
  const addressHash = keccak256(targetAddress);
  const { digest: powDigest, valid: powValid } = computePowDigest(notesHash, secretBytes);

  console.log("Target address:", targetAddressHex);
  console.log("Address hash:", bytesToHex(addressHash));
  console.log("PoW digest valid:", powValid);

  if (DRY_RUN) return;

  const block = await rpc("eth_getBlockByNumber", [BLOCK_NUMBER, false]);
  const blockNumber = block.number;
  const stateRootBytes = hexToBytes(block.stateRoot);

  const proof = await rpc("eth_getProof", [targetAddressHex, [], blockNumber]);
  const accountBalance = BigInt(proof.balance);
  console.log("Account balance:", accountBalance.toString(), "wei");
  console.log("Required total:", totalAmount.toString(), "wei");
  if (accountBalance < totalAmount && process.env.ALLOW_INSUFFICIENT_BALANCE !== "1") {
    throw new Error(
      `target balance ${accountBalance} is below required total ${totalAmount}; fund target address first or set ALLOW_INSUFFICIENT_BALANCE=1`
    );
  }
  const proofNodes = proof.accountProof.map((node) => hexToBytes(node));
  if (proofNodes.length === 0) throw new Error("accountProof empty");
  if (proofNodes.length > MAX_PROOF_DEPTH) {
    throw new Error(`accountProof depth exceeds MAX_PROOF_DEPTH (${MAX_PROOF_DEPTH})`);
  }

  const paddedProofNodes = padArray(
    proofNodes.map((node) => {
      if (node.length > MAX_NODE_BYTES) {
        throw new Error(`proof node exceeds MAX_NODE_BYTES (${MAX_NODE_BYTES})`);
      }
      const padded = new Array(MAX_NODE_BYTES).fill("0");
      for (let i = 0; i < node.length; i++) padded[i] = node[i].toString();
      return padded;
    }),
    MAX_PROOF_DEPTH,
    () => new Array(MAX_NODE_BYTES).fill("0")
  );

  const paddedProofLengths = padArray(
    proofNodes.map((node) => node.length.toString()),
    MAX_PROOF_DEPTH,
    "0"
  );

  const paddedAmounts = padArray(amounts.map((a) => a.toString()), MAX_NOTES, "0");
  const paddedRecipientHashes = padArray(
    notes.map((n) => bytesToDecStrings(n.recipientHash)),
    MAX_NOTES,
    () => new Array(32).fill("0")
  );

  const input = {
    blockNumber: BigInt(blockNumber).toString(),
    stateRoot: bytesToDecStrings(stateRootBytes),
    chainId: chainId.toString(),
    noteIndex: NOTE_INDEX.toString(),
    amount: amounts[NOTE_INDEX].toString(),
    recipient: bytesToDecStrings(hexToBytes(RECIPIENT)),

    secret: bytesToDecStrings(secretBytes),
    noteCount: amounts.length.toString(),
    amounts: paddedAmounts,
    recipientHashes: paddedRecipientHashes,

    proofNodes: paddedProofNodes,
    proofNodeLengths: paddedProofLengths,
    proofDepth: proofNodes.length.toString(),
    accountBalance: accountBalance.toString(),
  };

  fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
  fs.writeFileSync(OUTPUT, JSON.stringify(input, null, 2));
  console.log("Wrote input:", OUTPUT);
}

main().catch((err) => {
  console.error("Failed to generate input:", err);
  process.exit(1);
});
