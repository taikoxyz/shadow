import { describe, it, expect } from "vitest";
import {
  computeRecipientHash,
  computeNotesHash,
  deriveTargetAddress,
  deriveNullifier,
  computePowDigest,
  findValidSecret,
  bigintToBytes32,
  bytesToHex,
  hexToBytes,
  Note,
} from "../src/witness";

describe("RecipientHash", () => {
  it("computes deterministic recipient hash", () => {
    const recipient = "0x1234567890123456789012345678901234567890";
    const hash1 = computeRecipientHash(recipient);
    const hash2 = computeRecipientHash(recipient);
    expect(bytesToHex(hash1)).toBe(bytesToHex(hash2));
    expect(hash1.length).toBe(32);
  });

  it("produces different hashes for different recipients", () => {
    const hash1 = computeRecipientHash("0x1234567890123456789012345678901234567890");
    const hash2 = computeRecipientHash("0xabcdefabcdefabcdefabcdefabcdefabcdefabcd");
    expect(bytesToHex(hash1)).not.toBe(bytesToHex(hash2));
  });
});

describe("NotesHash", () => {
  it("computes hash for single note", () => {
    const notes: Note[] = [
      {
        amount: BigInt("1000000000000000000"),
        recipientHash: new Uint8Array(32).fill(0xaa),
      },
    ];
    const hash = computeNotesHash(notes);
    expect(hash.length).toBe(32);
  });

  it("computes deterministic hash for multiple notes", () => {
    const notes: Note[] = [
      {
        amount: BigInt("1000000000000000000"),
        recipientHash: new Uint8Array(32).fill(0xaa),
      },
      {
        amount: BigInt("2000000000000000000"),
        recipientHash: new Uint8Array(32).fill(0xbb),
      },
    ];
    const hash1 = computeNotesHash(notes);
    const hash2 = computeNotesHash(notes);
    expect(bytesToHex(hash1)).toBe(bytesToHex(hash2));
  });

  it("produces different hashes for different note orders", () => {
    const note1: Note = {
      amount: BigInt("1000000000000000000"),
      recipientHash: new Uint8Array(32).fill(0xaa),
    };
    const note2: Note = {
      amount: BigInt("2000000000000000000"),
      recipientHash: new Uint8Array(32).fill(0xbb),
    };

    const hash1 = computeNotesHash([note1, note2]);
    const hash2 = computeNotesHash([note2, note1]);
    expect(bytesToHex(hash1)).not.toBe(bytesToHex(hash2));
  });
});

describe("TargetAddress", () => {
  it("derives 20-byte address", () => {
    const secret = new Uint8Array(32).fill(0x12);
    const chainId = BigInt(1);
    const notesHash = new Uint8Array(32).fill(0xab);

    const address = deriveTargetAddress(secret, chainId, notesHash);
    expect(address.length).toBe(20);
  });

  it("produces deterministic address", () => {
    const secret = new Uint8Array(32).fill(0x12);
    const chainId = BigInt(1);
    const notesHash = new Uint8Array(32).fill(0xab);

    const addr1 = deriveTargetAddress(secret, chainId, notesHash);
    const addr2 = deriveTargetAddress(secret, chainId, notesHash);
    expect(bytesToHex(addr1)).toBe(bytesToHex(addr2));
  });

  it("produces different addresses for different chain IDs", () => {
    const secret = new Uint8Array(32).fill(0x12);
    const notesHash = new Uint8Array(32).fill(0xab);

    const addr1 = deriveTargetAddress(secret, BigInt(1), notesHash);
    const addr2 = deriveTargetAddress(secret, BigInt(167000), notesHash);
    expect(bytesToHex(addr1)).not.toBe(bytesToHex(addr2));
  });
});

describe("Nullifier", () => {
  it("derives 32-byte nullifier", () => {
    const secret = new Uint8Array(32).fill(0x12);
    const chainId = BigInt(1);
    const noteIndex = 0;

    const nullifier = deriveNullifier(secret, chainId, noteIndex);
    expect(nullifier.length).toBe(32);
  });

  it("produces different nullifiers for different note indices", () => {
    const secret = new Uint8Array(32).fill(0x12);
    const chainId = BigInt(1);

    const null1 = deriveNullifier(secret, chainId, 0);
    const null2 = deriveNullifier(secret, chainId, 1);
    expect(bytesToHex(null1)).not.toBe(bytesToHex(null2));
  });
});

describe("PoW", () => {
  it("validates correct PoW with known valid secret", () => {
    const knownValidSecret = hexToBytes(
      "0x000000000000000000000000000000000000000000000000000000000041b770"
    );
    const { digest, valid } = computePowDigest(knownValidSecret);
    expect(valid).toBe(true);
    expect(digest[29]).toBe(0);
    expect(digest[30]).toBe(0);
    expect(digest[31]).toBe(0);
  });

  it("rejects invalid PoW", () => {
    const invalidSecret = new Uint8Array(32).fill(0x01);
    const { valid } = computePowDigest(invalidSecret);
    expect(valid).toBe(false);
  });

  it("findValidSecret finds a valid secret (limited attempts)", () => {
    const validSecret = findValidSecret(new Uint8Array(32).fill(0x00), 0x500000);
    const { valid } = computePowDigest(validSecret);
    expect(valid).toBe(true);
  }, 60000);
});

describe("bigintToBytes32", () => {
  it("converts zero correctly", () => {
    const bytes = bigintToBytes32(BigInt(0));
    expect(bytes.length).toBe(32);
    expect(bytes.every((b) => b === 0)).toBe(true);
  });

  it("converts 1 ETH correctly", () => {
    const oneEth = BigInt("1000000000000000000");
    const bytes = bigintToBytes32(oneEth);
    expect(bytes.length).toBe(32);
  });

  it("preserves value through round-trip", () => {
    const original = BigInt("32000000000000000000");
    const bytes = bigintToBytes32(original);
    const hex = bytesToHex(bytes);
    const recovered = BigInt(hex);
    expect(recovered).toBe(original);
  });
});
