#!/usr/bin/env node

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CIRCOMKIT_CONFIG = path.join(__dirname, "..", "circomkit.json");

function fail(message) {
  console.error(message);
  process.exit(1);
}

function main() {
  if (!fs.existsSync(CIRCOMKIT_CONFIG)) {
    fail(`Missing circomkit config at ${CIRCOMKIT_CONFIG}`);
  }

  const raw = fs.readFileSync(CIRCOMKIT_CONFIG, "utf8");
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    fail(`Invalid circomkit.json: ${err.message}`);
  }

  const protocol = String(parsed.protocol || "").toLowerCase();
  if (protocol !== "plonk") {
    fail(
      `Unsupported proving protocol '${parsed.protocol}'. ` +
        "This repository is PLONK-only (snarkjs/circomkit). " +
        "Plonk2/Plonky2 is not supported in this pipeline."
    );
  }
}

main();
