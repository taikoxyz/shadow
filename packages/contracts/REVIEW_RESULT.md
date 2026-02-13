# Circuit Review Results

## Scope
Reviewed circuit-related Solidity code and tests:
- `src/impl/Shadow.sol`
- `src/impl/ShadowVerifier.sol`
- `src/lib/ShadowPublicInputs.sol`
- `src/iface/ICircuitVerifier.sol`
- `src/iface/IShadowVerifier.sol`
- `src/iface/IShadow.sol`
- `src/iface/ICheckpointStore.sol`
- `test/Shadow.t.sol`
- `test/ShadowVerifier.t.sol`
- `test/mocks/MockCircuitVerifier.sol`
- `test/mocks/MockCheckpointStore.sol`

## Summary
The verification flow is cleanly separated (Shadow -> ShadowVerifier -> ICircuitVerifier) and core checks for chainId, recipient, amount, PoW digest, and nullifier replay are present. Public input encoding is deterministic with a contiguous 120-field layout. However, there are correctness/completeness risks around checkpoint handling, block number width mismatches, and PoW bit semantics. These issues should be clarified or guarded to avoid circuit/contract mismatches and edge-case bypasses.

## Findings

### 1) Block number truncation on checkpoint lookup (MEDIUM)
**What:** `IShadow.PublicInput.blockNumber` is `uint64`, but `ShadowVerifier` casts it to `uint48` when querying `ICheckpointStore` without a bounds check.

**Why it matters:** Values above `type(uint48).max` will silently truncate, potentially fetching the wrong checkpoint and allowing a proof to be checked against an unintended state root. Even if this is far in the future, it is a correctness bug with security impact if the system ever allows such inputs.

**Evidence:** `src/impl/ShadowVerifier.sol:29`

**Recommendation:** Add an explicit bounds check before casting (e.g., `_input.blockNumber <= type(uint48).max`) or align the public input type with the checkpoint store (`uint48`).

---

### 2) Checkpoint existence is not validated (MEDIUM)
**What:** `ShadowVerifier.verifyProof` only compares `expectedStateRoot` with the input state root. If `ICheckpointStore` returns a default zeroed checkpoint for unknown blocks, a proof using `stateRoot = 0x0` can pass the state root check.

**Why it matters:** This allows proofs to be verified against an unset checkpoint if the store returns the zero default (as the mock does). Unless a zero state root is explicitly impossible, this is a soundness gap.

**Evidence:**
- `src/impl/ShadowVerifier.sol:29-30`
- `test/mocks/MockCheckpointStore.sol:17-18` (returns zero struct for unset entries)

**Recommendation:** Validate checkpoint existence explicitly (e.g., require `checkpoint.blockNumber == _input.blockNumber` after widening, or require `checkpoint.stateRoot != 0x0`), or extend the interface to signal missing checkpoints.

---

### 3) PoW digest check uses trailing zeros but comment says leading zeros (MEDIUM)
**What:** `powDigestIsValid` masks the lowest 24 bits and requires them to be zero, which enforces *trailing* zero bits. The comment claims it enforces *leading* zeros.

**Why it matters:** If the circuit enforces leading zeros (typical PoW semantics), the on-chain check is inverted relative to the circuit, allowing invalid proofs or rejecting valid ones. Tests currently assume trailing zeros, so this is either a comment bug or a logic bug; it must be clarified against the circuit spec.

**Evidence:**
- `src/lib/ShadowPublicInputs.sol:38-40`
- `test/Shadow.t.sol:53` (uses `bytes32(uint256(1) << 24)` which satisfies trailing-zero check)

**Recommendation:** Confirm the intended PoW bit convention with the circuit. Either fix the comment or change the check to match the circuit’s requirement.

---

### 4) Checkpoint finality is implicitly trusted (LOW)
**What:** `ShadowVerifier` trusts `ICheckpointStore` entirely and does not enforce any notion of checkpoint finality or timeliness.

**Why it matters:** If the checkpoint store can return non-final or otherwise unstable roots, proofs could be validated against an unintended state. This is more a system-design assumption than a contract bug, but it should be explicit.

**Evidence:** `src/impl/ShadowVerifier.sol:29-30`

**Recommendation:** Document the checkpoint store’s guarantees (finality, immutability, and allowed ranges). If needed, expose a store-level “finalized” signal and check it here.

---

### 5) Public input byte order and layout assumptions are undocumented (LOW)
**What:** `ShadowPublicInputs.toArray` flattens `bytes32` and `address` values into 120 field elements using byte indexing. The byte order (most-significant byte first) and the exact index mapping are hard-coded, but there is no circuit spec or in-repo documentation confirming this layout.

**Why it matters:** If the circuit expects little-endian encoding or a different index mapping, proofs could verify incorrectly or fail. This is a completeness/documentation gap rather than a direct code defect.

**Evidence:** `src/lib/ShadowPublicInputs.sol:9-35`

**Recommendation:** Add a circuit public-input spec or a dedicated doc that states byte order, index mapping, and expected field widths. Add a test that checks serialization against known vectors from the circuit tooling.

## Test Coverage Gaps
- No tests for `blockNumber` values above `type(uint48).max`.
- No tests covering missing checkpoints returning zero values.
- No test that validates the public input serialization layout against a known-good circuit vector.
- No test to confirm PoW bit direction (leading vs trailing) with a known digest.

## Assumptions / Open Questions
- What is the authoritative circuit public input specification (layout and endianness)?
- Does `ICheckpointStore.getCheckpoint` guarantee a non-zero state root for valid checkpoints?
- Is the PoW requirement explicitly trailing zeros, or should it be leading zeros?
- What are the checkpoint store’s finality guarantees and update policies?
