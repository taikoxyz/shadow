import { MAGIC, CONSTANTS } from "./constants";
import { hexToBytes, bytesToHex, sha256 } from "./utils";

const encoder = new TextEncoder();

export function bigintToBytes32(value: bigint): Uint8Array {
  const hex = value.toString(16).padStart(64, "0");
  return hexToBytes(hex);
}

export function bytes32ToBigint(bytes: Uint8Array): bigint {
  return BigInt(bytesToHex(bytes));
}

export interface Note {
  amount: bigint;
  recipientHash: Uint8Array;
}

function padMagicLabel(label: string): Uint8Array {
  const raw = encoder.encode(label);
  const padded = new Uint8Array(32);
  padded.set(raw.slice(0, 32));
  return padded;
}

export function computeRecipientHash(recipient: string): Uint8Array {
  const magic = padMagicLabel(MAGIC.RECIPIENT);
  const recipientBytes = hexToBytes(recipient);
  if (recipientBytes.length !== 20) {
    throw new Error("recipient must be 20 bytes");
  }
  const paddedRecipient = new Uint8Array(32);
  paddedRecipient.set(recipientBytes, 12);

  const input = new Uint8Array(64);
  input.set(magic, 0);
  input.set(paddedRecipient, 32);
  return sha256(input);
}

export function computeNotesHash(notes: Note[]): Uint8Array {
  // Use fixed-length padding to match the circuit implementation.
  const maxNotes = CONSTANTS.MAX_NOTES;
  const noteData = new Uint8Array(maxNotes * 64);
  for (let i = 0; i < notes.length; i++) {
    noteData.set(bigintToBytes32(notes[i].amount), i * 64);
    noteData.set(notes[i].recipientHash, i * 64 + 32);
  }
  return sha256(noteData);
}

export function deriveTargetAddress(secret: Uint8Array, chainId: bigint, notesHash: Uint8Array): Uint8Array {
  if (secret.length !== 32) {
    throw new Error("secret must be 32 bytes");
  }
  if (notesHash.length !== 32) {
    throw new Error("notesHash must be 32 bytes");
  }
  const magic = padMagicLabel(MAGIC.ADDRESS);
  const input = new Uint8Array(128);
  input.set(magic, 0);
  input.set(bigintToBytes32(chainId), 32);
  input.set(secret, 64);
  input.set(notesHash, 96);

  const hash = sha256(input);
  return hash.slice(12);
}

export function deriveNullifier(secret: Uint8Array, chainId: bigint, noteIndex: number): Uint8Array {
  if (secret.length !== 32) {
    throw new Error("secret must be 32 bytes");
  }
  const magic = padMagicLabel(MAGIC.NULLIFIER);
  const input = new Uint8Array(128);
  input.set(magic, 0);
  input.set(bigintToBytes32(chainId), 32);
  input.set(secret, 64);
  input.set(bigintToBytes32(BigInt(noteIndex)), 96);
  return sha256(input);
}

export function computePowDigest(secret: Uint8Array): {
  digest: Uint8Array;
  valid: boolean;
} {
  if (secret.length !== 32) {
    throw new Error("secret must be 32 bytes");
  }
  const magic = padMagicLabel(MAGIC.POW);
  const input = new Uint8Array(64);
  input.set(magic, 0);
  input.set(secret, 32);
  const digest = sha256(input);
  const valid = digest[29] === 0 && digest[30] === 0 && digest[31] === 0;
  return { digest, valid };
}

export function findValidSecret(baseSeed: Uint8Array, maxAttempts = 0x1000000): Uint8Array {
  const candidate = new Uint8Array(32);

  for (let nonce = 0; nonce < maxAttempts; nonce++) {
    for (let i = 0; i < 28; i++) {
      candidate[i] = baseSeed[i % baseSeed.length] ^ ((nonce >> (i % 24)) & 0xff);
    }
    candidate[28] = (nonce >> 24) & 0xff;
    candidate[29] = (nonce >> 16) & 0xff;
    candidate[30] = (nonce >> 8) & 0xff;
    candidate[31] = nonce & 0xff;

    if (computePowDigest(candidate).valid) {
      return candidate.slice();
    }
  }

  throw new Error(`Could not find valid PoW after ${maxAttempts} attempts`);
}
