#!/usr/bin/env node
/**
 * Generate a real Shadow witness input from live Ethereum RPC data.
 *
 * Preferred mode (deposit file):
 *   node scripts/generate-real-input.mjs \
 *     --deposit /path/to/deposit.json \
 *     --rpc https://rpc.hoodi.taiko.xyz \
 *     --note-index 0 \
 *     --output inputs/shadow/real.json
 *
 * Backward-compatible env mode:
 *   ETH_RPC_URL, RECIPIENT, NOTE_AMOUNTS, [SECRET], [NOTE_INDEX], [CHAIN_ID], [BLOCK_NUMBER], [OUTPUT]
 *
 * Common options/env:
 *   --rpc / ETH_RPC_URL
 *   --deposit / DEPOSIT_FILE
 *   --note-index / NOTE_INDEX (default 0)
 *   --chain-id / CHAIN_ID (optional override)
 *   --block-number / BLOCK_NUMBER (default latest)
 *   --output / OUTPUT (default inputs/shadow/real.json)
 *   --dry-run / DRY_RUN=1
 */

import { createHash, randomBytes } from "crypto";
import fs from "fs";
import path from "path";
import process from "process";
import { keccak_256 } from "@noble/hashes/sha3";

const MAGIC = {
  RECIPIENT: "shadow.recipient.v1",
  ADDRESS: "shadow.address.v1",
  NULLIFIER: "shadow.nullifier.v1",
  POW: "shadow.pow.v1",
};

const MAX_NOTES = 5;
const MAX_PROOF_DEPTH = 9;
const MAX_NODE_BYTES = 544;

const usage = `Usage:
  node scripts/generate-real-input.mjs --deposit <deposit.json> --rpc <url> [--note-index 0] [--output <path>] [--block-number latest] [--dry-run]

Legacy mode:
  ETH_RPC_URL=<url> RECIPIENT=<0x...> NOTE_AMOUNTS=<a,b,c> [SECRET=<0x...>] node scripts/generate-real-input.mjs
`;

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
  let hex = value.toString(16).padStart(64, "0");
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

function computePowDigest(secretBytes) {
  const magic = padMagicLabel(MAGIC.POW);
  const input = new Uint8Array(64);
  input.set(magic, 0);
  input.set(secretBytes, 32);
  const digest = sha256(input);
  const valid = digest[29] === 0 && digest[30] === 0 && digest[31] === 0;
  return { digest, valid };
}

function bytesToCircuitInput(bytes) {
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
  const rpcUrl = CURRENT.rpcUrl;
  if (!rpcUrl) throw new Error("ETH_RPC_URL or --rpc must be provided");
  const res = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  if (!res.ok) throw new Error(`RPC ${method} failed with status ${res.status}`);
  const json = await res.json();
  if (!json.result) throw new Error(`RPC ${method} error: ${json.error?.message || "unknown"}`);
  return json.result;
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === "--") {
      continue;
    }
    if (token === "--help" || token === "-h") {
      out.help = true;
      continue;
    }
    if (!token.startsWith("--")) {
      throw new Error(`Unexpected argument: ${token}`);
    }
    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      out[key] = true;
      continue;
    }
    out[key] = next;
    i += 1;
  }
  return out;
}

function requireHexAddress(value, fieldName) {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(value)) {
    throw new Error(`${fieldName} must be 0x-prefixed 20-byte hex`);
  }
  return value.toLowerCase();
}

function requireHexSecret(value, fieldName) {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw new Error(`${fieldName} must be 0x-prefixed 32-byte hex`);
  }
  return value.toLowerCase();
}

function resolvePathMaybe(input) {
  if (!input) return "";
  return path.isAbsolute(input) ? input : path.resolve(process.cwd(), input);
}

function parseBigIntStrict(value, fieldName) {
  if (typeof value !== "string" && typeof value !== "number" && typeof value !== "bigint") {
    throw new Error(`${fieldName} is not a valid integer`);
  }
  try {
    return BigInt(value);
  } catch {
    throw new Error(`${fieldName} is not a valid integer`);
  }
}

