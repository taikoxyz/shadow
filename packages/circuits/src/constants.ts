/**
 * Shared protocol/circuit constants so Circom + TS stay in sync.
 */
export const MAGIC = {
  RECIPIENT: "shadow.recipient.v1",
  ADDRESS: "shadow.address.v1",
  NULLIFIER: "shadow.nullifier.v1",
  POW: "shadow.pow.v1",
} as const;

export const CONSTANTS = {
  MAX_NOTES: 5,
  MAX_TOTAL_WEI: BigInt("32000000000000000000"),
  POW_DIFFICULTY: BigInt(2 ** 24),
} as const;

export const CIRCUIT_LIMITS = {
  MAX_HEADER_BYTES: 1024,
  MAX_NODE_BYTES: 544,
  MAX_PROOF_DEPTH: 9,
} as const;
