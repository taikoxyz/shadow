#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import snarkjs from 'snarkjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CIRCUITS_ROOT = path.join(__dirname, '..');
const BUILD_DIR = path.join(CIRCUITS_ROOT, 'build', 'shadow');
const PROOF_PATH = path.join(BUILD_DIR, 'proof.json');
const PUBLIC_PATH = path.join(BUILD_DIR, 'public.json');
const OUTPUT_PATH = path.join(BUILD_DIR, 'calldata.json');
const CIRCOMKIT_CONFIG = path.join(CIRCUITS_ROOT, 'circomkit.json');

function assertPlonk() {
  const config = JSON.parse(fs.readFileSync(CIRCOMKIT_CONFIG, 'utf8'));
  if (String(config.protocol || '').toLowerCase() !== 'plonk') {
    throw new Error(
      "Unsupported proving protocol in circomkit.json. This script is PLONK-only."
    );
  }
}

async function main() {
  assertPlonk();

  if (!fs.existsSync(PROOF_PATH) || !fs.existsSync(PUBLIC_PATH)) {
    console.error('Proof or public signals not found. Run `pnpm prove:plonk` first.');
    process.exit(1);
  }

  const proof = JSON.parse(fs.readFileSync(PROOF_PATH, 'utf8'));
  const publicSignals = JSON.parse(fs.readFileSync(PUBLIC_PATH, 'utf8'));

  const rawCalldata = await snarkjs.plonk.exportSolidityCallData(proof, publicSignals);
  const [proofCalldata, inputs] = JSON.parse(rawCalldata);

  const payload = {
    proof: proofCalldata,
    inputs,
  };

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(payload, null, 2));
  console.log(`Calldata written to ${OUTPUT_PATH}`);
}

main().catch((err) => {
  console.error('Failed to export calldata:', err);
  process.exit(1);
});
