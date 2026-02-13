import { describe, it, expect } from "vitest";
import blockFixture from "../fixtures/mainnet/block-19000000.json" assert { type: "json" };
import accountFixture from "../fixtures/mainnet/account-vitalik.json" assert { type: "json" };
import {
  computeRecipientHash,
  computeNotesHash,
  deriveTargetAddress,
  generateWitnessInput,
  hexToBytes,
  bytesToHex,
  Note,
} from "../src/witness";
import { encodeBlockHeader, verifyBlockHash } from "../src/block-header";
import { parseAccountProof, EthGetProofResponse } from "../src/eth-proof";
import type { StateRootInput } from "../src/witness";

const recipient = "0x1111111111111111111111111111111111111111";
const secretHex = "0x000000000000000000000000000000000000000000000000000000000041b770";
const chainId = 1n;

describe("Component Integration", () => {
  describe("RLP + Block Header", () => {
    it("encodes fixture header and matches on-chain hash", () => {
      const encoded = encodeBlockHeader(blockFixture.header);
      expect(bytesToHex(encoded)).toBe(blockFixture.headerRlp.toLowerCase());
      expect(verifyBlockHash(blockFixture.header, blockFixture.blockHash)).toBe(true);
    });
  });

  describe("Keccak + MPT", () => {
    it("parses fixture proof and computes keccak chain", () => {
      const proof: EthGetProofResponse = {
        address: accountFixture.address,
        accountProof: accountFixture.proof.accountProof,
        balance: accountFixture.proof.balance,
        codeHash: accountFixture.proof.codeHash,
        nonce: accountFixture.proof.nonce,
        storageHash: accountFixture.proof.storageHash,
        storageProof: [],
      };
      const parsed = parseAccountProof(proof);
      expect(bytesToHex(parsed.address)).toBe(accountFixture.address.toLowerCase());
      expect(bytesToHex(parsed.addressHash)).toBe(accountFixture.computed.addressHash.toLowerCase());
      parsed.proofNodeHashes.forEach((hash, idx) => {
        expect(bytesToHex(hash)).toBe(accountFixture.computed.proofNodeHashes[idx].toLowerCase());
      });
      expect(parsed.balance.toString()).toBe(BigInt(accountFixture.proof.balance).toString());
    });
  });

  describe("Witness generation", () => {
    it("produces circuit inputs from fixtures", () => {
      const secret = hexToBytes(secretHex);
      const notes: Note[] = [
        { amount: 1n, recipientHash: computeRecipientHash(recipient) },
      ];
      const notesHash = computeNotesHash(notes);
      const targetAddress = deriveTargetAddress(secret, chainId, notesHash);

      const stateRootInput: StateRootInput = {
        blockNumber: blockFixture.blockNumber,
        stateRoot: blockFixture.header.stateRoot,
      };
      const proof: EthGetProofResponse = {
        address: bytesToHex(targetAddress),
        accountProof: accountFixture.proof.accountProof,
        balance: accountFixture.proof.balance,
        codeHash: accountFixture.proof.codeHash,
        nonce: accountFixture.proof.nonce,
        storageHash: accountFixture.proof.storageHash,
        storageProof: [],
      };

      const witness = generateWitnessInput(
        secret,
        notes,
        0,
        recipient,
        stateRootInput,
        proof,
        chainId
      );

      expect(witness.stateRoot).toHaveLength(32);
      expect(witness.proofNodes.length).toBeGreaterThan(0);
    });
  });
});
