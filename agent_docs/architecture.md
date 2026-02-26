# Contract Architecture

## Directory Structure

```
packages/contracts/src/
├── iface/     # Interfaces (IShadow, IShadowVerifier, INullifier, etc.)
├── impl/      # Implementations (Shadow, ShadowVerifier, Nullifier, etc.)
└── lib/       # Libraries (ShadowPublicInputs, OwnableUpgradeable)
```

## Core Contracts

- **`Shadow`** (`src/impl/`): Main claim contract with UUPS upgradeability
- **`ShadowVerifier`** (`src/impl/`): Verifies block hash and delegates to circuit verifier
- **`Nullifier`** (`src/impl/`): Tracks consumed nullifiers to prevent replay attacks
- **`Risc0CircuitVerifier`** (`src/impl/`): Binds public inputs to RISC Zero journal

## Design Patterns

- UUPS upgradeable pattern (OpenZeppelin)
- Immutable dependencies (verifier, minter, nullifier) for trust minimization
- Storage gaps (`uint256[50] __gap`) for upgrade safety
- Interfaces define the API, implementations hold logic
