import { describe, it, expect, beforeAll } from "vitest";
import { Circomkit, WitnessTester } from "circomkit";
import { CONSTANTS } from "../src/witness";

type Signals = ["noteCount", "amounts", "recipientHashes"];
type Outputs = ["totalAmount"];

const MAX_NOTES = CONSTANTS.MAX_NOTES;
const MAX_TOTAL_WEI = CONSTANTS.MAX_TOTAL_WEI;

const buildInput = (amounts: bigint[], noteCount: number) => {
  const paddedAmounts = Array(MAX_NOTES).fill("0");
  const recipientHashes = Array.from({ length: MAX_NOTES }, () => Array(32).fill(0));

  for (let i = 0; i < amounts.length; i++) {
    paddedAmounts[i] = amounts[i].toString();
  }

  return {
    noteCount: noteCount.toString(),
    amounts: paddedAmounts,
    recipientHashes,
  };
};

describe("Note amount range constraints", () => {
  let circuit: WitnessTester<Signals, Outputs>;

  beforeAll(async () => {
    const circomkit = new Circomkit({ verbose: false });
    circuit = await circomkit.WitnessTester("note_validator_test", {
      file: "test/NoteValidatorTest",
      template: "NoteValidatorTest",
      params: [MAX_NOTES],
    });
  }, 120_000);

  it("rejects totalAmount above MAX_TOTAL_WEI (within 128-bit range)", async () => {
    const input = buildInput([MAX_TOTAL_WEI + 1n], 1);
    await expect(circuit.expectPass(input)).rejects.toThrow();
  });

  it("rejects oversized amounts with high bits set", async () => {
    const hugeAmount = 1n << 200n;
    const input = buildInput([hugeAmount], 1);
    await expect(circuit.expectPass(input)).rejects.toThrow();
  });
});
