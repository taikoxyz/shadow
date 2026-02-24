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

## Docker (Easiest)

Generate proofs without installing any dependencies:

```bash
# Pull the pre-built image
docker pull ghcr.io/taikoxyz/taiko-shadow:latest

# Generate proofs for all notes
docker run --rm -v $(pwd):/data ghcr.io/taikoxyz/taiko-shadow:latest /data/my-deposit.json
```

Output: `my-deposit-proofs.json` (contains all proofs bundled)

See [Docker README](packages/risc0-prover/docker/README.md) for more options.

## Documentation

- [Protocol Specification](PRD.md) - Core protocol design
- [Privacy Model](PRIVACY.md) - Privacy guarantees and limitations
- [Deployments](DEPLOYMENT.md) - Deployed contract addresses

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