function parsePositiveAmount(value, fieldName) {
  if (typeof value !== "string" || !/^[1-9][0-9]*$/.test(value)) {
    throw new Error(`${fieldName} must be a non-zero integer string`);
  }
  return BigInt(value);
}

function loadDeposit(depositPath) {
  const resolved = resolvePathMaybe(depositPath);
  if (!resolved) throw new Error("Missing --deposit path");
  const raw = JSON.parse(fs.readFileSync(resolved, "utf8"));
  if (raw.version !== "v1") throw new Error("deposit.version must be v1");
  if (typeof raw.chainId !== "string" || !/^[0-9]+$/.test(raw.chainId)) {
    throw new Error("deposit.chainId must be a decimal string");
  }
  const secretHex = requireHexSecret(raw.secret, "deposit.secret");
  if (!Array.isArray(raw.notes) || raw.notes.length === 0 || raw.notes.length > MAX_NOTES) {
    throw new Error(`deposit.notes must have 1..${MAX_NOTES} entries`);
  }
  const notes = raw.notes.map((note, idx) => {
    const recipient = requireHexAddress(note?.recipient, `deposit.notes[${idx}].recipient`);
    const amount = parsePositiveAmount(note?.amount, `deposit.notes[${idx}].amount`);
    return {
      recipient,
      amount,
      recipientHash: computeRecipientHash(recipient),
    };
  });
  const targetAddress =
    typeof raw.targetAddress === "string" ? requireHexAddress(raw.targetAddress, "deposit.targetAddress") : "";
  return {
    resolvedPath: resolved,
    chainId: BigInt(raw.chainId),
    secretHex,
    notes,
    targetAddress,
  };
}

function parseNoteIndex(value, noteCount) {
  const idx = Number(value ?? "0");
  if (!Number.isInteger(idx) || idx < 0 || idx >= noteCount) {
    throw new Error(`note-index out of range (0..${noteCount - 1})`);
  }
  return idx;
}

const CURRENT = {
  rpcUrl: "",
};

