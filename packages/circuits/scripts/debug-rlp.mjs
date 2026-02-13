import { Circomkit } from "circomkit";
import fs from "fs";
import path from "path";

const fixturesDir = path.resolve("inputs", "rlp_test");
const headerFixture = JSON.parse(fs.readFileSync(path.join(fixturesDir, "block_header.json"), "utf8"));
const accountFixture = JSON.parse(fs.readFileSync(path.join(fixturesDir, "account.json"), "utf8"));

const MAX_HEADER_BYTES = 400;
const MAX_ACCOUNT_BYTES = 256;

function padArray(arr, size) {
  const out = arr.slice();
  while (out.length < size) out.push(0);
  return out;
}

const input = {
  header: padArray(headerFixture.header, MAX_HEADER_BYTES),
  headerLength: headerFixture.headerLength,
  expectedStateRoot: hexToBytes(headerFixture.expectedStateRoot),
  expectedBlockNumber: headerFixture.expectedBlockNumber,
  account: padArray(accountFixture.account, MAX_ACCOUNT_BYTES),
  accountLength: accountFixture.accountLength,
  expectedNonce: accountFixture.expectedNonce,
  expectedBalance: accountFixture.expectedBalance,
  expectedStorageRoot: hexToBytes(accountFixture.expectedStorageRoot),
  expectedCodeHash: hexToBytes(accountFixture.expectedCodeHash),
};

function hexToBytes(hex) {
  const clean = hex.replace(/^0x/, "");
  const bytes = [];
  for (let i = 0; i < clean.length; i += 2) {
    bytes.push(parseInt(clean.slice(i, i + 2), 16));
  }
  return bytes;
}

const circomkit = new Circomkit({ verbose: false });
const circuit = await circomkit.WitnessTester(
  "rlp_test",
  {
    file: "test/RlpTest",
    template: "RlpTest",
    params: [MAX_HEADER_BYTES, MAX_ACCOUNT_BYTES],
  },
  "c"
);

try {
  const result = await circuit.compute(input, ["parsedLength", "payloadLength"]);
  console.log("parsedLength", result.parsedLength.toString());
  console.log("payloadLength", result.payloadLength.toString());
} catch (err) {
  console.error("Failed to compute witness:", err);
}
