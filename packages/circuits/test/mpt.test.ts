import { describe, it, expect, beforeAll } from "vitest";
import { Circomkit, WitnessTester } from "circomkit";
import fs from "fs";
import path from "path";

type Signals = [
  "stateRoot",
  "layers",
  "layerLengths",
  "numLayers",
  "addressHash",
  "expectedNonce",
  "expectedBalance",
  "expectedStorageRoot",
  "expectedCodeHash"
];

type Outputs = [];

const fixturesDir = path.join(process.cwd(), "inputs", "mpt_test");
const validFixture = JSON.parse(fs.readFileSync(path.join(fixturesDir, "valid_proof.json"), "utf8"));
const invalidRoot = JSON.parse(fs.readFileSync(path.join(fixturesDir, "invalid_root.json"), "utf8"));

const MAX_DEPTH = validFixture.layers.length;
const MAX_NODE_BYTES = validFixture.layers[0]?.length ?? 0;
const MAX_NODE_BLOCKS = Math.ceil(MAX_NODE_BYTES / 136);

const hexToBigIntString = (hex: string) => BigInt(hex).toString();

const hexToBytes = (hex: string) => {
  const clean = hex.replace(/^0x/, "");
  const bytes: number[] = [];
  for (let i = 0; i < clean.length; i += 2) {
    bytes.push(parseInt(clean.slice(i, i + 2), 16));
  }
  return bytes;
};

const buildInput = () => ({
  stateRoot: validFixture.stateRoot,
  layers: validFixture.layers,
  layerLengths: validFixture.layerLengths,
  numLayers: validFixture.numLayers,
  addressHash: validFixture.addressHash,
  expectedNonce: hexToBigIntString(validFixture.expectedNonce),
  expectedBalance: hexToBigIntString(validFixture.expectedBalance),
  expectedStorageRoot: hexToBytes(validFixture.expectedStorageRoot),
  expectedCodeHash: hexToBytes(validFixture.expectedCodeHash),
});

describe("MPT proof verifier", () => {
  let circuit: WitnessTester<Signals, Outputs>;

  beforeAll(async () => {
    const circomkit = new Circomkit({ verbose: false });
    circuit = await circomkit.WitnessTester("mpt_test", {
      file: "test/MptTest",
      template: "MptTest",
      params: [MAX_DEPTH, MAX_NODE_BYTES, MAX_NODE_BLOCKS],
    }, "c");
  }, 120_000);

  it("accepts valid proof", async () => {
    await circuit.expectPass(buildInput());
  });

  it("rejects mismatched state root", async () => {
    const input = buildInput();
    input.stateRoot = invalidRoot.stateRoot;
    await expect(circuit.expectPass(input)).rejects.toThrow();
  });

  it("rejects tampered node bytes", async () => {
    const input = buildInput();
    input.layers = input.layers.map((layer: number[], idx: number) => {
      if (idx !== 0) return layer;
      const mutated = [...layer];
      mutated[0] = (mutated[0] + 1) % 256;
      return mutated;
    });
    await expect(circuit.expectPass(input)).rejects.toThrow();
  });

  it("rejects proof when address hash mismatches path", async () => {
    const input = buildInput();
    input.addressHash = [...input.addressHash];
    const lastIndex = input.addressHash.length - 1;
    input.addressHash[lastIndex] = (input.addressHash[lastIndex] + 1) % 256;
    await expect(circuit.expectPass(input)).rejects.toThrow();
  });

  it("rejects mismatched expected balance", async () => {
    const input = buildInput();
    input.expectedBalance = "2";
    await expect(circuit.expectPass(input)).rejects.toThrow();
  });
});
