---
name: shadow-protocol
description: Operate the Shadow privacy-preserving ETH claim system on Taiko without UI or user interaction. Covers the full lifecycle: creating deposit files, deriving target addresses, funding, generating ZK proofs, and submitting on-chain claims. Use when an agent needs to deposit, prove, or claim ETH through Shadow on Taiko Hoodi or Mainnet.
compatibility: Requires Node.js >=18, Docker (for Groth16 proofs), Rust toolchain (for prover build), and access to Taiko RPC.
metadata:
  author: shadow-team
  version: "1.0"
allowed-tools: Bash Read Write
---

# Shadow Protocol Skill

Shadow is a privacy-preserving ETH claim system on Taiko (Type-1 zkEVM). Users deposit ETH to a deterministically-derived "target address" and later claim notes on L2 by submitting a ZK proof — without linking the depositor and recipient.

## Overview

The full lifecycle has four stages:

1. **Create** — generate a deposit file (secret + notes)
2. **Fund** — send ETH to the derived target address
3. **Prove** — generate a ZK proof for each note
4. **Claim** — submit the proof to the Shadow contract on L2

All CLI operations go through `packages/risc0-prover/scripts/shadowcli.mjs`.

---

## Prerequisites

### 1. Install the prover binary

Run once. Builds the RISC Zero host binary.

```bash
node packages/risc0-prover/scripts/install-cli.mjs
```

The binary is placed at `packages/risc0-prover/target/release/shadow-risc0-host`.

### 2. Docker (Groth16 only)

Groth16 receipts (required for on-chain verification) use Docker. Ensure Docker is installed and running:

```bash
docker info
```

### 3. Dependencies

Install Node.js dependencies:

```bash
cd packages/risc0-prover && npm install
```

---

## Stage 1: Create a Deposit File

A deposit file is a JSON secret containing a 32-byte random secret and 1–5 notes. **Store it securely — losing it means losing the ability to claim.**

### Option A: Use the mine-deposit script (recommended)

```bash
node packages/risc0-prover/scripts/mine-deposit.mjs \
  --out deposits/my-deposit.json \
  --chain-id 167013 \
  --recipient 0xRECIPIENT_ADDRESS \
  --amount-wei 1000000000000000000 \
  --note-count 2
```

Parameters:
- `--out` — output path for the deposit JSON file
- `--chain-id` — `167013` for Hoodi testnet, `167000` for Taiko Mainnet
- `--recipient` — Ethereum address that will receive claimed ETH (20-byte hex)
- `--amount-wei` — amount per note in wei (e.g. `1000000000000000000` = 1 ETH)
- `--note-count` — number of notes (1–5); total = amount-wei × note-count (max 8 ETH total)

The script prints `targetAddress` — this is where ETH must be deposited on L1.

### Option B: Construct manually

See [references/deposit-schema.md](references/deposit-schema.md) for the v2 JSON schema.

### Validate a deposit file

```bash
node packages/risc0-prover/scripts/shadowcli.mjs validate \
  --deposit deposits/my-deposit.json
```

This prints the target address, note count, amounts, and nullifiers without making any network calls.

---

## Stage 2: Fund the Target Address

Send ETH to `targetAddress` on **L1 Ethereum** (Hoodi testnet: chain `560048`). The amount must be at least the sum of all note amounts.

- The target address is a hash-derived address with no known private key
- Deposits are plain ETH transfers — no contract interaction needed
- You can use `cast send` or any standard wallet/faucet

```bash
# Example using cast (Foundry)
cast send <targetAddress> --value <totalWei> \
  --rpc-url https://hoodi.ethpandaops.io \
  --private-key $FUNDER_KEY
```

Wait for the L1 transaction to be included and for the state root to be checkpointed on Taiko L2 before proving. Use `eth_getBlockByNumber` on L1 to confirm the balance.

---

## Stage 3: Generate ZK Proofs

### Prove all notes at once

```bash
node packages/risc0-prover/scripts/shadowcli.mjs prove-all \
  --deposit deposits/my-deposit.json
```

This generates `note-0.proof.json`, `note-1.proof.json`, etc. in the same directory as the deposit file.

### Prove a single note

```bash
node packages/risc0-prover/scripts/shadowcli.mjs prove \
  --deposit deposits/my-deposit.json \
  --note-index 0
```

