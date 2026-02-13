# Protocol Development Guide

This guide provides specific instructions for working with Taiko's smart contracts in the `packages/protocol` directory.

## 🎨 Solidity Coding Standards

### Import Conventions

- Use named imports
  - ✅ `import {Contract} from "./contract.sol"`
  - ❌ `import "./contract.sol"`

### Naming Conventions

- Private state variables and private/internal functions: prefix with underscore `_`
- Event names: use past tense (e.g., `BlockProposed`, `ProofVerified`)
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

### Design Patterns

- UUPS upgradeable pattern with OpenZeppelin
- Resolver pattern for cross-contract discovery
- Storage gaps (`uint256[50] __gap`) for upgrade safety (upgradeable contracts only)

## 🧪 Testing Methodology

**IMPORTANT**: Always use the `solidity-tester` subagent (via Task tool) for running tests, writing tests, or debugging test failures.

### Test Naming Convention

- Positive tests: `test_functionName_Description`
- Negative tests: `test_functionName_RevertWhen_Description`

### Test Structure

```solidity
// Inherit from CommonTest
contract MyTest is CommonTest {
    // Use provided test accounts: Alice, Bob, Carol, David, Emma

    function test_myFunction_succeeds() external {
        // Setup
        // Action with vm.expectEmit() for events
        // Assert storage and events
    }
}
```

### Testing best practices

- Use `vm.expectEmit()` without parameters (sets all to true)
- Prefer actual implementations instead of mocks for tests when possible. The setup should reflect the actual dependency as much as possible.

### Optimizing Gas Usage

1. Baseline: `pnpm snapshot:l1` and save results
2. Focus on reducing storage operations
3. Run `pnpm snapshot:l1` after changes
4. Compare diffs in `gas-reports/` and `snapshots/`
5. Document improvements in PR

### Debugging failed tests

```
forge test --match-test test_name -vvvv

# Check specific contract
forge test --match-path path/to/test.sol -vvvv
```

## 🔢 Unchecked Arithmetic Guidelines

### Overview

The Inbox contract and its optimized variant use unchecked blocks aggressively for gas optimization. All unchecked operations have been verified safe through:

- Bounded loop counters (limited by array lengths or configuration parameters)
- Modulo operations (mathematically cannot overflow)
- Increments with protocol invariant guarantees (e.g., proposal IDs, span counters)
- Timestamp/block number arithmetic with practical overflow impossibility

See inline comments for specific safety justifications on each unchecked block.

### IMPORTANT - Type Conversions in Unchecked Blocks

Due to aggressive use of unchecked blocks throughout these contracts, developers **MUST** explicitly cast values to their proper types before performing mathematical operations when mixing different numeric types. Without explicit casts, Solidity may perform implicit conversions that could lead to unexpected results within unchecked blocks.

**Example:**

```solidity
// ✅ CORRECT - Explicit casting
uint256(uint48Value) + uint256(anotherUint48)

// ❌ WRONG - May cause unexpected behavior
uint48Value + anotherUint48  // Could overflow in unchecked block
```

### Best Practices for Unchecked Blocks

1. **Always document safety**: Add inline comments explaining why each unchecked operation is safe
2. **Use explicit type casting**: Convert to the target type before operations
3. **Verify bounds**: Ensure all values are within safe ranges before unchecked operations
4. **Test edge cases**: Include tests for maximum values and boundary conditions
5. **Review carefully**: All unchecked blocks should be reviewed by multiple developers

## 🏛️ Upgrade Safety Guidelines

For upgradeable contracts:

1. Never modify existing storage variable order
2. Always add new variables at the end
3. Include storage gaps: `uint256[50] __gap`
4. Run `pnpm layout` before and after changes
5. Document storage layout changes in PR

---

**Note**: For monorepo-wide guidance, see root `/CLAUDE.md`
