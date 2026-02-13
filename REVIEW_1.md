# Shadow Protocol - Production Readiness Review #1

**Date:** 2026-02-13
**Reviewer:** Claude Code
**Commit:** `bd3ee3b`
**Branch:** `review/prod-readiness-1`

---

## Executive Summary

Shadow is a privacy-forward ETH claim system for Taiko Hoodi that allows users to prove ownership of funds at a derived target address via ZK proofs. The system uses RISC Zero for proof generation and on-chain verification.

### Overall Assessment: **CONDITIONAL GO** (Testnet Only)

The core cryptographic protocol is sound and the implementation demonstrates solid engineering. However, several issues must be addressed before mainnet deployment.

| Category | Status | Blocking Issues |
|----------|--------|-----------------|
| Circuit Completeness | **PASS** | None |
| On-chain Verifier | **PASS** | None |
| Claiming Logic | **PASS** | 1 Medium |
| Nullifier Handling | **PASS** | None |
| Privacy Analysis | **CAUTION** | 2 Medium (documented) |
| Test Coverage | **NEEDS WORK** | Missing E2E tests |
| UX/Setup | **INCOMPLETE** | Item #8 in PROD_READINESS |

---

## Risk Summary (Ranked by Severity)

### HIGH Priority

None identified.

### MEDIUM Priority

| ID | Issue | Location | Exploit Scenario |
|----|-------|----------|------------------|
| M-1 | State root freshness not enforced | `ShadowVerifier.sol:29-40` | Stale proofs could be used with old state roots |
| M-2 | Privacy linkability via timing | System-wide | Claims can be correlated via timing analysis |
| M-3 | Calldata exposes note structure | `Shadow.sol:42` | Public input reveals note index and amount |

### LOW Priority

| ID | Issue | Location | Notes |
|----|-------|----------|-------|
| L-1 | No explicit max block age | `IShadow.sol` | PRD mentions freshness requirement |
| L-2 | Event metadata leakage | `Shadow.sol:54` | `Claimed` event exposes amount |
| L-3 | Missing integration test coverage | `test/` | No full E2E proof generation + claim test |

---

## Section A: Circuit Completeness & Soundness

### A.1 Public Input Binding

**Status: PASS**

The circuit properly constrains all public inputs:

| Public Signal | Constraint Location | Verification |
|---------------|---------------------|--------------|
| `blockNumber` | Journal binding | `Risc0CircuitVerifier.sol:109-113` |
| `stateRoot[32]` | MPT root check | `mpt.circom:169`, `lib.rs:419` |
| `chainId` | Nullifier/address derivation | `address.circom:66`, `lib.rs:251` |
| `noteIndex` | Note selection | `notes.circom:204-207` |
| `amount` | Selected note match | `notes.circom:221` |
| `recipient[20]` | Recipient hash binding | `notes.circom:222` |
| `nullifier[32]` | Output signal, hash verified | `address.circom:116` |
| `powDigest[32]` | Output signal | `address.circom:141` |

**Evidence:**
- `Shadow.circom:27-35` defines public inputs
- `NoteSetEnforcer` at line 48 enforces note binding
- `AccountStateVerifier` at line 87 enforces MPT verification

### A.2 Witness Values Constrained

**Status: PASS**

All private witness values are properly bound:

| Private Signal | Constraint | File:Line |
|----------------|------------|-----------|
| `secret[32]` | Used in address/nullifier derivation | `address.circom:34,109` |
| `noteCount` | Range [1, maxNotes] | `notes.circom:22-25` |
| `amounts[maxNotes]` | Non-zero for active notes, range < 2^128 | `notes.circom:40-46` |
| `recipientHashes` | Bound via SHA256 hash chain | `notes.circom:88-95` |
| `proofNodes` | MPT verification | `mpt.circom:159-166` |
| `proofDepth` | Layer existence check | `mpt.circom:155` |

**No unconstrained variables detected.**

