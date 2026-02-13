import { describe, it, expect } from "vitest";
import blockFixture from "../fixtures/mainnet/block-19000000.json" assert { type: "json" };
import accountFixture from "../fixtures/mainnet/account-vitalik.json" assert { type: "json" };
import {
  generateWitnessInput,
  computeRecipientHash,
  computeNotesHash,
  deriveTargetAddress,
  deriveNullifier,
  computePowDigest,
  hexToBytes,
  bytesToHex,
  Note,
} from "../src/witness";
import { bytesToCircuitInput } from "../src/format";
import type { StateRootInput } from "../src/witness";
import type { EthGetProofResponse } from "../src/eth-proof";

const recipient = "0x0000000000000000000000000000000000000001";
const secretHex = "0x000000000000000000000000000000000000000000000000000000000041b770";
const chainId = 1n;

function flattenPublicSignals(
  witness: ReturnType<typeof generateWitnessInput>,
  nullifierBytes: Uint8Array,
  powDigestBytes: Uint8Array
): string[] {
  return [
    witness.blockNumber,
    ...witness.stateRoot,
    witness.chainId,
    witness.noteIndex,
    witness.amount,
    ...witness.recipient,
    ...bytesToCircuitInput(nullifierBytes),
    ...bytesToCircuitInput(powDigestBytes),
  ];
}

describe("Audit-related tests", () => {
  it("flattens public signals in PRD order", () => {
    const secret = hexToBytes(secretHex);
    const notes: Note[] = [
      {
        amount: 1n,
        recipientHash: computeRecipientHash(recipient),
      },
    ];
    const noteIndex = 0;

    const stateRootInput: StateRootInput = {
      blockNumber: blockFixture.blockNumber,
      stateRoot: blockFixture.header.stateRoot,
    };

    const notesHash = computeNotesHash(notes);
    const targetAddress = deriveTargetAddress(secret, chainId, notesHash);
    const targetAddressHex = bytesToHex(targetAddress);

    const accountProof: EthGetProofResponse = {
      address: targetAddressHex,
      accountProof: accountFixture.proof.accountProof,
      balance: accountFixture.proof.balance,
      codeHash: accountFixture.proof.codeHash,
      nonce: accountFixture.proof.nonce,
      storageHash: accountFixture.proof.storageHash,
      storageProof: [],
    };

    const witnessInput = generateWitnessInput(
      secret,
      notes,
      noteIndex,
      recipient,
      stateRootInput,
      accountProof,
      chainId
    );

    const nullifier = deriveNullifier(secret, chainId, noteIndex);
    const pow = computePowDigest(secret);

    const publicSignals = flattenPublicSignals(witnessInput, nullifier, pow.digest);

    let cursor = 0;
    expect(publicSignals[cursor++]).toBe(witnessInput.blockNumber);
    for (let i = 0; i < 32; i++) {
      expect(publicSignals[cursor++]).toBe(witnessInput.stateRoot[i]);
    }
    expect(publicSignals[cursor++]).toBe(witnessInput.chainId);
    expect(publicSignals[cursor++]).toBe(witnessInput.noteIndex);
    expect(publicSignals[cursor++]).toBe(witnessInput.amount);
    for (let i = 0; i < 20; i++) {
      expect(publicSignals[cursor++]).toBe(witnessInput.recipient[i]);
    }
    const nullifierSignals = bytesToCircuitInput(nullifier);
    for (let i = 0; i < 32; i++) {
      expect(publicSignals[cursor++]).toBe(nullifierSignals[i]);
    }
    const powSignals = bytesToCircuitInput(pow.digest);
    for (let i = 0; i < 32; i++) {
      expect(publicSignals[cursor++]).toBe(powSignals[i]);
    }
  });
});
