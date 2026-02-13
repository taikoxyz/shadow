import { describe, it, expect } from "vitest";
import blockFixture from "../fixtures/mainnet/block-19000000.json" assert { type: "json" };
import accountFixture from "../fixtures/mainnet/account-vitalik.json" assert { type: "json" };
import {
  generateWitnessInput,
  computeRecipientHash,
  computeNotesHash,
  deriveTargetAddress,
  hexToBytes,
  bytesToHex,
  Note,
} from "../src/witness";
import type { StateRootInput } from "../src/witness";
import type { EthGetProofResponse } from "../src/eth-proof";

const recipient = "0x0000000000000000000000000000000000000001";
const secretHex = "0x000000000000000000000000000000000000000000000000000000000041b770";
const chainId = 1n;

describe("Shadow integration scaffolding", () => {
  it("builds witness input from fixtures", () => {
    const secret = hexToBytes(secretHex);
    const notes: Note[] = [
      {
        amount: 1n,
        recipientHash: computeRecipientHash(recipient),
      },
    ];

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
      0,
      recipient,
      stateRootInput,
      accountProof,
      chainId
    );

    expect(witnessInput.stateRoot.length).toBe(32);
    expect(witnessInput.proofNodes.length).toBeGreaterThan(0);
    expect(witnessInput.secret).toHaveLength(32);
  });
});
