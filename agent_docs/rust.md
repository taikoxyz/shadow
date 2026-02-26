# Rust Conventions

Applies to `packages/server/` and `packages/risc0-prover/`.

## Tooling

| purpose | tool |
|---------|------|
| build & deps | `cargo` |
| lint | `cargo clippy --all-targets --all-features -- -D warnings` |
| format | `cargo fmt` |
| test | `cargo test` |

## Style

- `thiserror` for libraries, `anyhow` for applications
- `tracing` for logging (`error!`/`warn!`/`info!`/`debug!`), not `println`
- Newtypes over primitives where meaningful (`NullifierHash(u64)` not `u64`)
- Enums for state machines, not boolean flags
- `let...else` for early returns; keep happy path unindented
- No wildcard matches — explicit destructuring catches field changes

## Key Commands

```bash
pnpm server:dev       # cargo run (dev mode, port 3000)
pnpm server:build     # cargo build --release
pnpm server:test      # cargo test
pnpm prover:build     # build RISC Zero prover
pnpm prover:prove     # generate proof
```