### A.3 Domain Separation

**Status: PASS**

The protocol uses proper domain separation magic bytes:

| Domain | Magic String | Usage |
|--------|--------------|-------|
| Recipient Hash | `shadow.recipient.v1` | `constants.circom:9-17` |
| Target Address | `shadow.address.v1` | `constants.circom:21-28` |
| Nullifier | `shadow.nullifier.v1` | `constants.circom:33-40` |
| PoW | `shadow.pow.v1` | `constants.circom:45-52` |

**Consistency verified across:**
- TypeScript: `constants.ts:4-9`
- Rust: `lib.rs:15-18`
- Circom: `constants.circom`

### A.4 Arithmetic Constraints

**Status: PASS**

- Balance comparison uses 128-bit range check: `notes.circom:57-58`
- Total amount bounded by `MAX_TOTAL_WEI`: `notes.circom:61-64`
- Amount inputs range-constrained: `notes.circom:41-42`

---

## Section B: On-chain Verifier Correctness

### B.1 Proof Format Compatibility

**Status: PASS**

The RISC0 proof format is correctly handled:

1. **Journal Packing:** `lib.rs:82-101` produces 288-byte packed journal
2. **Journal Decoding:** `Risc0CircuitVerifier.sol:106-143` validates all fields
3. **Endianness:** Little-endian for integers, big-endian for hashes (consistent)

**Evidence:**
```solidity
// Risc0CircuitVerifier.sol:145-148
function _readLeUint(bytes memory _data, uint256 _offset, uint256 _len) private pure returns (uint256 value_) {
    for (uint256 i = 0; i < _len; ++i) {
        value_ |= uint256(uint8(_data[_offset + i])) << (8 * i);
    }
}
```

### B.2 Public Input Ordering

**Status: PASS**

Public input array structure (120 elements):

| Index | Field | Size |
|-------|-------|------|
| 0 | blockNumber | 1 |
| 1-32 | stateRoot | 32 |
| 33 | chainId | 1 |
| 34 | noteIndex | 1 |
| 35 | amount | 1 |
| 36-55 | recipient | 20 |
| 56-87 | nullifier | 32 |
| 88-119 | powDigest | 32 |

Verified consistent between:
- `ShadowPublicInputs.sol:10-17`
- `Risc0CircuitVerifier.sol:30-37`

### B.3 Verifier Bypass Prevention

**Status: PASS**

Malformed proof handling:
- `decodeAndValidateProof` uses try/catch: `Risc0CircuitVerifier.sol:67-74`
- Invalid encoding returns false, not panic
- All field mismatches produce specific errors

### B.4 Verifying Key Integrity

**Status: PASS**

- Image ID is immutable: `Risc0CircuitVerifier.sol:27`
- RISC0 verifier address is immutable: `Risc0CircuitVerifier.sol:26`
- Deploy script uses constant: `DeployTaiko.s.sol:20`

---

## Section C: Claiming Logic

### C.1 Eligibility Rules

**Status: PASS**

Claim validation in `Shadow.sol:42-55`:

```solidity
require(_input.chainId == block.chainid, ChainIdMismatch(...));
require(_input.amount > 0, InvalidAmount(...));
require(_input.recipient != address(0), InvalidRecipient(...));
require(ShadowPublicInputs.powDigestIsValid(_input.powDigest), InvalidPowDigest(...));
```

### C.2 Address Derivation

**Status: PASS**

Target address derivation is correct:

```
target = sha256(MAGIC_ADDRESS || chainId || secret || notesHash)[12:]
```

- No truncation issues (takes last 20 bytes of 32-byte hash)
- ChainId prevents cross-chain replay
- Consistent across all implementations

**Evidence:** `address.circom:24-48`, `derivations.ts:53-69`, `lib.rs:315-326`

### C.3 PoW Anti-Grinding

**Status: PASS**

PoW requirement: Last 3 bytes of `sha256(MAGIC_POW || secret)` must be zero.

