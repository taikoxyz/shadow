# Shadow Circuits

Zero-knowledge circuits for the Shadow protocol – a privacy-forward claim system on Taiko. All circuit source code is GPL-3.0 licensed; generated verifiers and proofs are not affected by the GPL.

## Prerequisites

| Requirement | Version | Notes |
|-------------|---------|-------|
| Node.js | 18+ | Required for tooling and vitest |
| pnpm | 8+ | Monorepo package manager |
| Circom | 2.2.3+ | Must be built from source on ARM64 macOS |
| Rust toolchain | Latest stable | Required for compiling Circom from source |
| GMP library | - | `brew install gmp` on macOS |
| nlohmann-json | - | `brew install nlohmann-json` on macOS |
| RAM | 32GB+ | Circuit compilation requires significant memory |

## Compilation

The shadow circuit is too large for WebAssembly (~20M constraints) and must be compiled to C++.

### Quick Start (Recommended)

For ARM64 macOS (Apple Silicon), use the provided build script:

```bash
cd packages/circuits
pnpm install
./scripts/build-shadow-cpp.sh   # compiles circuit + builds C++ witness generator
PTAU_SIZE=25 pnpm ptau:download # download Powers of Tau (one-time, larger default)
pnpm setup:plonk                # generate proving/verification keys (PLONK only)
```

### Manual Compilation

If you need to compile manually or are on a different platform:

#### 1. Install Circom 2.2.3+ from source

```bash
# Required for ARM64 macOS to get native binaries
cargo install --git https://github.com/iden3/circom.git --tag v2.2.3
```

#### 2. Install build dependencies

```bash
# macOS
brew install gmp nlohmann-json

# Ubuntu/Debian
sudo apt-get install libgmp-dev nlohmann-json3-dev
```

#### 3. Compile the circuit

```bash
cd packages/circuits
mkdir -p build/shadow

# Use --no_asm flag on ARM64 macOS to avoid x86 assembly
circom circuits/main/shadow.circom \
  --r1cs --c --no_asm \
  -o build/shadow \
  -l node_modules
```

#### 4. Build the C++ witness generator

On ARM64 macOS, the generated `fr.cpp` requires patching due to type incompatibilities between `uint64_t` and GMP's `mp_limb_t`. The build script handles this automatically, but if building manually:

```bash
cd build/shadow/shadow_cpp

# Update Makefile with Homebrew paths
make CFLAGS="-I$(brew --prefix)/include" LDFLAGS="-L$(brew --prefix)/lib"

# Or link manually after compilation
g++ -o shadow *.o -L$(brew --prefix)/lib -lgmp
```

### Platform Notes

| Platform | Compilation Method | Notes |
|----------|-------------------|-------|
| ARM64 macOS (Apple Silicon) | `--c --no_asm` | Requires fr.cpp patching for GMP types |
| x86_64 macOS | `--c` | Standard C++ with x86 assembly |
| x86_64 Linux | `--c` | Standard C++ with x86 assembly |
| ARM64 Linux | `--c --no_asm` | May require similar patching |

## Proving Workflow

After compilation:

```bash
pnpm setup:plonk        # generate proving/verification keys
pnpm prove:plonk        # creates build/shadow/{proof,public}.json
pnpm verify:plonk       # verifies proof using snarkjs PLONK verifier
pnpm generate-verifier  # exports Solidity verifier + copies to contracts
```

### Helpful Scripts

| Command | Description |
|---------|-------------|
| `./scripts/build-shadow-cpp.sh` | Full ARM64 macOS build (compile + patch + make) |
| `pnpm input:real -- --deposit <file> --rpc <url> --note-index <n>` | Generate witness input JSON from a DEPOSIT file |
| `pnpm compile:test` | Compile keccak/mpt/rlp test circuits |
| `pnpm test:unit` | Runs keccak/mpt/rlp/witness/etc. vitest suites |
| `pnpm test:integration` | Runs component + shadow integration tests |
| `pnpm export-calldata` | Converts proof/public into `calldata.json` |
| `pnpm full-build` | ptau download → compile → setup → verifier |

