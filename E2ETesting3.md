# E2E Testing: Two-Phase Proof Generation

This document describes the testing procedure for the two-phase proof generation workflow implemented in the Shadow Protocol Docker prover.

## Overview

The proof generation has been split into two phases to avoid Docker-in-Docker complexity:

1. **Phase 1 (prove)**: Generate succinct STARK proofs - No Docker socket needed
2. **Phase 2 (compress)**: Convert STARK to Groth16 - Requires Docker socket for RISC0's STARK-to-SNARK conversion

## Architecture Changes

### Rust Host Binary (`shadow-risc0-host`)

Added new `compress` subcommand:
```bash
shadow-risc0-host compress --receipt <succinct.bin> --out <groth16.bin>
```

### Entrypoint Script

Updated to support two modes:
- `prove <deposit.json>` - Phase 1: Generate succinct receipts
- `compress <succinct.json>` - Phase 2: Compress to Groth16

### UI Changes

The UI now generates a combined two-phase command that users can copy and run:

```bash
# Two-phase proof generation for Shadow Protocol
rm -f ./deposit.json ./deposit-succinct.json ./deposit-proofs.json

# Create deposit file
cat <<'EOF' > ./deposit.json
{...deposit JSON...}
EOF

# Phase 1: Generate succinct STARK proofs (no Docker socket needed)
docker run --rm --platform linux/amd64 -v "$(pwd)":/data ghcr.io/taikoxyz/taiko-shadow:latest prove /data/deposit.json && \

# Phase 2: Compress to Groth16 (requires Docker socket for STARK-to-SNARK conversion)
docker run --rm --platform linux/amd64 -v "$(pwd)":/data -v /var/run/docker.sock:/var/run/docker.sock ghcr.io/taikoxyz/taiko-shadow:latest compress /data/deposit-succinct.json && \

# Cleanup intermediate file
rm -f ./deposit-succinct.json

# Output: ./deposit-proofs.json
```

## Test Procedure

### Prerequisites

1. Docker installed and running
2. Docker image `ghcr.io/taikoxyz/taiko-shadow:latest` pulled
3. Funded target address on Taiko Hoodi testnet

### Test Steps

#### 1. Create Test Deposit File

```bash
cat <<'EOF' > ./test-deposit.json
{
  "version": "v2",
  "chainId": "167013",
  "secret": "0x6487f67a8141cd453bd4002498bf385be7dcf9f2a8aa79c39c502389287a4801",
  "notes": [
    {
      "recipient": "0xe36C0F16d5fB473CC5181f5fb86b6Eb3299aD9cb",
      "amount": "100000000000000",
      "label": "test note"
    }
  ],
  "targetAddress": "0x4BDa934b300cd542AaE15f73D69eAAdfED5a0870"
}
EOF
```

#### 2. Run Phase 1: Generate Succinct Proofs

```bash
docker run --rm --platform linux/amd64 -e VERBOSE=true \
  -v "$(pwd)":/data \
  ghcr.io/taikoxyz/taiko-shadow:latest \
  prove /data/test-deposit.json
```

**Expected Output:**
- `[shadow] Phase 1: Generating succinct STARK proofs...`
- `[shadow] Phase 1 complete! Succinct receipts: /data/test-deposit-succinct.json`
- File `test-deposit-succinct.json` created with structure:
  ```json
  {
    "version": "1.0",
    "phase": "succinct",
    "chainId": "167013",
    "network": "taiko-hoodi",
    "noteCount": 1,
    "receipts": [...]
  }
  ```

#### 3. Run Phase 2: Compress to Groth16

```bash
docker run --rm --platform linux/amd64 -e VERBOSE=true \
  -v "$(pwd)":/data \
  -v /var/run/docker.sock:/var/run/docker.sock \
  ghcr.io/taikoxyz/taiko-shadow:latest \
  compress /data/test-deposit-succinct.json
```