- 24-bit difficulty (~16.7M attempts average)
- Prevents mass claim preparation
- Verified on-chain: `ShadowPublicInputs.sol:38-41`

### C.4 State Root Freshness (M-1)

**Status: MEDIUM ISSUE**

The PRD states:
> "State root freshness - the contract should enforce that blockNumber is sufficiently recent to prevent stale proofs."

**Current implementation does NOT enforce this:**

```solidity
// ShadowVerifier.sol:29
require(_input.blockNumber > 0, CheckpointNotFound(_input.blockNumber));
// No max age check!
```

**Risk:** Attacker could use an arbitrarily old state root where target address had sufficient balance, even if funds have since moved.

**Recommendation:** Add `require(block.number - _input.blockNumber <= MAX_BLOCK_AGE)` or similar.

---

## Section D: Nullifier Handling

### D.1 Uniqueness

**Status: PASS**

Nullifier derivation ensures uniqueness per (secret, chainId, noteIndex):

```
nullifier = sha256(MAGIC_NULLIFIER || chainId || secret || noteIndex)
```

- ChainId prevents cross-chain collision
- NoteIndex prevents same-deposit multi-claim with different indices
- Secret binds to depositor

### D.2 Double-Claim Prevention

**Status: PASS**

Atomic check-and-consume pattern:

```solidity
// Nullifier.sol:23-31
function consume(bytes32 _nullifier) external {
    if (msg.sender != shadow) revert UnauthorizedCaller(msg.sender);
    if (_consumed[_nullifier]) revert NullifierAlreadyConsumed(_nullifier);
    _consumed[_nullifier] = true;
    emit NullifierConsumed(_nullifier);
}
```

**Test coverage:** `Shadow.t.sol:191-211` verifies revert on reuse.

### D.3 Cross-Context Collision

**Status: PASS**

Domain separation via:
- Magic prefix: `shadow.nullifier.v1`
- ChainId binding
- Immutable shadow address check

### D.4 Storage Layout Safety

**Status: PASS**

`Nullifier.sol` uses simple mapping, no upgrade concerns (not upgradeable).
`Shadow.sol` uses ERC1967 proxy with proper storage gaps via `OwnableUpgradeable`.

---

## Section E: Privacy Analysis

### E.1 Deposit-Claim Linkability (M-2)

**Status: MEDIUM (Documented Limitation)**

**Privacy Guarantees:**
- Target address is cryptographically unlinkable to recipient
- Note structure (amounts, recipients) hidden in proof

**Privacy Limitations:**
1. **Timing correlation:** Deposit and claim timing can be analyzed
2. **Amount correlation:** If unique amounts used, statistical linking possible
3. **Single-use addresses:** Each target address is one-time, reducing anonymity set

**Mitigation recommendations:**
- Document privacy limitations clearly to users
- Recommend waiting periods between deposit and claim
- Encourage common amount denominations

### E.2 Metadata Leakage (M-3)

**Status: MEDIUM (Documented Limitation)**

| Leaked Data | Source | Impact |
|-------------|--------|--------|
| Claim amount | `PublicInput.amount` | Reduces anonymity set |
| Recipient address | `PublicInput.recipient` | Direct exposure |
| Note index | `PublicInput.noteIndex` | Reveals note structure |
| Block number | `PublicInput.blockNumber` | Timing information |

**Event leakage:**
```solidity
emit Claimed(_input.nullifier, _input.recipient, _input.amount);
```

All claim metadata is fully public on-chain.

### E.3 Privacy Guarantees Summary

**What IS private:**
- Target address (cannot be linked to recipient)
- Secret (never revealed)
- Full note set structure (only claimed note visible)
- Depositor identity

**What is NOT private:**
- Claim recipient
- Claim amount
- Claim timing
- Note index within set

---

## Test Coverage Analysis

### Contract Tests

