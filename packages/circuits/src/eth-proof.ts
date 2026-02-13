import { keccak256, hexToBytes } from "./utils";

export interface EthGetProofResponse {
  address: string;
  accountProof: string[];
  balance: string;
  codeHash: string;
  nonce: string;
  storageHash: string;
  storageProof: Array<{
    key: string;
    value: string;
    proof: string[];
  }>;
}

export interface ParsedAccountProof {
  address: Uint8Array;
  addressHash: Uint8Array;
  proofNodes: Uint8Array[];
  proofNodeLengths: number[];
  proofNodeHashes: Uint8Array[];
  balance: bigint;
  nonce: bigint;
  storageHash: Uint8Array;
  codeHash: Uint8Array;
}

export function parseAccountProof(response: EthGetProofResponse): ParsedAccountProof {
  const address = hexToBytes(response.address);
  if (address.length !== 20) {
    throw new Error("Account address must be 20 bytes");
  }

  const proofNodes = response.accountProof.map((node) => hexToBytes(node));
  if (proofNodes.length === 0) {
    throw new Error("accountProof must include at least one node");
  }

  const proofNodeLengths = proofNodes.map((node) => node.length);
  const proofNodeHashes = proofNodes.map((node) => keccak256(node));

  return {
    address,
    addressHash: keccak256(address),
    proofNodes,
    proofNodeLengths,
    proofNodeHashes,
    balance: BigInt(response.balance),
    nonce: BigInt(response.nonce),
    storageHash: hexToBytes(response.storageHash),
    codeHash: hexToBytes(response.codeHash),
  };
}
