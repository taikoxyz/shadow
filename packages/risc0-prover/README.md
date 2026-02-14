# Shadow RISC Zero Prover

This package replaces the Circom proving workflow with a RISC Zero prover.

## deposit file

The canonical user input is the **deposit file**.

- Schema: `packages/docs/data/schema/deposit.schema.json`
- Example: `packages/docs/data/examples/deposit.example.json`

Minimum required fields:

- `version`: must be `v2`
- `chainId`: target chain id as a base-10 string (for Taiko Hoodi: `167013`)
- `secret`: 32-byte hex string (`0x...`)
- `notes`: 1..5 entries, each with:
  - `recipient`: 20-byte hex address
  - `amount`: wei amount as base-10 string

Optional field:

- `targetAddress`: expected derived target address (`0x...`); validation fails if it does not match computed value.

## Layout

- `crates/shadow-proof-core`: shared claim validation logic and I/O schema
- `methods/guest`: zkVM guest program
- `methods`: embedded method constants for the host
- `host`: local CLI binary for prove/verify/inspect

## Quickstart

Run from repo root:

```bash
cd packages/risc0-prover
node scripts/install-cli.mjs
```

Validate the example deposit:

```bash
node scripts/shadowcli.mjs validate \
  --deposit packages/docs/data/examples/deposit.example.json \
  --rpc https://rpc.hoodi.taiko.xyz
```

Generate a proof from the example deposit:

```bash
node scripts/shadowcli.mjs prove \
  --deposit packages/docs/data/examples/deposit.example.json \
  --rpc https://rpc.hoodi.taiko.xyz \
  --receipt-kind groth16 \
  --proof-out packages/docs/data/deposits/note-0.proof.json
```

Verify the generated proof locally (off-chain):

```bash
node scripts/shadowcli.mjs verify \
  --proof packages/docs/data/deposits/note-0.proof.json
```

Verify the generated proof against a deployed verifier (on-chain view call):

```bash
node scripts/shadowcli.mjs verify \
  --proof packages/docs/data/deposits/note-0.proof.json \
  --rpc https://rpc.hoodi.taiko.xyz \
  --verifier 0xYourVerifierAddress
```

Submit a claim transaction to a deployed `Shadow` contract:

```bash
node scripts/shadowcli.mjs claim \
  --proof packages/docs/data/deposits/note-0.proof.json \
  --shadow 0xYourShadowProxyAddress \
  --rpc https://rpc.hoodi.taiko.xyz \
  --private-key 0x...
```

## CLI details

Use `scripts/shadowcli.mjs` for the full deposit -> proof workflow.

- `validate`: validates the deposit file and recomputes target address, nullifier, and PoW digest.
- `prove`: validates deposit, uses the latest L2 block on the target RPC, fetches `debug_getRawBlock` + `eth_getProof`, derives/validates block header and state root in-circuit, runs local RISC Zero proving, writes the JSON proof note file, and deletes intermediate files by default (use `--keep-intermediate-files` to retain them).
- `verify`: if `--verifier` is provided, calls `verifyProof(bytes,uint256[])` via JSON-RPC `eth_call`; otherwise verifies off-chain using `--receipt`, embedded `risc0.receipt`, or `build/risc0/receipt.bin`.
- Proof JSON stores shared `publicInputs` at top-level; RISC Zero-specific payload stays under `risc0` (`proof`, `receipt`).

## Notes

- The first build/prove may take several minutes because Metal kernels are compiled on first use.
- Groth16 receipts require Docker to be installed and running (used by upstream `risc0-groth16` shrinkwrap).
- Guest logic validates note/recipient/nullifier/PoW invariants and performs in-guest Ethereum account MPT verification against the state root extracted from the RLP block header bound to `blockHash`.
- PoW digest is bound to the full note set: `powDigest = sha256(notesHash || secret)` (same trailing-24-zero-bits requirement).
- The target address must be funded at or above `sum(noteAmounts)` on the proof block unless `--allow-insufficient-balance` is used.
- `Shadow.claim` applies a 0.1% fee (`amount / 1000`); the note `amount` in the proof is the gross amount.
- Taiko Hoodi's deployed RISC0 verifier expects Groth16 receipts; succinct receipts will not verify on-chain.