**Expected Output:**
- `[shadow] Phase 2: Compressing to Groth16...`
- `[shadow] Phase 2 complete! Groth16 proofs: /data/test-deposit-proofs.json`
- File `test-deposit-proofs.json` created with structure:
  ```json
  {
    "version": "1.0",
    "phase": "groth16",
    "chainId": "167013",
    "network": "taiko-hoodi",
    "noteCount": 1,
    "proofs": [
      {
        "noteIndex": 0,
        "receipt_kind": "groth16",
        "seal_hex": "0x...",
        "journal_hex": "0x...",
        "journal": {...}
      }
    ]
  }
  ```

#### 4. Verify Combined Command Works

Run the full combined command from the UI:

```bash
rm -f ./test-deposit.json ./test-deposit-succinct.json ./test-deposit-proofs.json && \
cat <<'EOF' > ./test-deposit.json
{
  "version": "v2",
  "chainId": "167013",
  "secret": "0x6487f67a8141cd453bd4002498bf385be7dcf9f2a8aa79c39c502389287a4801",
  "notes": [
    {
      "recipient": "0xe36C0F16d5fB473CC5181f5fb86b6Eb3299aD9cb",
      "amount": "100000000000000",
      "label": "test note"
    }
  ],
  "targetAddress": "0x4BDa934b300cd542AaE15f73D69eAAdfED5a0870"
}
EOF
docker run --rm --platform linux/amd64 -e VERBOSE=true -v "$(pwd)":/data ghcr.io/taikoxyz/taiko-shadow:latest prove /data/test-deposit.json && \
docker run --rm --platform linux/amd64 -e VERBOSE=true -v "$(pwd)":/data -v /var/run/docker.sock:/var/run/docker.sock ghcr.io/taikoxyz/taiko-shadow:latest compress /data/test-deposit-succinct.json && \
rm -f ./test-deposit-succinct.json
```

**Expected:**
- Both phases complete successfully
- `test-deposit-proofs.json` created
- `test-deposit-succinct.json` cleaned up

### Validation Checks

1. **Phase field**: Succinct output has `"phase": "succinct"`, Groth16 output has `"phase": "groth16"`
2. **Receipt kind**: Final proofs have `"receipt_kind": "groth16"`
3. **Seal format**: `seal_hex` starts with verifier selector (4 bytes)
4. **Journal**: Contains valid claim data (nullifier, amount, etc.)

### Error Cases to Test

1. **Missing Docker socket in Phase 2**:
   ```bash
   docker run --rm -v "$(pwd)":/data ghcr.io/taikoxyz/taiko-shadow:latest compress /data/test-deposit-succinct.json
   ```
   Expected: `[shadow] ERROR: Docker socket not found. Mount it with: -v /var/run/docker.sock:/var/run/docker.sock`

2. **Wrong input file for compress**:
   ```bash
   docker run --rm -v "$(pwd)":/data -v /var/run/docker.sock:/var/run/docker.sock ghcr.io/taikoxyz/taiko-shadow:latest compress /data/test-deposit.json
   ```
   Expected: `[shadow] ERROR: Input must be a succinct receipts file (from 'prove' command).`

3. **Legacy mode (backward compatibility)**:
   ```bash
   docker run --rm -v "$(pwd)":/data ghcr.io/taikoxyz/taiko-shadow:latest /data/test-deposit.json
   ```
   Expected: Should work with a warning about legacy mode

## Performance Notes

- **Phase 1 (succinct)**: ~5-15 minutes per note (CPU-bound STARK generation)
- **Phase 2 (compress)**: ~2-5 minutes per note (Docker-based STARK-to-SNARK)

## Troubleshooting

### Phase 1 Fails

1. Check RPC connectivity to Taiko Hoodi
2. Verify target address has sufficient balance
3. Check deposit file format is valid

### Phase 2 Fails

1. Verify Docker socket is mounted: `-v /var/run/docker.sock:/var/run/docker.sock`
2. Check RISC0 groth16 prover image is available
3. Verify succinct receipts file exists and has correct format

### Platform Issues (Apple Silicon)

Always use `--platform linux/amd64` flag for ARM Macs. The RISC0 toolchain only supports x86_64.
