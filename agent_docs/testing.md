# Testing

## Philosophy

- **Test behavior, not implementation.** If a refactor breaks tests but not code, the tests were wrong
- **Test edges and errors, not just the happy path.** Bugs live in boundaries and malformed inputs
- **Mock boundaries, not logic.** Only mock network, filesystem, time, or external services
- **Verify tests catch failures.** Break the code, confirm the test fails, then fix

## Solidity Tests (Foundry)

```bash
pnpm contracts:test                                  # all tests (forge test -vvv)
forge test --match-test test_name -vvvv              # specific test
forge test --match-path path/to/test.sol -vvvv       # specific file
```

### Naming

- Positive: `test_functionName_Description`
- Negative: `test_functionName_RevertWhen_Description`

## Rust Tests

```bash
pnpm server:test                                     # server tests
cargo test --manifest-path packages/server/Cargo.toml
cargo test --manifest-path packages/risc0-prover/Cargo.toml
```
