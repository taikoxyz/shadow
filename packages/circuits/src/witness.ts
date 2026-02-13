/**
 * Shadow Protocol Witness Generation Utilities
 *
 * Consumes Ethereum execution data (block headers + `eth_getProof` responses)
 * and produces circuit-ready witnesses for the Shadow circom circuit.
 */

import { hexToBytes, bytesToHex, keccak256 } from "./utils";
import { EthGetProofResponse, parseAccountProof } from "./eth-proof";
import { MAGIC, CONSTANTS, CIRCUIT_LIMITS } from "./constants";
import { bytesToCircuitInput, padArray } from "./format";
import {
  Note,
  bigintToBytes32,
  computeNotesHash,
  computeRecipientHash,
  deriveNullifier,
  deriveTargetAddress,
  computePowDigest,
  findValidSecret,
} from "./derivations";

export type { Note } from "./derivations";
export { MAGIC, CONSTANTS, CIRCUIT_LIMITS } from "./constants";
export {
  computeRecipientHash,
  computeNotesHash,
  deriveTargetAddress,
  deriveNullifier,
  computePowDigest,
  findValidSecret,
  bigintToBytes32,
} from "./derivations";
export { keccak256, sha256, hexToBytes, bytesToHex } from "./utils";

export interface StateRootInput {
  blockNumber: string | number | bigint;
  stateRoot: string;
}

export interface ShadowWitnessInput {
  // Public signals
  blockNumber: string;
  stateRoot: string[];
  chainId: string;
  noteIndex: string;
  amount: string;
  recipient: string[];

  // Private signals
  secret: string[];
  noteCount: string;
  amounts: string[];
  recipientHashes: string[][];

  // Account proof witness
  proofNodes: string[][];
  proofNodeLengths: string[];
  proofDepth: string;
}

export function generateWitnessInput(
  secret: Uint8Array,
  notes: Note[],
  noteIndex: number,
  recipient: string,
  block: StateRootInput,
  accountProofResponse: EthGetProofResponse,
  chainId: bigint
): ShadowWitnessInput {
  if (secret.length !== 32) {
    throw new Error("secret must be 32 bytes");
  }
  if (notes.length === 0) {
    throw new Error("notes array must contain at least one note");
  }
  if (notes.length > CONSTANTS.MAX_NOTES) {
    throw new Error(`notes length exceeds MAX_NOTES (${CONSTANTS.MAX_NOTES})`);
  }
  if (noteIndex < 0 || noteIndex >= notes.length) {
    throw new Error("noteIndex out of bounds for provided notes");
  }

  const notesHash = computeNotesHash(notes);
  const targetAddress = deriveTargetAddress(secret, chainId, notesHash);
  const targetAddressHash = keccak256(targetAddress);

  const blockNumber = normalizeBigInt(block.blockNumber);
  const stateRootBytes = hexToBytes(block.stateRoot);
  if (stateRootBytes.length !== 32) {
    throw new Error("stateRoot must be 32 bytes");
  }

  const recipientBytes = hexToBytes(recipient);
  if (recipientBytes.length !== 20) {
    throw new Error("recipient must be 20 bytes");
  }

  if (accountProofResponse.accountProof.length === 0) {
    throw new Error("accountProof must include at least one node");
  }
  if (accountProofResponse.accountProof.length > CIRCUIT_LIMITS.MAX_PROOF_DEPTH) {
    throw new Error(`account proof depth exceeds max supported depth ${CIRCUIT_LIMITS.MAX_PROOF_DEPTH}`);
  }

  const parsedProof = parseAccountProof(accountProofResponse);
  if (bytesToHex(parsedProof.addressHash) !== bytesToHex(targetAddressHash)) {
    throw new Error("Account proof address hash does not match target address");
  }

  const paddedProofNodes = padArray(
    parsedProof.proofNodes.map((node) => {
      if (node.length > CIRCUIT_LIMITS.MAX_NODE_BYTES) {
        throw new Error(`account proof node exceeds ${CIRCUIT_LIMITS.MAX_NODE_BYTES} bytes`);
      }
      return padArray(bytesToCircuitInput(node), CIRCUIT_LIMITS.MAX_NODE_BYTES, "0");
    }),
    CIRCUIT_LIMITS.MAX_PROOF_DEPTH,
    () => new Array(CIRCUIT_LIMITS.MAX_NODE_BYTES).fill("0")
  );

  const paddedProofNodeLengths = padArray(
    parsedProof.proofNodeLengths.map((len) => len.toString()),
    CIRCUIT_LIMITS.MAX_PROOF_DEPTH,
    "0"
  );

  const paddedAmounts = padArray(
    notes.map((n) => n.amount.toString()),
    CONSTANTS.MAX_NOTES,
    "0"
  );

  const paddedRecipientHashes = padArray(
    notes.map((n) => bytesToCircuitInput(n.recipientHash)),
    CONSTANTS.MAX_NOTES,
    () => new Array(32).fill("0")
  );

  return {
    blockNumber: blockNumber.toString(),
    stateRoot: bytesToCircuitInput(stateRootBytes),
    chainId: chainId.toString(),
    noteIndex: noteIndex.toString(),
    amount: notes[noteIndex].amount.toString(),
    recipient: bytesToCircuitInput(recipientBytes),

    secret: bytesToCircuitInput(secret),
    noteCount: notes.length.toString(),
    amounts: paddedAmounts,
    recipientHashes: paddedRecipientHashes,

    proofNodes: paddedProofNodes,
    proofNodeLengths: paddedProofNodeLengths,
    proofDepth: parsedProof.proofNodes.length.toString(),
  };
}

function normalizeBigInt(value: string | number | bigint): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number") return BigInt(value);
  if (typeof value === "string") return BigInt(value);
  throw new Error("Unsupported blockNumber type");
}
