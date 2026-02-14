# Verifier Wiring Review Results

## Scope
Reviewed verifier-related Solidity code and tests:
- `src/impl/Shadow.sol`
- `src/impl/ShadowVerifier.sol`
- `src/impl/Risc0CircuitVerifier.sol`
- `src/lib/ShadowPublicInputs.sol`
- `src/iface/ICircuitVerifier.sol`
- `src/iface/IShadowVerifier.sol`
- `src/iface/IShadow.sol`
- `src/iface/ICheckpointStore.sol`
- `test/Shadow.t.sol`
- `test/ShadowVerifier.t.sol`
- `test/Risc0CircuitVerifier.t.sol`
- `test/ShadowPublicInputs.t.sol`
- `test/mocks/MockCheckpointStore.sol`

## Summary
The verification flow is cleanly separated (Shadow -> ShadowVerifier -> ICircuitVerifier). Shadow checks `chainId`, `amount`, `recipient`, and nullifier replay. ShadowVerifier validates checkpoint existence and uses the checkpoint `stateRoot` as the circuit `stateRoot` public input (it is not user-provided calldata). Public input encoding is deterministic with a contiguous 87-element layout and is documented under `docs/public-inputs.md`. `noteIndex` and PoW (`powDigest`) are enforced privately inside the zkVM guest and are not committed in the public journal.

## Findings

### 1) Checkpoint finality is implicitly trusted (LOW)
**What:** `ShadowVerifier` trusts `ICheckpointStore` entirely and does not enforce any notion of checkpoint finality or timeliness.

**Why it matters:** If the checkpoint store can return non-final or otherwise unstable roots, proofs could be validated against an unintended state. This is more a system-design assumption than a contract bug, but it should be explicit.

**Evidence:** `src/impl/ShadowVerifier.sol:29-30`

**Recommendation:** Document the checkpoint store’s guarantees (finality, immutability, and allowed ranges). If needed, expose a store-level “finalized” signal and check it here.

## Test Coverage Gaps
- No tests that validate checkpoint store finality assumptions against a live checkpoint store implementation.

## Assumptions / Open Questions
- What are the checkpoint store’s finality guarantees and update policies?