### Options

| Flag | Description |
|------|-------------|
| `--rpc <url>` | L1 RPC URL (default: auto from chainId) |
| `--receipt-kind groth16` | Proof type for on-chain verify (default) |
| `--verbose` | Print detailed prover output |
| `--note-index <n>` | Which note to prove (0-indexed) |

The prover queries `eth_getBlockByNumber` and `eth_getProof` from L1 to build the Merkle-Patricia trie proof, then runs the RISC Zero circuit.

Proof output schema: see [references/proof-schema.md](references/proof-schema.md).

---

## Stage 4: Claim on L2

### Claim all notes

```bash
node packages/risc0-prover/scripts/shadowcli.mjs claim-all \
  --deposit deposits/my-deposit.json \
  --private-key $CLAIMER_KEY
```

The claimer wallet pays gas on Taiko L2 but does not need to hold the note funds. The claimed ETH is minted directly to the `recipient` address in each note.

### Claim a single note

```bash
node packages/risc0-prover/scripts/shadowcli.mjs claim \
  --proof deposits/note-0.proof.json \
  --private-key $CLAIMER_KEY
```

### Options

| Flag | Description |
|------|-------------|
| `--rpc <url>` | L2 RPC URL (default: `https://rpc.hoodi.taiko.xyz`) |
| `--shadow <addr>` | Shadow contract address (default: `0xCd45084D91bC488239184EEF39dd20bCb710e7C2`) |

The claim:
1. Checks nullifier is not consumed
2. Calls `Shadow.claim(proof, input)` on L2
3. Waits for confirmation

---

## End-to-End Automation Example

```bash
# 1. Create deposit
node packages/risc0-prover/scripts/mine-deposit.mjs \
  --out /tmp/shadow-deposit.json \
  --chain-id 167013 \
  --recipient $RECIPIENT \
  --amount-wei 500000000000000000 \
  --note-count 1

# 2. Read target address from deposit file
TARGET=$(node -e "const d=require('/tmp/shadow-deposit.json'); console.log(d.targetAddress)")
echo "Fund this address on L1: $TARGET"

# 3. (Fund $TARGET on L1 Ethereum Hoodi with >= 0.5 ETH)
# Wait for L1 state root checkpoint on L2 (~a few minutes)

# 4. Prove
node packages/risc0-prover/scripts/shadowcli.mjs prove-all \
  --deposit /tmp/shadow-deposit.json

# 5. Claim
node packages/risc0-prover/scripts/shadowcli.mjs claim-all \
  --deposit /tmp/shadow-deposit.json \
  --private-key $CLAIMER_KEY
```

---

## Chain Parameters

| Network | Chain ID | L2 RPC | L1 |
|---------|----------|--------|----|
| Taiko Hoodi (testnet) | `167013` | `https://rpc.hoodi.taiko.xyz` | Hoodi (560048) |
| Taiko Mainnet | `167000` | `https://rpc.taiko.xyz` | Ethereum Mainnet |

**Default Shadow contract (Hoodi):** `0xCd45084D91bC488239184EEF39dd20bCb710e7C2`

---

## Common Errors and Fixes

| Error | Cause | Fix |
|-------|-------|-----|
| `insufficient balance: X < Y` | Target address not funded yet | Fund the target address on L1 then wait for checkpoint |
| `nullifier already consumed` | Note was already claimed | Skip this note; check other notes |
| `host binary not found` | Prover not built | Run `node packages/risc0-prover/scripts/install-cli.mjs` |
| `Please install docker first` | Docker not running | Start Docker daemon |
| `RPC chainId mismatch` | Wrong `--rpc` for this deposit | Use L1 RPC that matches `deposit.chainId` |
| `DEPOSIT schema validation failed` | Malformed deposit file | Check [references/deposit-schema.md](references/deposit-schema.md) |
| `receipt file not found` | Intermediate file cleaned up | Re-run `prove` to regenerate the proof |

---

## Security Notes

- The deposit file contains the secret. Anyone with it can generate valid proofs — but claims still go to the bound `recipient` address.
- Never commit deposit files or private keys to version control.
- The target address has no known private key; ETH sent there can only be retrieved via the claim mechanism.
- Shadow applies a 0.1% protocol fee on each claim.
