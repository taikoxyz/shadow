import { describe, it, expect } from "vitest";
import { encodeBlockHeader, verifyBlockHash, BlockHeaderData } from "../src/block-header";
import { bytesToHex, hexToBytes } from "../src/witness";

const SAMPLE_HEADER: BlockHeaderData = {
  parentHash: "0x" + "11".repeat(32),
  sha3Uncles: "0x" + "22".repeat(32),
  miner: "0x" + "33".repeat(20),
  stateRoot: "0x" + "44".repeat(32),
  transactionsRoot: "0x" + "55".repeat(32),
  receiptsRoot: "0x" + "66".repeat(32),
  logsBloom: "0x",
  difficulty: "1",
  number: "2",
  gasLimit: "3",
  gasUsed: "4",
  timestamp: "5",
  extraData: "0x1234",
  mixHash: "0x" + "77".repeat(32),
  nonce: "0x" + "88".repeat(8),
  baseFeePerGas: "10",
  withdrawalsRoot: "0x" + "99".repeat(32),
};

const EXPECTED_RLP =
  "0xf9010fa01111111111111111111111111111111111111111111111111111111111111111a02222222222222222222222222222222222222222222222222222222222222222943333333333333333333333333333333333333333a04444444444444444444444444444444444444444444444444444444444444444a05555555555555555555555555555555555555555555555555555555555555555a06666666666666666666666666666666666666666666666666666666666666666800102030405821234a077777777777777777777777777777777777777777777777777777777777777778888888888888888880aa09999999999999999999999999999999999999999999999999999999999999999";
const EXPECTED_HASH = "0xc782b2edcfd0876fe3463e90c9d342724d936bb81f9f5311968c271a85d467c5";

describe("block header encoder", () => {
  it("encodes block header to RLP", () => {
    const encoded = encodeBlockHeader(SAMPLE_HEADER);
    expect(bytesToHex(encoded)).toBe(EXPECTED_RLP);
  });

  it("verifies block hash", () => {
    expect(verifyBlockHash(SAMPLE_HEADER, EXPECTED_HASH)).toBe(true);
    const tampered = { ...SAMPLE_HEADER, stateRoot: "0x" + "aa".repeat(32) };
    expect(verifyBlockHash(tampered, EXPECTED_HASH)).toBe(false);
  });
});
