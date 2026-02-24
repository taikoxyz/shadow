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

/**
 * Proof-of-Work difficulty: number of trailing zero *bytes* required in the PoW digest.
 *
 * The PoW digest is SHA-256(notesHash || secret).  Requiring the last TARGET_ZERO_BYTES
 * bytes to be 0x00 forces an expected 2^(8 * TARGET_ZERO_BYTES) hash iterations:
 *
 *   TARGET_ZERO_BYTES = 3  →  2^24 ≈ 16.7 million iterations  ≈ < 1 second on modern CPUs
 *
 * ## Why PoW?
 * Shadow uses a privacy-preserving deposit flow: a depositor derives a deterministic
 * "target address" from their secret and funds it before claiming via ZK proof.
 * Without any friction, an adversary could flood the chain with dust deposits across
 * millions of generated target addresses (Sybil / denial-of-service).
 *
 * The PoW acts as a lightweight *commitment cost* at deposit time (off-chain, zero gas):
 *   1. The miner must expend CPU before publishing their target address, making bulk
 *      address generation non-trivial.
 *   2. The secret is *bound* to the note set via notesHash, so a pre-mined secret cannot
 *      be reused across different note configurations.
 *   3. PoW validation is performed entirely inside the RISC Zero ZK circuit, adding
 *      zero marginal on-chain gas cost to the claim transaction.
 *
 * ## Why 24 bits (3 bytes) is sufficient
 * The *dominant* cost for any attacker is ZK proof generation — producing one valid
 * RISC Zero Groth16 receipt takes several minutes on consumer hardware and meaningful
 * cloud compute cost (~$0.10–$1.00 per proof at current rates).  That cost already
 * dwarfs 16M SHA-256 hashes (~0.001 seconds).
 *
 * Raising PoW difficulty further (e.g., 32 bits) would disproportionately slow
 * legitimate users while providing negligible additional protection against adversaries
 * capable of funding ZK proof generation.
 *
 * ## Design lineage
 * This approach draws conceptual inspiration from Hashcash (Adam Back, 1997) applied
 * to cryptographic commitment schemes.  There is no on-chain EIP/ERC standard for
 * PoW anti-spam deposits; the design is custom to Shadow Protocol.
 */
const TARGET_ZERO_BYTES = 3; // 24 trailing zero bits → ~16.7M SHA-256 hashes expected

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

function computePowDigest(notesHash, secretBytes32) {
  return sha256(concatBytes(notesHash, secretBytes32));
}

function powDigestIsValid(powDigest) {
  return (
    powDigest[powDigest.length - 1] === 0 &&
    powDigest[powDigest.length - 2] === 0 &&
    powDigest[powDigest.length - 3] === 0
  );
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
  - Mines a PoW-valid secret for the note set.
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

  let attempts = 0;
  let secret;
  let powDigest;
  while (true) {
    secret = randomBytes(32);
    powDigest = computePowDigest(notesHash, secret);
    attempts += 1;

    if (powDigestIsValid(powDigest)) break;

    if (attempts % 20000 === 0) {
      process.stderr.write(`mining... attempts=${attempts.toLocaleString()}\r`);
    }
  }
  process.stderr.write(`mining... attempts=${attempts.toLocaleString()} (done)\n`);

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
  console.log("powDigest:", bytesToHex(powDigest));
  console.log("nullifier[0]:", nullifiers[0]);
  if (noteCount > 1) console.log("nullifier[1]:", nullifiers[1]);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
