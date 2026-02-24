# Taiko Shadow Prover - Docker Image

Generate zero-knowledge proofs for Shadow Protocol deposits using Docker.

## Quick Start

```bash
# Pull the image
docker pull ghcr.io/taikoxyz/taiko-shadow:latest

# Generate proofs for all notes in your deposit file
docker run --rm -v $(pwd):/data ghcr.io/taikoxyz/taiko-shadow:latest /data/my-deposit.json
```

**Output:** Creates `my-deposit-proofs.json` in the same directory.

## Supported Networks

| Network | Chain ID | Status |
|---------|----------|--------|
| Taiko Mainnet | 167000 | Proof generation supported |
| Hoodi Testnet | 167013 | Fully supported (contract deployed) |

The network is automatically detected from the `chainId` in your deposit file.

## Usage

### Basic Usage

```bash
docker run --rm \
  -v $(pwd):/data \
  ghcr.io/taikoxyz/taiko-shadow:latest \
  /data/deposit.json
```

### With Custom RPC

```bash
docker run --rm \
  -v $(pwd):/data \
  -e RPC_URL=https://your-custom-rpc.example.com \
  ghcr.io/taikoxyz/taiko-shadow:latest \
  /data/deposit.json
```

### Verbose Output

```bash
docker run --rm \
  -v $(pwd):/data \
  -e VERBOSE=true \
  ghcr.io/taikoxyz/taiko-shadow:latest \
  /data/deposit.json
```

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `RPC_URL` | Override the RPC endpoint | Auto-detected from chainId |
| `VERBOSE` | Show detailed output | `false` |

## Output Format

The prover generates a consolidated `<name>-proofs.json` file:

```json
{
  "version": "1.0",
  "chainId": "167013",
  "network": "taiko-hoodi",
  "generatedAt": "2026-02-24T12:00:00Z",
  "noteCount": 2,
  "proofs": [
    { /* proof for note 0 */ },
    { /* proof for note 1 */ }
  ]
}
```

## Requirements

- Docker Desktop or Docker Engine
- A valid deposit file (JSON)
- Network connectivity to the Taiko RPC endpoint

**Note:** The Docker image includes all dependencies. You do not need Node.js, Rust, or Foundry installed locally.

## Building Locally

If you need to build the image locally:

```bash
cd /path/to/shadow
docker build -t taiko-shadow -f packages/risc0-prover/docker/Dockerfile .
```

**Warning:** Building takes 30+ minutes due to RISC Zero compilation.

## Troubleshooting

### "Deposit file not found"

Ensure you're mounting the correct directory and using the correct path inside the container:

```bash
# Correct - mount current directory and use /data prefix
docker run --rm -v $(pwd):/data ghcr.io/taikoxyz/taiko-shadow /data/deposit.json

# Wrong - file path doesn't match mount
docker run --rm -v $(pwd):/data ghcr.io/taikoxyz/taiko-shadow ./deposit.json
```

### "No default RPC for chainId"

Your deposit file has a `chainId` that's not recognized. Either:
1. Use a supported chain ID (167000 for mainnet, 167013 for Hoodi)
2. Set the `RPC_URL` environment variable explicitly

### Proof generation fails

1. Ensure the target address has sufficient balance
2. Check network connectivity to the RPC endpoint
3. Run with `VERBOSE=true` for detailed error messages
