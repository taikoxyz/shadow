# Shadow Protocol

Privacy-preserving ETH claims on Taiko L2 using zero-knowledge proofs.

## Quick Start

### 1. Mine a Deposit File

```bash
cd packages/risc0-prover
node scripts/mine-deposit.mjs \
  --out my-deposit.json \
  --chain-id 167013 \
  --recipient 0xYourAddress \
  --amount-wei 1000000000000000 \
  --note-count 2 \
  --same-recipient
```

### 2. Fund the Target Address

```bash
# Send ETH to the target address shown in the deposit file
cast send $(jq -r .targetAddress my-deposit.json) \
  --value 2100000000000000 \
  --rpc-url https://rpc.hoodi.taiko.xyz \
  --private-key 0x...
```

### 3. Generate All Proofs

```bash
node scripts/shadowcli.mjs prove-all --deposit my-deposit.json
```

### 4. Claim All Notes

```bash
node scripts/shadowcli.mjs claim-all \
  --deposit my-deposit.json \
  --private-key 0x...
```

## Deployed Contracts (Taiko Hoodi)

| Contract | Address |
|----------|---------|
| Shadow (proxy) | [`0xCd45084D91bC488239184EEF39dd20bCb710e7C2`](https://hoodi.taikoscan.io/address/0xCd45084D91bC488239184EEF39dd20bCb710e7C2) |
| ShadowVerifier | [`0x0B98084BD3e775d0c5Fa61C9E59383D7b7a45B96`](https://hoodi.taikoscan.io/address/0x0B98084BD3e775d0c5Fa61C9E59383D7b7a45B96) |

## Documentation

- [Protocol Specification](PRD.md) - Core protocol design
- [Privacy Model](PRIVACY.md) - Privacy guarantees and limitations
- [Contract Verification](how_to_verify.md) - How to verify contracts on Taikoscan

## Development

### Prerequisites

- Node.js 18+
- Rust toolchain
- Docker (for Groth16 proofs)
- Foundry

### Build

```bash
# Install dependencies
pnpm install

# Build contracts
cd packages/contracts && FOUNDRY_PROFILE=layer2 forge build

# Build prover
cd packages/risc0-prover && cargo build --release -p shadow-risc0-host
```

### Test

```bash
# Contract tests
cd packages/contracts && FOUNDRY_PROFILE=layer2 forge test

# Prover tests
cd packages/risc0-prover && cargo test --release
```

## Architecture

```
User: mines deposit → funds target → generates proofs → claims on L2
                           ↓
Shadow Contract: verifies ZK proof → mints ETH (minus 0.1% fee)
                           ↓
ZK Circuit: proves balance at target address without revealing secret
```

## Security

For security concerns, contact security@taiko.xyz