### Deposit File Input Generation

Use a DEPOSIT file directly (supports multiple notes/recipients):

```bash
cd packages/circuits
pnpm input:real -- \
  --deposit /Users/d/Desktop/deposit-4100-9abb-20260210T113109.json \
  --rpc https://rpc.hoodi.taiko.xyz \
  --note-index 0 \
  --output inputs/shadow/deposit-4100-9abb-20260210T113109-note0.json
```

## Build Pipeline Overview

1. **Compile** – `./scripts/build-shadow-cpp.sh` produces `build/shadow/{.r1cs,.sym,shadow_cpp/}`.
2. **PTAU Download** – `PTAU_SIZE=25 pnpm ptau:download` (default 2^25 if omitted). Required once.
3. **Setup** – `pnpm setup:plonk` uses `ptau/powersOfTau28_hez_final_25.ptau` by default (override with `PTAU_SIZE` or `PTAU_FILE`).
4. **Proof/Verify** – `pnpm prove:plonk` + `pnpm verify:plonk` using snarkjs.
5. **Verifier Export** – `pnpm generate-verifier` writes `artifacts/ShadowVerifier.sol` and copies it into `packages/contracts/src/`.
6. **Calldata Export (optional)** – `pnpm export-calldata` for Foundry tests.

## Build Artifacts

After successful compilation:

```
build/shadow/
├── shadow.r1cs          # Constraint system (~4.7 GB)
├── shadow.sym           # Symbol table (~28 GB)
└── shadow_cpp/
    ├── shadow           # Native witness generator executable
    ├── shadow.cpp       # Generated circuit code
    ├── shadow.dat       # Circuit data
    └── ...              # Supporting C++ files
```

Set `CIRCOM_WITH_SYM=1` when running `./scripts/build-shadow-cpp.sh` if you need `shadow.sym` for debugging.

## Circuit Architecture

- `circuits/shadow/Shadow.circom` – orchestrates note validation, SHA256 derivations, RLP parsing, MPT verification, balance checks, and PoW.
- `circuits/lib/sha256.circom` – wrappers around circomlib’s SHA256.
- `circuits/lib/rlp.circom` – full block header + account decoders (worm-privacy derived).
- `circuits/lib/mpt.circom` – keccak-verified account proof verifier.
- `circuits/lib/keccak_wrapper.circom` – bridges to multi-block keccak.
- `circuits/lib/notes.circom` – note validation and recipient hashing.
- `src/witness.ts` – witness generator that RLP-encodes headers, parses `eth_getProof`, and pads inputs for the circuit.
- `fixtures/` – placeholder mainnet + mock proofs used by integration tests.

Key templates wired together by `Shadow.circom`:

1. **NoteSetEnforcer** – validates the configured note set (count/amount/recipient binding) and emits the canonical `notesHash`.
2. **TargetAddressBinding** – derives the Shadow funding address, hashes it via keccak, and feeds the hash into the account-proof verifier.
3. **State Root Binding** – the public `stateRoot[32]` comes from an on-chain `IStateRootProvider(blockNumber)`, so the circuit no longer needs to parse a block header.
4. **MptProofVerifier** – checks the Merkle-Patricia proof against the provided state root and enforces the balance threshold.

This split removes redundant witness inputs (no separate block header or address-hash witnesses) while keeping the circuit easier to audit.

## Constraints & Gas Estimates

| Metric | Value |
|--------|-------|
| Non-linear constraints | ~20.7M |
| Linear constraints | ~12.4M |
| Total wires | ~33M |
| Private inputs | 5,325 |
| Public outputs | 64 |

