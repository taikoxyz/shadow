import { keccak256, hexToBytes, bytesToHex } from "./utils";

export interface BlockHeaderData {
  parentHash: string;
  sha3Uncles: string;
  miner: string;
  stateRoot: string;
  transactionsRoot: string;
  receiptsRoot: string;
  logsBloom: string;
  difficulty: string;
  number: string;
  gasLimit: string;
  gasUsed: string;
  timestamp: string;
  extraData: string;
  mixHash: string;
  nonce: string;
  baseFeePerGas?: string;
  withdrawalsRoot?: string;
  blobGasUsed?: string;
  excessBlobGas?: string;
  parentBeaconBlockRoot?: string;
}

type RlpValue = Uint8Array | bigint | RlpValue[];

export function encodeBlockHeader(block: BlockHeaderData): Uint8Array {
  const baseFields: RlpValue[] = [
    hexBytes(block.parentHash),
    hexBytes(block.sha3Uncles),
    hexBytes(block.miner),
    hexBytes(block.stateRoot),
    hexBytes(block.transactionsRoot),
    hexBytes(block.receiptsRoot),
    hexBytes(block.logsBloom),
    BigInt(block.difficulty),
    BigInt(block.number),
    BigInt(block.gasLimit),
    BigInt(block.gasUsed),
    BigInt(block.timestamp),
    hexBytes(block.extraData),
    hexBytes(block.mixHash),
    hexBytes(block.nonce),
  ];

  const optionalFields: RlpValue[] = [];
  if (block.baseFeePerGas !== undefined) optionalFields.push(BigInt(block.baseFeePerGas));
  if (block.withdrawalsRoot !== undefined) optionalFields.push(hexBytes(block.withdrawalsRoot));
  if (block.blobGasUsed !== undefined) optionalFields.push(BigInt(block.blobGasUsed));
  if (block.excessBlobGas !== undefined) optionalFields.push(BigInt(block.excessBlobGas));
  if (block.parentBeaconBlockRoot !== undefined) optionalFields.push(hexBytes(block.parentBeaconBlockRoot));

  return encodeList([...baseFields, ...optionalFields]);
}

export function verifyBlockHash(block: BlockHeaderData, expectedHash: string): boolean {
  const encoded = encodeBlockHeader(block);
  const computed = bytesToHex(keccak256(encoded));
  return computed.toLowerCase() === expectedHash.toLowerCase();
}

function hexBytes(value: string): Uint8Array {
  const normalized = normalizeHex(value);
  return hexToBytes(normalized);
}

function normalizeHex(value: string): string {
  if (!value) return "0x";
  const prefixed = value.startsWith("0x") ? value.slice(2) : value;
  if (prefixed.length === 0) return "0x";
  return prefixed.length % 2 === 0 ? `0x${prefixed}` : `0x0${prefixed}`;
}

function bigIntToBytes(value: bigint): Uint8Array {
  if (value === 0n) return new Uint8Array();
  let hex = value.toString(16);
  if (hex.length % 2 !== 0) hex = `0${hex}`;
  return hexToBytes(`0x${hex}`);
}

function encode(value: RlpValue): Uint8Array {
  if (value instanceof Uint8Array) {
    return encodeBytes(value);
  }
  if (typeof value === "bigint") {
    return encodeBytes(bigIntToBytes(value));
  }
  return encodeList(value);
}

function encodeBytes(data: Uint8Array): Uint8Array {
  if (data.length === 1 && data[0] < 0x80) {
    return data;
  }
  if (data.length < 56) {
    return concat(Uint8Array.of(0x80 + data.length), data);
  }
  const lenBytes = bigIntToBytes(BigInt(data.length));
  return concat(Uint8Array.of(0xb7 + lenBytes.length), lenBytes, data);
}

function encodeList(values: RlpValue[]): Uint8Array {
  const encodedItems = values.map((v) => encode(v));
  const payload = concat(...encodedItems);
  if (payload.length < 56) {
    return concat(Uint8Array.of(0xc0 + payload.length), payload);
  }
  const lenBytes = bigIntToBytes(BigInt(payload.length));
  return concat(Uint8Array.of(0xf7 + lenBytes.length), lenBytes, payload);
}

function concat(...arrays: Uint8Array[]): Uint8Array {
  const total = arrays.reduce((sum, arr) => sum + arr.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const arr of arrays) {
    result.set(arr, offset);
    offset += arr.length;
  }
  return result;
}
