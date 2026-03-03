# Shadow Protocol — Smart Contract Security Audit

**Auditor:** Daniel (Senior Solidity Auditor, OpenZeppelin)
**Date:** 2026-03-03
**Remediation review:** 2026-03-03
**Branch:** `dantaik/solidity-audit`
**Scope:** All Solidity files under `packages/contracts/src/`

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Scope](#2-scope)
3. [System Overview](#3-system-overview)
4. [Risk Classification](#4-risk-classification)
5. [Findings](#5-findings)
   - [H-01 — No Timelock on UUPS Upgrade Authorization](#h-01--no-timelock-on-uups-upgrade-authorization)
   - [L-01 — decodeProof Unnecessarily Public](#l-01--decodeproof-unnecessarily-public)
   - [I-01 — No Staleness Constraint on Block Number (By Design)](#i-01--no-staleness-constraint-on-block-number-by-design)
   - [I-02 — No Upper Bound on amount in the Contract](#i-02--no-upper-bound-on-amount-in-the-contract)
   - [I-03 — Mixed Endianness in Risc0CircuitVerifier](#i-03--mixed-endianness-in-risc0circuitverifier)
   - [I-04 — Type Inconsistency: chainId as uint256, blockNumber as uint64](#i-04--type-inconsistency-chainid-as-uint256-blocknumber-as-uint64)
   - [I-05 — ZeroAddress Error Sourced from Unrelated Parent Contract](#i-05--zeroaddress-error-sourced-from-unrelated-parent-contract)
   - [I-06 — Groth16Verifier Returns False on Low Gas via Assembly Return](#i-06--groth16verifier-returns-false-on-low-gas-via-assembly-return)
   - [I-07 — Silent try/catch Swallows All Errors Including OOG](#i-07--silent-trycatch-swallows-all-errors-including-oog)
6. [Gas Observations](#6-gas-observations)
7. [Positive Observations](#7-positive-observations)
8. [Appendix: File Coverage](#8-appendix-file-coverage)

---

## 1. Executive Summary

Shadow is a privacy-preserving ETH claim system deployed on Taiko Hoodi (L2). Users deposit ETH to deterministically derived addresses on L1, then claim those funds on L2 by submitting a RISC Zero ZK proof that proves account inclusion in a canonical L1 block. A nullifier prevents replay.

The contract architecture is clean and well-tested. The core `Shadow.sol` → `ShadowVerifier.sol` → `Risc0CircuitVerifier.sol` → `RiscZeroGroth16Verifier.sol` chain correctly separates concerns. Reentrancy and nullifier-double-spend protections are in place. OpenZeppelin's battle-tested UUPS and Ownable2Step patterns are used correctly.

**One High-severity issue** was identified: the UUPS upgrade path has no timelock, meaning a single compromised owner key can immediately replace the implementation. This is a critical risk once the real ETH minter is connected for production.

No re-entrancy, front-running, or cryptographic vulnerabilities were found in the core claiming flow.

| Severity | Count |
|----------|-------|
| High | 1 |
| Low | 1 |
| Informational | 7 |
| **Total** | **9** |

---

## 2. Scope

| File | Lines | Notes |
|------|-------|-------|
| `src/impl/Shadow.sol` | 97 | Core claim contract (UUPS proxy) |
| `src/impl/ShadowVerifier.sol` | 47 | Proof verifier with TaikoAnchor |
| `src/impl/Risc0CircuitVerifier.sol` | 176 | RISC Zero journal binding |
| `src/lib/ShadowPublicInputs.sol` | 64 | Public input encoding library |
| `src/lib/OwnableUpgradeable.sol` | 31 | Ownable2Step + UUPS abstraction |
| `src/iface/IShadow.sol` | 26 | Public interface |
| `src/iface/IShadowVerifier.sol` | 18 | Verifier interface |
| `src/iface/IAnchor.sol` | 7 | TaikoAnchor interface |
| `src/iface/ICircuitVerifier.sol` | 9 | Circuit verifier interface |
| `src/iface/IEthMinter.sol` | 8 | ETH minter interface |
| `src/risc0-v3/RiscZeroGroth16Verifier.sol` | 164 | RISC Zero official (vendored) |
| `src/risc0-v3/Groth16Verifier.sol` | 181 | snarkjs-generated (vendored) |
| `src/risc0-v3/StructHash.sol` | 44 | RISC Zero struct hashing (vendored) |
| `src/risc0-v3/ControlID.sol` | 11 | Control root constants (vendored) |
| `src/risc0-v3/IRiscZeroVerifier.sol` | 100 | RISC Zero interface (vendored) |

**Out of scope:** Deployment and upgrade scripts (`script/`), the RISC Zero guest program (Rust), prover infrastructure, off-chain CLI/server, and the vendored `risc0-v3/` files (audited by RISC Zero separately).

---

## 3. System Overview

```
User
 └─→ Shadow (UUPS Proxy)
       ├─ checks chainId, amount, recipient, nullifier
       ├─→ ShadowVerifier.verifyProof(proof, input)
       │     ├─ queries TaikoAnchor.blockHashes(blockNumber)  → blockHash
       │     └─→ Risc0CircuitVerifier.verifyProof(proof, publicInputs)
       │           ├─ ABI-decodes (seal, journal)
       │           ├─ validates journal fields == publicInputs
       │           └─→ RiscZeroGroth16Verifier.verify(seal, imageId, sha256(journal))
       │                 └─→ Groth16Verifier.verifyProof(...)  [BN254 pairing]
       ├─ marks nullifier consumed
       ├─→ IEthMinter.mintEth(recipient, netAmount)
       └─→ IEthMinter.mintEth(feeRecipient, fee)  [if fee > 0]
```

**Trust Assumptions:**
- `TaikoAnchor` provides canonical L1 block hashes (trusted as a Taiko system-level contract).
- RISC Zero's Groth16 trusted setup is provided by RISC Zero, Inc. (no new ceremony required).
- The `imageId` correctly identifies the intended guest program.
- The owner key is not compromised (single EOA, no multisig observed).

---

## 4. Risk Classification

| Label | Description |
|-------|-------------|
| **High** | Can directly lead to loss of funds or permanent protocol impairment |
| **Medium** | Causes significant disruption or incorrect behavior under reachable conditions |
| **Low** | Minor implementation issue; no immediate fund risk |
| **Informational** | Code quality, documentation, or design observation |

---

## 5. Findings

---

### H-01 — No Timelock on UUPS Upgrade Authorization

**Severity:** High
**File:** `src/lib/OwnableUpgradeable.sol`, line 30

**Description:**

The `_authorizeUpgrade` function allows the owner to immediately replace the `Shadow` implementation with no delay:

```solidity
function _authorizeUpgrade(address) internal override onlyOwner {}
```

Once the real `IEthMinter` (Taiko bridge) is connected, a single compromised owner key can upgrade `Shadow` to a malicious implementation that:
- Skips proof verification and mints arbitrary ETH to any address.
- Drains the fee recipient or changes the minter.
- Permanently renders nullifiers invalid.

The current test deployment uses a stub minter (no real ETH), limiting exposure. However, the production readiness gate explicitly includes connecting the real bridge minter.

**Impact:** Total loss of user funds from any claim after an owner-key compromise. This is a critical risk for production.

**Recommendation:**
1. **Immediate:** Transfer ownership to a Gnosis Safe multisig (3-of-5 or similar) before connecting the real ETH minter.
2. **Preferred:** Implement a `TimelockController` (OpenZeppelin) as the upgrade authority, enforcing a 24–72 hour delay between `upgradeTo` proposal and execution. This provides a detection and response window.
3. Document the trust model explicitly in the deployment guide.

---

### L-01 — `decodeProof` Unnecessarily Public

**Severity:** Low
**File:** `src/impl/Risc0CircuitVerifier.sol`, line 51

**Description:**

`decodeProof` is marked `external`, making it callable by any EOA or contract. `decodeAndValidateProof` is also `external` but is now guarded by `require(msg.sender == address(this), OnlyInternal())`, restricting it to internal `try/catch` invocations only:

```solidity
// Still fully public — callable by any EOA or contract:
function decodeProof(bytes calldata _proof) external pure returns (bytes memory _seal_, bytes memory _journal_) { ... }

// Protected — only callable via this.decodeAndValidateProof(...):
function decodeAndValidateProof(bytes calldata _proof, uint256[] calldata _publicInputs)
    external view returns (bytes memory seal_, bytes32 journalDigest_) {
    require(msg.sender == address(this), OnlyInternal());
    ...
}
```

The `OnlyInternal()` guard on `decodeAndValidateProof` resolves the primary concern of exposing internal validation logic to external callers. The residual issue is `decodeProof`, a pure ABI-decode utility. While it presents no direct security risk (proof data is already public calldata), this pattern still:
1. Adds external call overhead (~2100 gas per call) for the `this.decodeProof(...)` hop inside `decodeAndValidateProof`.
2. Exposes a surface that could mislead integrators about the contract's intended interface.

**Recommendation:** `decodeProof` appears to be a utility for off-chain debugging — mark it with an explicit `@dev Off-chain debugging utility; not part of the on-chain verification interface.` NatSpec comment. No further structural change is required given the `OnlyInternal()` guard already in place on `decodeAndValidateProof`.

---

### I-01 — No Staleness Constraint on Block Number (By Design)

**Severity:** Informational
**File:** `src/impl/ShadowVerifier.sol`, line 36; `PRD.md`

The `verifyProof` function accepts any `blockNumber > 0` with no freshness window. The PRD explicitly states: *"no freshness constraint is enforced (old blocks are acceptable)"* and lists this as a non-goal.

A proof generated against a very old block is valid as long as:
- The anchor still returns that block hash (TaikoAnchor's block hash retention window determines this), and
- The nullifier has not been consumed.

**Observation:** If `TaikoAnchor` eventually evicts old block hashes, proofs against evicted blocks will silently fail with `BlockHashNotFound`. This is a recoverable scenario (generate a new proof against a recent block), but users should be aware. Consider documenting the TaikoAnchor hash retention policy in `PRD.md`.

---

### I-02 — No Upper Bound on `amount` in the Contract

**Severity:** Informational
**File:** `src/iface/IShadow.sol`, line 10; `src/impl/Shadow.sol`, line 77

`amount` is a `uint256` with only a `> 0` check. The PRD states the ZK circuit enforces a maximum of 8 ETH per deposit. However, the contract itself does not enforce this upper bound. If the circuit were updated to permit larger amounts, there would be no on-chain safety net.

**Observation:** The journal reads `amount` as a 16-byte (u128) little-endian value. If `_publicInputs[_IDX_AMOUNT]` exceeds `type(uint128).max`, the journal comparison will reject the proof, providing implicit protection. Consider adding an explicit `require(_input.amount <= MAX_AMOUNT, ...)` guard to document the invariant on-chain.

---

### I-03 — Mixed Endianness in `Risc0CircuitVerifier`

**Severity:** Informational
**File:** `src/impl/Risc0CircuitVerifier.sol`, lines 103–126

The journal decoder uses little-endian for numeric fields (`_readLeUint` for `blockNumber`, `chainId`, `amount`) and big-endian for hash/address fields (`_readBytes32` via `mload`, `_readAddress` MSB-first loop). This matches the RISC Zero journal serialization format where:
- Rust integers (`u64`, `u128`) are serialized little-endian by RISC Zero's Serde implementation.
- Raw byte arrays (`[u8; 32]`, `[u8; 20]`) are serialized as-is (big-endian when viewed as Ethereum types).

This is correct but subtle. Any future change to the prover's serialization format or field types would silently produce incorrect validation.

**Recommendation:** Add explicit NatSpec to each `_read*` function documenting the expected byte layout and its correspondence to the Rust prover's `ClaimJournal` struct.

---

### I-04 — Type Inconsistency: `chainId` as `uint256`, `blockNumber` as `uint64`

**Severity:** Informational
**File:** `src/iface/IShadow.sol`, lines 8–11

```solidity
struct PublicInput {
    uint64 blockNumber;
    uint256 chainId;
    uint256 amount;
    address recipient;
    bytes32 nullifier;
}
```

`chainId` is `uint256` while `blockNumber` is `uint64`. Ethereum chain IDs fit in `uint64` (EIP-155). Using `uint256` for `chainId` is not wrong, but it creates an inconsistency and wastes calldata gas. The journal reads `chainId` as 8 bytes in the circuit, matching a `u64` representation.

**Recommendation:** Normalize `chainId` to `uint64` to match `blockNumber`, reduce calldata size, and align with `_readLeUint(..., 8)` in the circuit verifier.

---

### I-05 — `ZeroAddress` Error Sourced from Unrelated Parent Contract

**Severity:** Informational
**File:** `src/impl/Shadow.sol`, lines 33–35

```solidity
require(_verifier != address(0), ZeroAddress());
require(_etherMinter != address(0), ZeroAddress());
require(_feeRecipient != address(0), ZeroAddress());
```

The `ZeroAddress()` error is defined in `OwnableUpgradeable`, yet it is used in `Shadow`'s constructor to validate `_verifier`, `_etherMinter`, and `_feeRecipient`. While functionally correct, it implies a semantic relationship between the error and ownership that does not exist. ABI tooling that identifies error sources by contract name may mislead developers.

**Recommendation:** Define `ZeroAddress()` in `IShadow` (or a shared errors library) and import it explicitly in `Shadow`.

---

### I-06 — `Groth16Verifier` Returns False on Low Gas via Assembly Return

**Severity:** Informational
**File:** `src/risc0-v3/Groth16Verifier.sol`, lines 63–67, 77–82

The snarkjs-generated assembly uses `return(0, 0x20)` (returning `0` from the function without reverting) when a field element is out of range or an EC precompile call fails. If the caller wraps the call in a `try/catch`, this behavior is correctly handled. However, if the `Groth16Verifier` is called with insufficient gas for the BN254 pairing precompile, the precompile silently fails and the function returns `false`. This could be confused with a genuine proof failure.

This is vendored upstream code from RISC Zero. No action required at the Shadow level; document as a known characteristic of the vendored verifier.

---

### I-07 — Silent `try/catch` Swallows All Errors Including OOG

**Severity:** Informational
**File:** `src/impl/Risc0CircuitVerifier.sol`, lines 60–74

```solidity
try this.decodeAndValidateProof(_proof, _publicInputs) returns (...) {
    ...
} catch {
    return false;
}
```

The outer `catch` block swallows all errors, including out-of-gas (OOG) errors. If the transaction runs out of gas inside `decodeAndValidateProof`, the catch block will return `false` (which triggers `ProofVerificationFailed` in `Shadow`) rather than reverting the entire transaction. This means a claimer whose transaction runs out of gas will have their transaction included as a reverting claim (not a success), which is the correct outcome. However, the user may not realize the failure was gas-related rather than a genuine proof failure.

**Recommendation:** Document this behavior in the NatSpec.

---

## 6. Gas Observations

| Location | Observation |
|----------|-------------|
| `Risc0CircuitVerifier.verifyProof` | Three external `this.` calls (outer → `decodeAndValidateProof` → `decodeProof`) add ~2100 gas each for the CALL opcode overhead. Inlining these as internal functions would save ~6300 gas per verification. |
| `Risc0CircuitVerifier._readLeUint` | A loop over 8 bytes to decode `uint64` (blockNumber, chainId) can be replaced with a single `mload` + mask + byte-swap, saving ~100 gas per call. Not a priority given the Groth16 pairing dominates gas usage. |
| `ShadowPublicInputs.toArray` | Allocates a 87-element `uint256[]` on every call. In a calldata-heavy system, consider caching or computing the array in-place if `keccak256` of the array suffices as the proof input. |

---

## 7. Positive Observations

The following aspects reflect good security and engineering practice:

1. **Reentrancy protection:** `Shadow.claim` correctly uses `nonReentrant` and marks the nullifier consumed *before* external `mintEth` calls, preventing any re-entrancy attack.

2. **Nullifier-before-mint ordering:** `_consumed[_input.nullifier] = true` appears at line 85, before `mintEth` calls at lines 90–93. This CEI (Checks-Effects-Interactions) order is correct.

3. **Ownable2Step:** Two-step ownership transfer prevents accidental ownership loss from typos. Well chosen.

4. **Immutable verifier/minter/feeRecipient:** Using `immutable` for these critical addresses prevents storage slot manipulation via upgrade from silently changing them.

5. **chainId on-chain validation:** `require(_input.chainId == block.chainid, ...)` prevents cross-chain replay even if a nullifier from one chain somehow appeared on another.

6. **Emergency pause:** `whenNotPaused` on `claim` allows the owner to halt minting in emergencies (e.g., verifier bug discovered).

7. **blockHash sourced from TaikoAnchor, not calldata:** The `blockHash` is never user-supplied calldata — it is always fetched from the on-chain `TaikoAnchor`. This eliminates an entire class of public-input spoofing attacks.

8. **Fee capped at 0.1% with truncation-safe logic:** `uint256 fee = _input.amount / _FEE_DIVISOR` correctly truncates toward zero. The `if (fee > 0)` guard prevents a zero-value `mintEth` call for small amounts.

9. **Test coverage:** The test suite exercises fee boundaries, nullifier reuse, upgrade storage preservation, reentrancy, and multiple failure modes comprehensively.

10. **Storage gap:** The `uint256[49] private __gap` combined with the single `_consumed` mapping slot totals 50 Shadow-specific slots, following OpenZeppelin's gap convention correctly.

---

## 8. Appendix: File Coverage

All files under `src/` were fully read. Vendored `risc0-v3/` files were reviewed for interface correctness and integration risk but not for cryptographic soundness (RISC Zero's own audit covers those). Deployment and upgrade scripts were excluded from scope per audit terms.

---

*End of Report*

**Auditor:** Daniel
**Firm:** OpenZeppelin (Senior Solidity Auditor)
**Contact:** security@taiko.xyz (per contract header)
