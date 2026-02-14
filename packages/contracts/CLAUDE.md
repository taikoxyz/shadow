# Shadow Contracts Development Guide

This guide provides specific instructions for working with Shadow's smart contracts in `packages/contracts`.

## 🎨 Solidity Coding Standards

### Import Conventions

- Use named imports
  - ✅ `import {Contract} from "./contract.sol"`
  - ❌ `import "./contract.sol"`

### Naming Conventions

- Private state variables and private/internal functions: prefix with underscore `_`
- Event names: use past tense (e.g., `Claimed`, `NullifierConsumed`)
- Function parameters: always start with `_`
- Return values: always end with `_`
- Use named parameters on mapping definitions

### Error Handling

- Prefer straightforward custom errors over require strings
- No natspec comments for errors
- Place errors at the end of implementation file, not in interface

### Documentation

- Use `///` for natspec comments
- External/public functions: include `@notice`
- Internal/private functions: only `@dev`
- All files (except tests): include `/// @custom:security-contact security@taiko.xyz`
- License: MIT for all Solidity files

## 🏗️ Contract Architecture

### Directory Structure

```
src/
├── iface/     # Interface contracts (IShadow, IShadowVerifier, INullifier, etc.)
├── impl/      # Implementation contracts (Shadow, ShadowVerifier, Nullifier, etc.)
└── lib/       # Libraries (ShadowPublicInputs, OwnableUpgradeable)
```

### Core Contracts

- **`Shadow`**: Main claim contract with UUPS upgradeability
- **`ShadowVerifier`**: Verifies block hash and delegates to circuit verifier
- **`Nullifier`**: Tracks consumed nullifiers to prevent replay attacks
- **`Risc0CircuitVerifier`**: Binds public inputs to RISC Zero journal

### Design Patterns

- UUPS upgradeable pattern with OpenZeppelin
- Immutable dependencies (verifier, minter, nullifier) for trust minimization
- Storage gaps (`uint256[50] __gap`) for upgrade safety

## 🧪 Testing

### Running Tests

```bash
pnpm contracts:test  # Runs forge test -vvv
```

### Test Naming Convention

- Positive tests: `test_functionName_Description`
- Negative tests: `test_functionName_RevertWhen_Description`

### Debugging Failed Tests

```bash
# Run specific test
forge test --match-test test_name -vvvv

# Run specific contract tests
forge test --match-path path/to/test.sol -vvvv
```

## 📝 Documentation

- Public input specification: `packages/docs/public-inputs-spec.md`
- PRD: `PRD.md`
- Privacy: `PRIVACY.md`
- Production readiness: `PROD_READINESS.md`

---

**Note**: For monorepo-wide guidance, see root `/CLAUDE.md`
