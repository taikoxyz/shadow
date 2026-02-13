# Shadow Circuit

This directory contains the Shadow circuit implementation for privacy-preserving ETH claims.

## Circuit Overview

| Property | Value |
|----------|-------|
| Constraints | ~81M |
| Proving System | PLONK (BN128) |
| Witness Calculator | C++ (native) |

## What the Circuit Proves

1. **Note Validation**: Notes are valid (count 1-10, amounts > 0, sum ≤ 32 ETH)
2. **Target Address Derivation**: `targetAddress = sha256(MAGIC || chainId || secret || notesHash)[12:]`
3. **Recipient Binding**: Selected note's recipientHash matches `sha256(MAGIC || recipient)`
4. **State Root Binding**: Public `stateRoot` matches the provider result for `blockNumber`
5. **MPT Account Proof**: Verify account proof under stateRoot for targetAddress
6. **Balance Check**: `accountBalance >= totalNoteSum`
7. **Nullifier**: `nullifier = sha256(MAGIC || chainId || secret || noteIndex)`
8. **PoW**: `sha256(MAGIC || secret) mod 2^24 == 0`

## Implementation Notes

- `NoteSetEnforcer` combines note validation/selection to keep the main circuit tidy.
- `TargetAddressBinding` emits the keccak hash consumed by `MptProofVerifier`, so no separate witness is required.
- We rely on an `IStateRootProvider` contract to publish `stateRoot` for the provided `blockNumber`, eliminating the expensive block-header witness.

## Public Signals

```
- blockNumber: uint256 - L1 block number
- stateRoot: bytes32 - L1 state root (32 bytes)
- chainId: uint256 - Chain ID for replay protection
- noteIndex: uint256 - Index of claimed note
- amount: uint256 - Claimed amount (wei)
- recipient: address - Claim recipient (20 bytes)
- nullifier: bytes32 - Double-spend prevention
- powDigest: bytes32 - PoW verification
```

## Why C++ Witness Calculator

The circuit has ~81M constraints due to full keccak verification for MPT and block headers.
WebAssembly has practical limits of ~1-2M constraints due to browser memory constraints.

Optimizing the circuit to fit within WASM constraints would require removing in-circuit
keccak verification and exposing `targetAddress` as a public signal. This would **break
the privacy model** by making the funding address linkable to the claim recipient.

Therefore, we use a C++ witness calculator that:
- Handles 81M+ constraints efficiently
- Provides 10-100x faster witness generation than WASM
- Supports memory-mapped I/O for large constraint systems
- Compiles for Linux, macOS, and Windows (x86_64 and ARM64)

## Build Requirements

### Compilation
- C++ compiler with C++17 support (GCC 9+, Clang 10+, MSVC 2019+)
- CMake 3.16+
- 16GB+ RAM

### Proving
- 64GB+ RAM for production parameters
- Optional: GPU for rapidsnark acceleration

## Usage

PLONK is the only supported proving system for this circuit package.

```bash
# Compile circuit (generates C++ witness calculator)
npx circomkit compile shadow

# Build C++ witness calculator
cd build/shadow/shadow_cpp
make

# Setup (requires powers of tau ceremony file)
npx circomkit setup shadow    # PLONK keygen

# Generate proof
npx circomkit prove shadow    # PLONK prove

# Verify proof
npx circomkit verify shadow   # PLONK verify
```

## Cross-Platform Compilation

The C++ witness calculator compiles on all major platforms:

### Linux (x86_64/ARM64)
```bash
cd build/shadow/shadow_cpp
make
```

### macOS (x86_64/ARM64)
```bash
cd build/shadow/shadow_cpp
make
```

### Windows (MSVC)
```bash
cd build/shadow/shadow_cpp
cmake -B build -G "Visual Studio 16 2019"
cmake --build build --config Release
```

## Security Analysis

| Verification | Method |
|--------------|--------|
| Note validity | ZK (in-circuit SHA256) |
| Address derivation | ZK (in-circuit SHA256) |
| Address hash | ZK (in-circuit keccak) |
| Block hash | ZK (in-circuit keccak) |
| State root | ZK (in-circuit RLP parsing) |
| MPT proof | ZK (in-circuit keccak chain) |
| Balance check | ZK (in-circuit comparison) |
| Nullifier | ZK (in-circuit SHA256) |
| PoW | ZK (in-circuit SHA256) |

All verification is done in-circuit, providing maximum trustlessness. The on-chain
verifier only needs to verify the ZK proof and check the block hash against
`IBlockHashProvider`.
