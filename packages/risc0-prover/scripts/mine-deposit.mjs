#!/usr/bin/env node

import { createHash, randomBytes } from "crypto";
import fs from "fs";
import path from "path";

const MAGIC = {
  RECIPIENT: "shadow.recipient.v1",
  ADDRESS: "shadow.address.v1",
  NULLIFIER: "shadow.nullifier.v1"
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
  if (clean.length % 2 !== 0) throw new Error(`invalid hex: ${hex}`);
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

function bigintToBytes32(value) {
  if (value < 0n) throw new Error("cannot encode negative bigint");
  let hex = value.toString(16);
  if (hex.length > 64) throw new Error("value too large for bytes32");
  hex = hex.padStart(64, "0");
  return hexToBytes(`0x${hex}`);
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
  if (recipientBytes20.length !== 20) throw new Error("recipient must be 20 bytes");
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
  const digest = sha256(payload);
  return digest.slice(12);
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

function parseArg(argv, name) {
  const idx = argv.indexOf(name);
  if (idx === -1) return null;
  return argv[idx + 1] || null;
}

function usage() {
  console.error(`Usage:
  node scripts/mine-deposit.mjs --out <path.json> --chain-id <167013> --recipient <0x...> --amount-wei <n> [--note-count 2] [--same-recipient]

Notes:
  - Generates a random secret and derives the target address.
  - Writes a v2 deposit JSON with targetAddress included.
`);
}

async function main() {
  const argv = process.argv.slice(2);
  const outPath = parseArg(argv, "--out");
  const chainIdRaw = parseArg(argv, "--chain-id");
  const recipientRaw = parseArg(argv, "--recipient");
  const amountRaw = parseArg(argv, "--amount-wei");
  const noteCountRaw = parseArg(argv, "--note-count") || "2";
  const sameRecipient = argv.includes("--same-recipient");

  if (!outPath || !chainIdRaw || !recipientRaw || !amountRaw) {
    usage();
    process.exit(1);
  }

  const chainId = BigInt(chainIdRaw);
  const noteCount = Number(noteCountRaw);
  if (!Number.isInteger(noteCount) || noteCount < 1 || noteCount > MAX_NOTES) {
    throw new Error(`noteCount must be 1..${MAX_NOTES}`);
  }

  const recipient = recipientRaw;
  const recipientBytes = hexToBytes(recipient);
  if (recipientBytes.length !== 20) throw new Error("recipient must be 20-byte address");

  const amountWei = BigInt(amountRaw);
  if (amountWei <= 0n) throw new Error("amount must be > 0");

  const notes = [];
  for (let i = 0; i < noteCount; i++) {
    notes.push({
      recipient,
      amount: amountWei.toString(),
      label: `note #${i}`
    });
  }

  const amounts = new Array(noteCount).fill(amountWei);
  const recipientHashes = [];
  for (let i = 0; i < noteCount; i++) {
    const r = sameRecipient ? recipientBytes : recipientBytes; // placeholder for future
    recipientHashes.push(computeRecipientHash(r));
  }

  const notesHash = computeNotesHash(amounts, recipientHashes);
  const secret = randomBytes(32);
  const target = deriveTargetAddress(secret, chainId, notesHash);
  const nullifiers = [];
  for (let i = 0; i < noteCount; i++) {
    nullifiers.push(bytesToHex(deriveNullifier(secret, chainId, i)));
  }

  const depositJson = {
    version: "v2",
    chainId: chainId.toString(),
    secret: bytesToHex(secret).toLowerCase(),
    notes,
    targetAddress: bytesToHex(target)
  };

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(depositJson, null, 2));

  console.log("Wrote deposit:", path.resolve(outPath));
  console.log("noteCount:", noteCount);
  console.log("targetAddress:", depositJson.targetAddress);
  console.log("nullifier[0]:", nullifiers[0]);
  if (noteCount > 1) console.log("nullifier[1]:", nullifiers[1]);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
