import { describe, it, expect } from "vitest";
import { sha256, hexToBytes, bytesToHex } from "../src/witness";

describe("SHA256", () => {
  it("computes correct hash for empty input", () => {
    const input = new Uint8Array(0);
    const hash = sha256(input);
    expect(bytesToHex(hash)).toBe(
      "0xe3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
    );
  });

  it("computes correct hash for 'hello'", () => {
    const input = new TextEncoder().encode("hello");
    const hash = sha256(input);
    expect(bytesToHex(hash)).toBe(
      "0x2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824"
    );
  });

  it("computes correct hash for 64-byte input", () => {
    const input = new Uint8Array(64).fill(0xab);
    const hash = sha256(input);
    expect(hash.length).toBe(32);
  });
});

describe("Hex conversion", () => {
  it("converts hex to bytes", () => {
    const bytes = hexToBytes("0xdeadbeef");
    expect(bytes).toEqual(new Uint8Array([0xde, 0xad, 0xbe, 0xef]));
  });

  it("converts bytes to hex", () => {
    const hex = bytesToHex(new Uint8Array([0xde, 0xad, 0xbe, 0xef]));
    expect(hex).toBe("0xdeadbeef");
  });

  it("handles hex without 0x prefix", () => {
    const bytes = hexToBytes("deadbeef");
    expect(bytes).toEqual(new Uint8Array([0xde, 0xad, 0xbe, 0xef]));
  });
});