| Test File | Coverage |
|-----------|----------|
| `Shadow.t.sol` | 10 test cases - good |
| `Nullifier.t.sol` | Present |
| `ShadowVerifier.t.sol` | Present |
| `Risc0CircuitVerifier.t.sol` | Present |
| `ShadowPublicInputs.t.sol` | Present |

**Missing:**
- Full E2E test with real RISC0 proof
- Fuzz testing for edge cases
- Invariant tests

### Circuit Tests

| Test File | Coverage |
|-----------|----------|
| `integration.test.ts` | Component integration |
| `mpt.test.ts` | MPT verification |
| `notes-hash-consistency.test.ts` | Hash consistency |
| `witness.test.ts` | Witness generation |

**Missing:**
- Shadow circuit compilation test
- Full proof generation test

---

## Recommendations

### Critical (Before Mainnet)

1. **Add state root freshness check** (M-1)
   - Implement `MAX_BLOCK_AGE` constant
   - Add validation in `ShadowVerifier.verifyProof`

2. **Add E2E integration tests**
   - Test full flow: deposit file -> proof generation -> claim

3. **Document privacy limitations** (M-2, M-3)
   - Create user-facing documentation
   - Clarify what is and isn't private

### Important (Before Production)

4. **Complete UX setup** (PROD_READINESS #8)
   - One-command install
   - One-command prove

5. **Add fuzz testing**
   - Test boundary conditions
   - Test malformed inputs

### Nice-to-Have

6. **Consider amount hiding**
   - Range proofs for amounts
   - Fixed denomination pools

---

## Files Reviewed

### Core Contracts
- `packages/contracts/src/impl/Shadow.sol`
- `packages/contracts/src/impl/Nullifier.sol`
- `packages/contracts/src/impl/ShadowVerifier.sol`
- `packages/contracts/src/impl/Risc0CircuitVerifier.sol`
- `packages/contracts/src/lib/ShadowPublicInputs.sol`

### Interfaces
- `packages/contracts/src/iface/IShadow.sol`
- `packages/contracts/src/iface/INullifier.sol`

### Circuits
- `packages/circuits/circuits/shadow/Shadow.circom`
- `packages/circuits/circuits/lib/notes.circom`
- `packages/circuits/circuits/lib/address.circom`
- `packages/circuits/circuits/lib/mpt.circom`
- `packages/circuits/circuits/lib/constants.circom`

### RISC0 Prover
- `packages/risc0-prover/crates/shadow-proof-core/src/lib.rs`
- `packages/risc0-prover/methods/guest/src/main.rs`

### TypeScript
- `packages/circuits/src/derivations.ts`
- `packages/circuits/src/constants.ts`

### Tests
- `packages/contracts/test/Shadow.t.sol`
- `packages/circuits/test/integration.test.ts`

---

## Appendix: PRD Requirement Checklist

| # | Requirement | Status | Evidence |
|---|-------------|--------|----------|
| 1 | Note set 1-5 notes | PASS | `notes.circom:22-25` |
| 2 | Total <= 32 ETH | PASS | `notes.circom:61-64` |
| 3 | Target address derivation | PASS | `address.circom:11-49` |
| 4 | Unspendable target | PASS | Hash derivation with no private key |
| 5 | Balance proof via MPT | PASS | `mpt.circom` |
| 6 | Nullifier prevents double-claim | PASS | `Nullifier.sol:27-28` |
| 7 | Recipient binding | PASS | `notes.circom:163-178` |
| 8 | No trusted setup | PASS | RISC0 uses STARKs |
| 9 | Local proving | PASS | `shadow-risc0-host` |
| 10 | State root freshness | **FAIL** | Not enforced (M-1) |
| 11 | Chain ID validation | PASS | `Shadow.sol:43` |
| 12 | ICheckpointStore integration | PASS | `ShadowVerifier.sol:32` |
| 13 | IEthMinter mock | PASS | `DummyEtherMinter.sol` |