| Component | Approx. Constraints |
|-----------|--------------------|
| Keccak256 per 136-byte block | ~150k |
| SHA256 per 512 bits | ~25k |
| Block header keccak (≈5 blocks) | ~750k |
| Address keccak (20 bytes) | ~150k |
| MPT proof (≈9 layers × 4 blocks) | ~5.4M |
| RLP parsing + comparators | ~60k |

The deployed verifier is a PLONK contract generated by `snarkjs`. On L2, verifying a proof requires a single pairing check (~500–600k gas on Taiko test estimates).

This repository is PLONK-only. Groth16 and Plonk2/Plonky2 are not supported in the Circom/snarkjs pipeline used here.

## Testing

Vitest suites live in `packages/circuits/test/`.

| Suite | Command |
|-------|---------|
| All tests | `pnpm test` |
| Unit focused | `pnpm test:unit` |
| Integration (fixtures) | `pnpm test:integration` |
| Shadow witness integration | `pnpm vitest run test/shadow-integration.test.ts` |

Note: `test/rlp.test.ts` is currently skipped in CI until we can run the large RLP circuit with the C backend or a higher-memory machine.

## Contracts & Verifier

Running `pnpm generate-verifier` writes the PLONK verifier to:

```
packages/circuits/artifacts/ShadowVerifier.sol
packages/contracts/src/ShadowVerifier.sol
```

The contracts package contains a Foundry smoke test (`packages/contracts/test/ShadowVerifier.t.sol`). Use `pnpm export-calldata` to feed real proofs into the test via `build/shadow/calldata.json`.

## Directory Structure

```
packages/circuits/
├── circuits/           # Circom circuit files
│   ├── main/           # Main circuit entry points (shadow.circom)
│   ├── shadow/         # Shadow circuit components
│   ├── lib/            # Reusable circuit components
│   └── test/           # Test circuits
├── src/                # TypeScript utilities
│   └── witness.ts      # Witness generation helpers
├── test/               # TypeScript tests
├── inputs/             # Circuit input files
├── build/              # Compiled circuit artifacts
│   └── shadow/         # Shadow circuit build output
│       ├── shadow.r1cs # Constraint system
│       ├── shadow.sym  # Symbol table
│       └── shadow_cpp/ # C++ witness generator
├── artifacts/          # Generated Solidity verifiers
├── ptau/               # Powers of Tau files
└── scripts/            # CLI scripts
    └── build-shadow-cpp.sh  # ARM64 macOS build script
```

## Known Limitations

- **WebAssembly not supported**: The circuit exceeds 32-bit memory addressing limits. Must use C++ witness generator.
- **ARM64 macOS requires patching**: The generated `fr.cpp` has type incompatibilities with GMP on Apple Silicon. Use `./scripts/build-shadow-cpp.sh` which handles this automatically.
- `test/rlp.test.ts` is skipped until we can run the large circuit with a higher-memory runner.
- Fixture data under `fixtures/mainnet` currently contains deterministic placeholder vectors. Re-run `scripts/generate-fixtures.ts` with a real RPC to refresh.
- Full shadow compilation can take 30+ minutes and requires 32GB+ RAM. Plan to run in a dedicated shell.

## Troubleshooting

### "the size of memory needs addresses beyond 32 bits long"

This error means the circuit is too large for WebAssembly. Use C++ compilation instead:
```bash
./scripts/build-shadow-cpp.sh
```

### GMP library errors on macOS

Install GMP via Homebrew:
```bash
brew install gmp nlohmann-json
```

### "no matching function for call to '__gmpn_add_n'" on ARM64 macOS

The GMP type incompatibility issue. Use the build script which patches `fr.cpp`:
```bash
./scripts/build-shadow-cpp.sh
```

### nasm errors on ARM64 macOS

Don't use x86 assembly on ARM64. Compile with `--no_asm`:
```bash
circom ... --c --no_asm ...
```

## License

`packages/circuits` is licensed under GPL-3.0. See `packages/circuits/LICENSE` for the full text. This license applies to circuit source code; generated verifiers/deployments are not covered by the GPL.
