# Shadow Development Standards

Monorepo instructions. Package-specific CLAUDE.md files override these defaults.

## Project Overview

Shadow is a privacy-preserving claim system built on Taiko (Type-1 zkEVM). Users deposit ETH on L1, generate ZK proofs of deposit inclusion, and claim on L2 without linking sender and receiver.

```
packages/
├── contracts/   # Solidity smart contracts (Foundry)
├── risc0-prover/# RISC Zero ZK prover (Rust)
├── server/      # Backend API server (Rust/Cargo)
├── ui/          # Frontend (TypeScript)
└── docs/        # Documentation
```

## Key Commands

```bash
pnpm contracts:test          # forge test -vvv
pnpm contracts:fmt           # forge fmt
pnpm ui:dev                  # frontend dev server
pnpm server:dev              # backend dev server
pnpm prover:build            # build RISC Zero prover
```

## Philosophy

- **No speculative features** — Don't add features, flags, or configuration unless users actively need them
- **No premature abstraction** — Don't create utilities until you've written the same code three times
- **Clarity over cleverness** — Prefer explicit, readable code over dense one-liners
- **Justify new dependencies** — Each dependency is attack surface and maintenance burden
- **Replace, don't deprecate** — Remove old implementations entirely. No backward-compatible shims
- **Verify at every level** — Linters, type checkers, tests as guardrails. Review your own output critically
- **Bias toward action** — Decide and move for anything easily reversed. Ask before committing to interfaces, data models, or architecture
- **Finish the job** — Handle edge cases you can see. Clean up what you touched. Don't invent new scope

## Code Quality

- ≤100 lines/function, cyclomatic complexity ≤8
- ≤5 positional params, 100-char line length
- No commented-out code — delete it
- Zero warnings policy: fix every warning, or add an inline ignore with justification
- Fail fast with clear, actionable error messages. Never swallow exceptions silently

## Environment Variables

- `DEPLOYER_KEY` — Private key for deploying contracts to Taiko Hoodi
- `ETHERSCAN_API_KEY` — API key for contract verification on Taikoscan

Never hardcode these. Always read from environment.

## Workflow

- Re-read changes before committing. Run relevant tests and linters first
- Imperative mood, ≤72 char subject line, one logical change per commit
- Never push directly to main — use feature branches and PRs
- Never commit secrets or credentials — use `.env` files (gitignored)
- PR descriptions: plain, factual language. Describe what the code does now, not alternatives

## Reference Docs

Before starting work, read the relevant docs in `agent_docs/`:

- Solidity standards → `agent_docs/solidity.md`
- Contract architecture → `agent_docs/architecture.md`
- Deploying to Taiko Hoodi → `agent_docs/deploying.md`
- Testing → `agent_docs/testing.md`
- Rust (server/prover) → `agent_docs/rust.md`
- Frontend → `agent_docs/ui.md`

## Other Documentation

- PRD: `PRD.md`
- Privacy model: `PRIVACY.md`
- Deployment guide: `DEPLOYMENT.md`
- Public inputs spec: `packages/docs/public-inputs-spec.md`