async function main() {
  const cli = parseArgs(process.argv.slice(2));
  if (cli.help) {
    console.log(usage);
    return;
  }

  const rpcUrl = String(cli.rpc ?? process.env.ETH_RPC_URL ?? "").trim();
  CURRENT.rpcUrl = rpcUrl;
  const blockNumberTag = String(cli["block-number"] ?? process.env.BLOCK_NUMBER ?? "latest");
  const outputPath = resolvePathMaybe(
    String(cli.output ?? process.env.OUTPUT ?? path.join(process.cwd(), "inputs", "shadow", "real.json"))
  );
  const dryRun = cli["dry-run"] === true || process.env.DRY_RUN === "1";
  const depositPath = String(cli.deposit ?? process.env.DEPOSIT_FILE ?? "").trim();

  let noteIndex = 0;
  let chainId;
  let secretBytes;
  let notes;
  let selectedRecipient;
  let depositTargetAddress = "";
  let loadedDepositPath = "";

  if (depositPath) {
    const deposit = loadDeposit(depositPath);
    loadedDepositPath = deposit.resolvedPath;
    noteIndex = parseNoteIndex(cli["note-index"] ?? process.env.NOTE_INDEX ?? "0", deposit.notes.length);
    chainId =
      cli["chain-id"] ?? process.env.CHAIN_ID
        ? parseBigIntStrict(cli["chain-id"] ?? process.env.CHAIN_ID, "chain-id")
        : deposit.chainId;
    notes = deposit.notes;
    selectedRecipient = notes[noteIndex].recipient;
    secretBytes = hexToBytes(deposit.secretHex);
    depositTargetAddress = deposit.targetAddress;
  } else {
    const recipient = String(cli.recipient ?? process.env.RECIPIENT ?? "").trim();
    const noteAmounts = String(cli["note-amounts"] ?? process.env.NOTE_AMOUNTS ?? "").trim();
    if (!recipient || !noteAmounts) {
      throw new Error("Missing deposit mode (--deposit) or legacy mode inputs (RECIPIENT + NOTE_AMOUNTS)");
    }
    selectedRecipient = requireHexAddress(recipient, "recipient");
    const amounts = noteAmounts.split(",").map((v, i) => parsePositiveAmount(v.trim(), `note-amounts[${i}]`));
    if (amounts.length === 0 || amounts.length > MAX_NOTES) {
      throw new Error(`NOTE_AMOUNTS must have 1..${MAX_NOTES} values`);
    }
    noteIndex = parseNoteIndex(cli["note-index"] ?? process.env.NOTE_INDEX ?? "0", amounts.length);
    const recipientHash = computeRecipientHash(selectedRecipient);
    notes = amounts.map((amount) => ({ amount, recipient: selectedRecipient, recipientHash }));
    if (cli.secret || process.env.SECRET) {
      secretBytes = hexToBytes(requireHexSecret(String(cli.secret ?? process.env.SECRET), "secret"));
    } else {
      secretBytes = randomBytes(32);
      console.log("Generated random SECRET:", bytesToHex(secretBytes));
    }
    chainId = cli["chain-id"] ?? process.env.CHAIN_ID ? parseBigIntStrict(cli["chain-id"] ?? process.env.CHAIN_ID, "chain-id") : null;
  }

  if (!chainId) {
    chainId = BigInt(await rpc("eth_chainId", []));
  }
  if (secretBytes.length !== 32) throw new Error("secret must be 32 bytes");

  const notesHash = computeNotesHash(notes);
  const targetAddress = deriveTargetAddress(secretBytes, chainId, notesHash);
  const targetAddressHex = bytesToHex(targetAddress);
  const addressHash = keccak256(targetAddress);
  const { digest: powDigest, valid: powValid } = computePowDigest(secretBytes);
  if (!powValid) {
    throw new Error("PoW digest is invalid for this secret (last 24 bits must be zero).");
  }

  if (depositTargetAddress && targetAddressHex.toLowerCase() !== depositTargetAddress.toLowerCase()) {
    throw new Error(`deposit.targetAddress mismatch: deposit=${depositTargetAddress}, derived=${targetAddressHex}`);
  }

  console.log("Target address:", targetAddressHex);
  console.log("Address hash:", bytesToHex(addressHash));
  console.log("PoW digest valid:", powValid);
  if (loadedDepositPath) {
    console.log("Deposit file:", loadedDepositPath);
    console.log("Selected note index:", noteIndex);
  }

  if (dryRun) return;

  const block = await rpc("eth_getBlockByNumber", [blockNumberTag, false]);
  const blockNumber = block.number;
  const stateRootBytes = hexToBytes(block.stateRoot);

  const proof = await rpc("eth_getProof", [targetAddressHex, [], blockNumber]);
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

  const paddedAmounts = padArray(notes.map((n) => n.amount.toString()), MAX_NOTES, "0");
  const paddedRecipientHashes = padArray(
    notes.map((n) => bytesToCircuitInput(n.recipientHash)),
    MAX_NOTES,
    () => new Array(32).fill("0")
  );

  const input = {
    blockNumber: BigInt(blockNumber).toString(),
    stateRoot: bytesToCircuitInput(stateRootBytes),
    chainId: chainId.toString(),
    noteIndex: noteIndex.toString(),
    amount: notes[noteIndex].amount.toString(),
    recipient: bytesToCircuitInput(hexToBytes(selectedRecipient)),

    secret: bytesToCircuitInput(secretBytes),
    noteCount: notes.length.toString(),
    amounts: paddedAmounts,
    recipientHashes: paddedRecipientHashes,

    proofNodes: paddedProofNodes,
    proofNodeLengths: paddedProofLengths,
    proofDepth: proofNodes.length.toString(),
  };

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(input, null, 2));
  console.log("Wrote witness input:", outputPath);
}

main().catch((err) => {
  console.error("Failed to generate input:", err);
  process.exit(1);
});
