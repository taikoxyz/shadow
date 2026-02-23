# Shadow RISC Zero Prover

ZK proof generation for Shadow protocol claims.

## Setup

```bash
node scripts/install-cli.mjs
```

## Usage

### Generate Proofs for All Notes

```bash
node scripts/shadowcli.mjs prove-all --deposit my-deposit.json
```

### Claim All Notes

```bash
node scripts/shadowcli.mjs claim-all --deposit my-deposit.json --private-key 0x...
```

### Individual Commands

```bash
# Generate proof for one note
node scripts/shadowcli.mjs prove --deposit my-deposit.json --note-index 0

# Claim one note
node scripts/shadowcli.mjs claim --proof note-0.proof.json --private-key 0x...
```

Default RPC and contract addresses are configured for Taiko Hoodi (chainId 167013).

## Deposit File Format

```json
{
  "version": "v2",
  "chainId": "167013",
  "secret": "0x...",
  "notes": [
    { "recipient": "0x...", "amount": "1000000000000000" }
  ]
}
```

Schema: `packages/docs/data/schema/deposit.schema.json`

## Requirements

- Node.js 18+
- Rust toolchain with RISC Zero
- Docker (for Groth16 proofs)

## Notes

- Groth16 proofs require Docker (risc0-groth16 shrinkwrap)
- First build compiles Metal kernels (may take several minutes)
- Target address must be funded before proof generation
