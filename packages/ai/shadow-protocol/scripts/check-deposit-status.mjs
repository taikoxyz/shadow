#!/usr/bin/env node
/**
 * check-deposit-status.mjs
 *
 * Reads a deposit file and checks:
 * 1. Target address balance on L1
 * 2. Whether each note's nullifier is consumed on L2
 *
 * Usage:
 *   node scripts/check-deposit-status.mjs \
 *     --deposit <path/to/deposit.json> \
 *     [--l1-rpc <url>] \
 *     [--l2-rpc <url>] \
 *     [--shadow <contract_address>]
 */

import { createHash } from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DEFAULT_L1_RPC = {
  167013: "https://hoodi.ethpandaops.io",
  167000: "https://rpc.mainnet.taiko.xyz",
};
const DEFAULT_L2_RPC = {
  167013: "https://rpc.hoodi.taiko.xyz",
  167000: "https://rpc.taiko.xyz",
};
const DEFAULT_SHADOW = {
  167013: "0xCd45084D91bC488239184EEF39dd20bCb710e7C2",
};

const MAGIC = {
  RECIPIENT: "shadow.recipient.v1",
  ADDRESS: "shadow.address.v1",
  NULLIFIER: "shadow.nullifier.v1",
};
const MAX_NOTES = 5;

function padMagicLabel(label) {
  const raw = new TextEncoder().encode(label);
  const out = new Uint8Array(32);
  out.set(raw.slice(0, 32));
  return out;
}

function hexToBytes(hex) {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function bytesToHex(bytes) {
  return `0x${Buffer.from(bytes).toString("hex")}`;
}

function sha256(bytes) {
  const h = createHash("sha256");
  h.update(bytes);
  return new Uint8Array(h.digest());
}

function bigintToBytes32(v) {
  return hexToBytes(`0x${v.toString(16).padStart(64, "0")}`);
}

function concatBytes(...arrays) {
  const total = arrays.reduce((acc, x) => acc + x.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const arr of arrays) {
    out.set(arr, offset);
    offset += arr.length;
  }
  return out;
}

function computeRecipientHash(recipientBytes20) {
  const magic = padMagicLabel(MAGIC.RECIPIENT);
  const padded = new Uint8Array(32);
  padded.set(recipientBytes20, 12);
  return sha256(concatBytes(magic, padded));
}

function computeNotesHash(amounts, recipientHashes) {
  const buf = new Uint8Array(MAX_NOTES * 64);
  for (let i = 0; i < amounts.length; i++) {
    buf.set(bigintToBytes32(amounts[i]), i * 64);
    buf.set(recipientHashes[i], i * 64 + 32);
  }
  return sha256(buf);
}

function deriveTargetAddress(secretBytes32, chainId, notesHash) {
  const payload = concatBytes(
    padMagicLabel(MAGIC.ADDRESS),
    bigintToBytes32(chainId),
    secretBytes32,
    notesHash
  );
  return sha256(payload).slice(12);
}

function deriveNullifier(secretBytes32, chainId, noteIndex) {
  const payload = concatBytes(
    padMagicLabel(MAGIC.NULLIFIER),
    bigintToBytes32(chainId),
    secretBytes32,
    bigintToBytes32(BigInt(noteIndex))
  );
  return sha256(payload);
}

async function rpcCall(url, method, params) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  if (!res.ok) throw new Error(`RPC ${method} HTTP ${res.status}`);
  const body = await res.json();
  if (body.error) throw new Error(`RPC ${method}: ${body.error.message}`);
  return body.result;
}

function parseArg(argv, flag) {
  const idx = argv.indexOf(flag);
  return idx !== -1 && argv[idx + 1] ? argv[idx + 1] : null;
}

async function main() {
  const argv = process.argv.slice(2);
  const depositPath = parseArg(argv, "--deposit");
  if (!depositPath) {
    console.error("Usage: check-deposit-status.mjs --deposit <file.json> [--l1-rpc <url>] [--l2-rpc <url>] [--shadow <addr>]");
    process.exit(1);
  }

  const deposit = JSON.parse(fs.readFileSync(depositPath, "utf8"));
  const chainId = BigInt(deposit.chainId);
  const l1Rpc = parseArg(argv, "--l1-rpc") || DEFAULT_L1_RPC[Number(chainId)];
  const l2Rpc = parseArg(argv, "--l2-rpc") || DEFAULT_L2_RPC[Number(chainId)];
  const shadowAddr = parseArg(argv, "--shadow") || DEFAULT_SHADOW[Number(chainId)];

  if (!l1Rpc) throw new Error(`No default L1 RPC for chainId ${chainId}`);
  if (!l2Rpc) throw new Error(`No default L2 RPC for chainId ${chainId}`);

  const secretBytes = hexToBytes(deposit.secret);
  const amounts = deposit.notes.map((n) => BigInt(n.amount));
  const recipientHashes = deposit.notes.map((n) =>
    computeRecipientHash(hexToBytes(n.recipient))
  );
  const notesHash = computeNotesHash(amounts, recipientHashes);
  const targetAddress = bytesToHex(deriveTargetAddress(secretBytes, chainId, notesHash));

  console.log("=== Deposit Status ===");
  console.log("Chain ID:      ", deposit.chainId);
  console.log("Notes:         ", deposit.notes.length);
  console.log("Target address:", targetAddress);

  // Check L1 balance
  if (l1Rpc) {
    try {
      const balanceHex = await rpcCall(l1Rpc, "eth_getBalance", [targetAddress, "latest"]);
      const balance = BigInt(balanceHex);
      const totalRequired = amounts.reduce((a, b) => a + b, 0n);
      const funded = balance >= totalRequired;
      console.log("\n--- L1 Balance ---");
      console.log("Balance (wei):  ", balance.toString());
      console.log("Required (wei): ", totalRequired.toString());
      console.log("Funded:         ", funded ? "YES" : "NO (insufficient)");
    } catch (err) {
      console.warn("L1 balance check failed:", err.message);
    }
  }

  // Check L2 nullifiers
  if (l2Rpc && shadowAddr) {
    console.log("\n--- Note Claim Status (L2) ---");
    for (let i = 0; i < deposit.notes.length; i++) {
      const nullifier = bytesToHex(deriveNullifier(secretBytes, chainId, i));
      let consumed = "unknown";
      try {
        // isConsumed(bytes32) -> bool: selector 0x5e0e5b3e
        const data = `0x5e0e5b3e${nullifier.slice(2).padStart(64, "0")}`;
        const result = await rpcCall(l2Rpc, "eth_call", [
          { to: shadowAddr, data },
          "latest",
        ]);
        consumed = BigInt(result) !== 0n ? "CLAIMED" : "unclaimed";
      } catch (err) {
        consumed = `error: ${err.message}`;
      }
      console.log(`  note[${i}] recipient=${deposit.notes[i].recipient} amount=${deposit.notes[i].amount} wei  status=${consumed}`);
    }
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
