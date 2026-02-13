import { describe, it, expect } from "vitest";
import { parseAccountProof, EthGetProofResponse } from "../src/eth-proof";
import { bytesToHex, keccak256, hexToBytes } from "../src/witness";

const ADDRESS = "0x1234567890abcdef1234567890abcdef12345678";
const NODE_ONE = "0x8099";
const NODE_TWO = "0xdeadbeef";

describe("eth_getProof parser", () => {
  it("parses proof response", () => {
    const response: EthGetProofResponse = {
      address: ADDRESS,
      accountProof: [NODE_ONE, NODE_TWO],
      balance: "15",
      codeHash: "0x" + "11".repeat(32),
      nonce: "1",
      storageHash: "0x" + "22".repeat(32),
      storageProof: [],
    };

    const parsed = parseAccountProof(response);
    expect(parsed.address.length).toBe(20);
    expect(bytesToHex(parsed.addressHash)).toBe(bytesToHex(keccak256(hexToBytes(ADDRESS))));
    expect(parsed.proofNodes).toHaveLength(2);
    expect(parsed.proofNodeLengths).toEqual(parsed.proofNodes.map((n) => n.length));
    expect(parsed.proofNodeHashes[0]).toBeDefined();
    expect(parsed.balance).toBe(15n);
    expect(parsed.nonce).toBe(1n);
  });

  it("rejects empty proof", () => {
    const response: EthGetProofResponse = {
      address: ADDRESS,
      accountProof: [],
      balance: "0",
      codeHash: "0x" + "33".repeat(32),
      nonce: "0",
      storageHash: "0x" + "44".repeat(32),
      storageProof: [],
    };

    expect(() => parseAccountProof(response)).toThrow(/accountProof/);
  });
});
