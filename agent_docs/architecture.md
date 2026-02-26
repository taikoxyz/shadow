# Contract Architecture

## Directory Structure

```
packages/contracts/src/
├── iface/     # Interfaces (IShadow, IShadowVerifier, ICircuitVerifier, IEthMinter, IAnchor)
├── impl/      # Implementations (Shadow, ShadowVerifier, Risc0CircuitVerifier, DummyEtherMinter)
└── lib/       # Libraries (ShadowPublicInputs, OwnableUpgradeable)
```

## Core Contracts

- **`Shadow`** (`src/impl/`): Main claim contract with UUPS upgradeability. Tracks consumed nullifiers internally via `mapping(bytes32 => bool) private _consumed`
- **`ShadowVerifier`** (`src/impl/`): Fetches canonical block hash from TaikoAnchor and delegates to circuit verifier
- **`Risc0CircuitVerifier`** (`src/impl/`): Binds public inputs to RISC Zero journal
- **`DummyEtherMinter`** (`src/impl/`): Testnet mock that emits events instead of minting

## Design Patterns

- UUPS upgradeable pattern (OpenZeppelin)
- Immutable dependencies (verifier, minter, feeRecipient) for trust minimization
- Storage gaps (`uint256[49] __gap`) for upgrade safety
- Interfaces define the API, implementations hold logic
