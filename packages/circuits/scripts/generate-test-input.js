#!/usr/bin/env node

import { writeFileSync, mkdirSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const INPUTS_DIR = join(__dirname, "..", "inputs", "shadow");

const MAX_NOTES = 5;
const MAX_PROOF_DEPTH = 9;
const MAX_NODE_BYTES = 544;

function generateZeroArray(length) {
  return new Array(length).fill("0");
}

function generate2DZeroArray(rows, cols) {
  return new Array(rows).fill(null).map(() => generateZeroArray(cols));
}

const input = {
  blockNumber: "12345678",
  chainId: "1",
  noteIndex: "0",
  amount: "1000000000000000000",
  recipient: generateZeroArray(20),
  stateRoot: generateZeroArray(32),

  secret: generateZeroArray(32),
  noteCount: "1",
  amounts: generateZeroArray(MAX_NOTES),
  recipientHashes: generate2DZeroArray(MAX_NOTES, 32),

  proofNodes: generate2DZeroArray(MAX_PROOF_DEPTH, MAX_NODE_BYTES),
  proofNodeLengths: generateZeroArray(MAX_PROOF_DEPTH),
  proofDepth: "1",
};

input.amounts[0] = "1000000000000000000";
input.secret[28] = "0";
input.secret[29] = "65";
input.secret[30] = "183";
input.secret[31] = "112";
input.stateRoot[31] = "1";
for (let i = 0; i < 32; i++) {
  input.recipientHashes[0][i] = "170";
}

mkdirSync(INPUTS_DIR, { recursive: true });
writeFileSync(join(INPUTS_DIR, "default.json"), JSON.stringify(input, null, 2));

console.log("Generated test input at inputs/shadow/default.json");
