import { describe, it, expect, beforeAll } from "vitest";
import { Circomkit, WitnessTester } from "circomkit";
import { computeNotesHash, Note, CONSTANTS } from "../src/witness";

type Signals = ["noteCount", "amounts", "recipientHashes"];
type Outputs = ["notesHash"];

const MAX_NOTES = CONSTANTS.MAX_NOTES;

const buildNotes = (count: number): Note[] =>
  Array.from({ length: count }, (_, idx) => ({
    amount: BigInt(idx + 1),
    recipientHash: new Uint8Array(32).fill(idx + 1),
  }));

const buildInput = (notes: Note[]) => {
  const amounts = Array(MAX_NOTES).fill("0");
  const recipientHashes = Array.from({ length: MAX_NOTES }, () => Array(32).fill(0));

  for (let i = 0; i < notes.length; i++) {
    amounts[i] = notes[i].amount.toString();
    recipientHashes[i] = Array.from(notes[i].recipientHash);
  }

  return {
    noteCount: notes.length.toString(),
    amounts,
    recipientHashes,
  };
};

const toByteArray = (values: unknown[]): number[] => values.map((v) => Number(v));

describe("NotesHash consistency (TS vs circuit)", () => {
  let circuit: WitnessTester<Signals, Outputs>;

  beforeAll(async () => {
    const circomkit = new Circomkit({ verbose: false });
    circuit = await circomkit.WitnessTester("note_validator_test", {
      file: "test/NoteValidatorTest",
      template: "NoteValidatorTest",
      params: [MAX_NOTES],
    });
  }, 120_000);

  for (let count = 1; count < MAX_NOTES; count++) {
    it(`matches for noteCount=${count}`, async () => {
      const notes = buildNotes(count);
      const input = buildInput(notes);
      const outputs = await circuit.compute(input, ["notesHash"]);
      const circuitHash = toByteArray(outputs.notesHash as unknown[]);
      const tsHash = Array.from(computeNotesHash(notes));
      expect(circuitHash).toEqual(tsHash);
    });
  }

  it("matches for noteCount=MAX_NOTES", async () => {
    const notes = buildNotes(MAX_NOTES);
    const input = buildInput(notes);
    const outputs = await circuit.compute(input, ["notesHash"]);
    const circuitHash = toByteArray(outputs.notesHash as unknown[]);
    const tsHash = Array.from(computeNotesHash(notes));
    expect(circuitHash).toEqual(tsHash);
  });
});
