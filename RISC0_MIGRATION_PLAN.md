# RISC Zero Migration Plan

## Goal

Migrate the proving pipeline from Circom/PLONK to RISC Zero with a local macOS prover binary, then remove all Circom code/config/data from the repository.

## Constraints

- Keep migration incremental with one logical change per commit.
- Preserve existing claim semantics where feasible in the first pass:
  - note count / note selection checks
  - recipient binding checks
  - total amount checks
  - nullifier derivation
  - PoW digest derivation
- Defer any unported cryptographic checks (such as full MPT verification) behind explicit TODO markers and fail-closed behavior.

## Commit-by-commit milestones

### Step 1 (this commit): Plan & acceptance criteria

- Add this migration plan.

Acceptance criteria:
- Plan file is in repo and used as execution checklist.

### Step 2: Introduce RISC Zero package and local prover binary

- Create `packages/risc0-prover` with:
  - guest method crate (proof logic)
  - host crate (CLI)
- Implement input/output schema compatible with existing claim shape.
- Provide CLI commands:
  - `prove`
  - `verify`
  - `inspect`

Acceptance criteria:
- `cargo build --release` produces a macOS host binary.
- Binary can produce and verify a receipt from example input.

### Step 3: Repo integration

- Add top-level npm scripts that call new RISC Zero flow.
- Update contracts/docs references from Circom to generic ZK proof pipeline and RISC Zero artifacts.
- Add migration notes for operators.

Acceptance criteria:
- `pnpm` scripts for prove/verify map to `packages/risc0-prover`.
- No CI/dev workflow depends on Circom commands.

### Step 4: End-to-end validation and operational hardening

- Run local prove + verify on sample data.
- Add input validation, clear errors, and artifact outputs.
- Capture runtime/memory notes for macOS.

Acceptance criteria:
- Reproducible local proof generation succeeds.
- Verification succeeds against generated receipt.

### Step 5: Remove Circom package and artifacts

- Delete `packages/circuits` and all Circom-specific docs/scripts/config references.
- Remove root script hooks pointing to Circom.
- Ensure workspace remains buildable.

Acceptance criteria:
- No Circom source/config/data remains in repository.
- Root scripts no longer reference `shadow-circuits`.

## Non-goals in first migration pass

- Re-creating the full Solidity verifier integration for RISC Zero in this same change set.
- Performance tuning for proving latency beyond basic local operation.
- Multi-proof composition and recursion.

## Risk management

- Keep each step committed independently for rollback.
- Keep contract interfaces verifier-agnostic during migration.
- Fail closed for unimplemented proof checks; do not silently skip security conditions.
