import { describe, it, expect, beforeAll } from "vitest";
import { Circomkit, WitnessTester } from "circomkit";
import fs from "fs";
import path from "path";

type Signals = [
  "header",
  "headerLength",
  "expectedStateRoot",
  "expectedBlockNumber",
  "account",
  "accountLength",
  "expectedNonce",
  "expectedBalance",
  "expectedStorageRoot",
  "expectedCodeHash"
];

type Outputs = ["parsedLength", "payloadLength"];

const fixturesDir = path.join(process.cwd(), "inputs", "rlp_test");
const headerFixture = JSON.parse(fs.readFileSync(path.join(fixturesDir, "block_header.json"), "utf8"));
const accountFixture = JSON.parse(fs.readFileSync(path.join(fixturesDir, "account.json"), "utf8"));

const MAX_HEADER_BYTES = headerFixture.header.length;
const MAX_ACCOUNT_BYTES = accountFixture.account.length;

const hexToBytes = (hex: string) => {
  const clean = hex.replace(/^0x/, "");
  const bytes: number[] = [];
  for (let i = 0; i < clean.length; i += 2) {
    bytes.push(parseInt(clean.slice(i, i + 2), 16));
  }
  return bytes;
};

const hexToBigIntString = (hex: string) => BigInt(hex).toString();

describe("RLP decoders", () => {
  let circuit: WitnessTester<Signals, Outputs>;

  beforeAll(async () => {
    const circomkit = new Circomkit({ verbose: false });
    circuit = await circomkit.WitnessTester("rlp_test", {
      file: "test/RlpTest",
      template: "RlpTest",
      params: [MAX_HEADER_BYTES, MAX_ACCOUNT_BYTES],
    }, "c");
  }, 300_000);

  const baseInput = () => ({
    header: [
      ...headerFixture.header,
      ...new Array(Math.max(0, MAX_HEADER_BYTES - headerFixture.header.length)).fill(0),
    ],
    headerLength: headerFixture.headerLength,
    expectedStateRoot: hexToBytes(headerFixture.expectedStateRoot),
    expectedBlockNumber: hexToBigIntString(headerFixture.expectedBlockNumber),
    account: [
      ...accountFixture.account,
      ...new Array(Math.max(0, MAX_ACCOUNT_BYTES - accountFixture.account.length)).fill(0),
    ],
    accountLength: accountFixture.accountLength,
    expectedNonce: hexToBigIntString(accountFixture.expectedNonce),
    expectedBalance: hexToBigIntString(accountFixture.expectedBalance),
    expectedStorageRoot: hexToBytes(accountFixture.expectedStorageRoot),
    expectedCodeHash: hexToBytes(accountFixture.expectedCodeHash),
  });

  it("decodes header and account", async () => {
    const input = baseInput();
    await circuit.expectPass(input);
    const outputs = await circuit.compute(input, ["parsedLength", "payloadLength"]);
    expect(outputs.parsedLength.toString()).toBe(String(input.headerLength));
    expect(outputs.parsedLength.toString()).toBe(outputs.payloadLength.toString());
  });

  it("fails when header bytes are tampered", async () => {
    const input = baseInput();
    input.header = [...input.header];
    input.header[10] = (Number(input.header[10]) + 1) % 256;
    await expect(circuit.expectPass(input)).rejects.toThrow();
  });
});
