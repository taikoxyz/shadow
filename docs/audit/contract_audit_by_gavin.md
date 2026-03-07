# Gavin Contract Review

## Scope
- `packages/contracts/src/impl/Shadow.sol`
- `packages/contracts/src/impl/ShadowVerifier.sol`
- `packages/contracts/src/impl/Risc0CircuitVerifier.sol`
- Related interfaces/tests for behavior confirmation

## Validation Performed
- Static review of core claim/verification paths
- Ran contract test suite: `pnpm contracts:test` (54 passed, 0 failed)

## Findings

### 1. Missing chain-id guard in `ShadowVerifier` creates integration footgun
- Severity: **Medium**
- Location: `packages/contracts/src/impl/ShadowVerifier.sol:31-45`
- Description:
  - `ShadowVerifier.verifyProof(...)` does not validate `_input.chainId` against `block.chainid`.
  - Today, `Shadow.claim(...)` enforces this (`Shadow.sol:76`), so the current main flow is safe.
  - However, `ShadowVerifier` is externally callable and can be reused by other entrypoints/integrations. Any integration that skips the `Shadow` guard can accidentally accept cross-chain-mismatched inputs.
- Impact:
  - Replay/mis-binding risk in future integrations that call `ShadowVerifier` directly.
- Recommendation:
  - Add an explicit chain-id check inside `ShadowVerifier` for defense-in-depth, or document/enforce that all callers must pre-validate chain id.

### 2. No on-chain hard cap for amount despite security rationale claiming 8 ETH bound
- Severity: **Low**
- Location: `packages/contracts/src/impl/Shadow.sol:70-78`
- Description:
  - The contract comments rely on circuit-enforced max total deposit (8 ETH), but `claim` does not enforce any max amount on-chain.
  - If verifier logic is ever replaced/upgraded incorrectly, there is no local guardrail against oversized minting.
- Impact:
  - Enlarged blast radius under verifier misconfiguration/upgrade incidents.
- Recommendation:
  - Add a conservative on-chain upper bound for `_input.amount` aligned with protocol assumptions, or clearly classify this as an intentional trust decision.

### 3. UUPS upgrades can silently replace trusted immutable dependencies
- Severity: **Low**
- Location:
  - `packages/contracts/src/impl/Shadow.sol:14-21,31-39`
  - `packages/contracts/test/Shadow.t.sol:307-316`
- Description:
  - `verifier`, `etherMinter`, and `feeRecipient` are immutable per implementation, but UUPS upgrades allow deploying a new implementation with different constructor immutables.
  - Test coverage explicitly confirms dependency change via upgrade (`test_upgradeToAndCall_succeedsAndUpdatesFeeRecipient`).
- Impact:
  - Governance key can change trust anchors in one upgrade step; operational and governance risk rather than immediate code bug.
- Recommendation:
  - Add governance controls (timelock/multisig policy/change events) around upgrades, and monitor dependency diffs in upgrade procedures.

## Notes
- No critical exploit was identified in current tested paths.
- Claim path ordering (checks -> verifier -> consume nullifier -> mint) is sound under revert semantics and non-reentrancy.
