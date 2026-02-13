import { describe, it, expect, beforeAll } from "vitest";
import { Circomkit, WitnessTester } from "circomkit";
import { hexToBytes } from "../src/witness";

type KeccakSignals = [
  "varInput",
  "varLen",
  "expectedVarHash",
  "addressInput",
  "expectedAddressHash",
  "wordInput",
  "expectedWordHash"
];
type KeccakOutputs = [];

describe("Keccak wrapper", () => {
  let circuit: WitnessTester<KeccakSignals, KeccakOutputs>;

  const hexToDecArray = (hex: string) => Array.from(hexToBytes(hex));

  const ZERO_INPUT_HASH = hexToDecArray(
    "0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470"
  );
  const HELLO_HASH = hexToDecArray(
    "0x1c8aff950685c2ed4bc3174f3472287b56d9517b9c948127319a09a7a36deac8"
  );
  const ADDRESS_HASH = hexToDecArray(
    "0x1468288056310c82aa4c01a7e12a10f8111a0560e72b700555479031b86c357d"
  );
  const WORD_HASH = hexToDecArray(
    "0x8ae1aa597fa146ebd3aa2ceddf360668dea5e526567e92b0321816a4e895bd2d"
  );

  function applyDefaultAddressAndWord(input: ReturnType<typeof baseInput>) {
    input.addressInput.fill(0);
    input.addressInput[19] = 1;
    input.expectedAddressHash = [...ADDRESS_HASH];

    for (let i = 0; i < 32; i++) {
      input.wordInput[i] = i;
    }
    input.expectedWordHash = [...WORD_HASH];
  }

  function baseInput() {
    return {
      varInput: new Array<number>(64).fill(0),
      varLen: 0,
      expectedVarHash: new Array<number>(32).fill(0),
      addressInput: new Array<number>(20).fill(0),
      expectedAddressHash: new Array<number>(32).fill(0),
      wordInput: new Array<number>(32).fill(0),
      expectedWordHash: new Array<number>(32).fill(0),
    };
  }

  beforeAll(async () => {
    const circomkit = new Circomkit({
      verbose: false,
    });
    circuit = await circomkit.WitnessTester("keccak_test", {
      file: "test/KeccakTest",
      template: "KeccakTest",
      params: [],
    });
  }, 120_000);

  it(
    "hashes empty input",
    async () => {
      const input = { ...baseInput() };
      applyDefaultAddressAndWord(input);
      input.expectedVarHash = [...ZERO_INPUT_HASH];
      await circuit.expectPass(input);
    },
    60_000
  );

  it(
    "hashes 'hello'",
    async () => {
      const input = { ...baseInput() };
      applyDefaultAddressAndWord(input);
      const helloBytes = Array.from(new TextEncoder().encode("hello"));
      helloBytes.forEach((byte, idx) => {
        input.varInput[idx] = byte;
      });
      input.varLen = helloBytes.length;

      input.expectedVarHash = [...HELLO_HASH];
      await circuit.expectPass(input);
    },
    60_000
  );

  it(
    "hashes 20-byte address",
    async () => {
      const input = { ...baseInput() };
      applyDefaultAddressAndWord(input);
      input.expectedVarHash = [...ZERO_INPUT_HASH];
      await circuit.expectPass(input);
    },
    60_000
  );

  it(
    "hashes 32-byte word",
    async () => {
      const input = { ...baseInput() };
      applyDefaultAddressAndWord(input);
      input.expectedVarHash = [...ZERO_INPUT_HASH];
      await circuit.expectPass(input);
    },
    60_000
  );
});
