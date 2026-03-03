# Shadow ZK Prover — Circuit Audit Report

**Auditor:** Daniel
**Date:** 2026-03-03
**Scope:** RISC Zero guest circuit, Rust prover host, and on-chain journal-binding verifier contracts
**Repo:** `shadow` (monorepo, branch `dantaik/circuit-audit`)

---

## 1. Executive Summary

Shadow is a privacy-preserving ETH claim system. Users deposit ETH to a deterministically derived
target address and later claim it on Taiko L2 by submitting a RISC Zero ZK proof that proves
ownership of the private secret and sufficient balance — without linking depositor to recipient.

This audit examined the entire proof lifecycle: the RISC Zero guest circuit
(`shadow-proof-core`), the prover host library, the CLI, the deposit-file format, and the
Solidity verifier chain (`Risc0CircuitVerifier`, `ShadowVerifier`, `Shadow`).

**Overall assessment:** The cryptographic design is sound. The circuit correctly enforces all
privacy and balance guarantees. The on-chain verifier chain correctly binds the RISC Zero journal
to public inputs. One critical dependency vulnerability was found that requires an immediate
patch. Three medium findings and three low findings are also documented.

| Severity | Count |
|----------|-------|
| Critical | 1 |
| Medium | 3 |
| Low | 3 |
| Informational | 3 |

---

## 2. Scope & Methodology

**Files reviewed:**

| File | Purpose |
|------|---------|
| `packages/risc0-prover/Cargo.toml` | Dependency version pins |
| `packages/risc0-prover/crates/shadow-proof-core/src/lib.rs` | Full circuit logic (1063 lines) |
| `packages/risc0-prover/methods/guest/src/main.rs` | zkVM guest entry point |
| `packages/risc0-prover/crates/shadow-prover-lib/src/lib.rs` | Host prover library |
| `packages/risc0-prover/crates/shadow-prover-lib/src/deposit.rs` | Deposit file handling |
| `packages/risc0-prover/host/src/main.rs` | CLI |
| `packages/contracts/src/impl/Shadow.sol` | Claim entry point |
| `packages/contracts/src/impl/ShadowVerifier.sol` | Block hash validation |
| `packages/contracts/src/impl/Risc0CircuitVerifier.sol` | Journal binding + RISC0 verify |
| `packages/contracts/src/lib/ShadowPublicInputs.sol` | Public inputs encoding |
| `packages/docs/public-inputs-spec.md` | Public inputs specification |
| `PRIVACY.md`, `PRD.md`, `DEPLOYMENT.md` | Protocol documentation |

**Methodology:**

- Manual line-by-line review of all circuit and cryptographic code
- Verification that all protocol invariants (nullifier uniqueness, balance sufficiency, block hash
  authenticity) are enforced inside the guest
- Cross-referencing published RISC Zero security advisories and CVE database
- Analysis of the full on-chain verification chain for binding correctness
- Review of endianness, serialization, and journal encoding consistency

---

## 3. System Architecture Overview

### 3.1 Privacy Model

```
User creates secret + note set (up to 5 notes, each with recipient + amount)
    │
    ▼
Deterministic target address = last20(SHA256("shadow.address.v1" ‖ chainId ‖ secret ‖ notesHash))
    │
User funds targetAddress with ETH (visible on-chain)
    │
    ▼
User calls server to generate ZK proof:
  - Fetches block header and eth_getProof for targetAddress
  - Builds ClaimInput with private witnesses
  - RISC Zero guest runs evaluate_claim() and commits journal
  │
    ▼
User submits proof on Taiko L2:
  Shadow.claim(proof, publicInput)
    → ShadowVerifier fetches blockHash from TaikoAnchor (protocol contract)
    → Risc0CircuitVerifier validates journal ↔ publicInputs
    → RiscZeroGroth16Verifier verifies Groth16 seal
    → nullifier marked consumed
    → ETH minted to recipient (0.1% fee deducted)
```

### 3.2 Circuit Logic (`evaluate_claim`)

The guest program runs `evaluate_claim(&input)` and commits the resulting journal. The circuit
enforces:

1. **Note set validity** — `1 ≤ noteCount ≤ 5`, `noteIndex < noteCount`
2. **Amount binding** — `amounts[noteIndex] == input.amount` (claimed amount matches note)
3. **Recipient binding** — `recipientHashes[noteIndex] == SHA256("shadow.recipient.v1" ‖ pad(recipient))`
4. **No zero amounts** — all notes must have `amount > 0`
5. **Total cap** — `sum(amounts) ≤ 8 ETH`
6. **Block authenticity** — `keccak256(blockHeaderRLP) == blockHash`, block number extracted and verified
7. **State root derivation** — `stateRoot` extracted from block header field [3]
8. **MPT proof** — Merkle-Patricia trie proof verified from stateRoot → targetAddress
9. **Balance sufficiency** — `accountBalance ≥ sum(amounts)`
10. **Nullifier** — `nullifier = SHA256("shadow.nullifier.v1" ‖ chainId ‖ secret ‖ noteIndex)`

### 3.3 Journal Layout (116 bytes, little-endian integers)

```
[0:8]    block_number   u64 LE
[8:40]   block_hash     bytes32
[40:48]  chain_id       u64 LE
[48:64]  amount         u128 LE
[64:84]  recipient      address (20 bytes, raw)
[84:116] nullifier      bytes32
```

`note_index` is intentionally omitted — it is encoded in the nullifier, preserving privacy.

### 3.4 On-Chain Verification Chain

```
Shadow.claim()
  ├─ chainId == block.chainid
  ├─ amount > 0, recipient != 0x0
  ├─ nullifier not consumed
  └─ ShadowVerifier.verifyProof()
       ├─ blockHash = TaikoAnchor.blockHashes(blockNumber)  [protocol-guaranteed]
       ├─ publicInputs[87] = ShadowPublicInputs.toArray(input, blockHash)
       └─ Risc0CircuitVerifier.verifyProof()
            ├─ Decode (seal, journal) from ABI-encoded proof
            ├─ journal.length == 116
            ├─ All 6 journal fields == publicInputs fields (with LE ↔ BE conversion)
            ├─ journalDigest = sha256(journal)
            └─ RiscZeroGroth16Verifier.verify(seal, imageId, journalDigest)
```

Domain separation between all derived values uses versioned magic prefixes:
- `"shadow.recipient.v1"` — recipient hash
- `"shadow.address.v1"` — target address derivation
- `"shadow.nullifier.v1"` — nullifier derivation

---

## 4. Background: Recent RISC Zero Security Findings

Before reviewing the application-level code, I refreshed against the current state of RISC Zero
security research.

### 4.1 Veridise Round 2 Audit (Nov–Dec 2024)

Veridise conducted a 96 person-week audit of the RISC Zero zkVM over 16 weeks. Key findings:

- **DoDiv underconstrained** — missing constraints on quotient and remainder in the division
  circuit; an attacker could manipulate division results inside the zkVM
- **ExpandU32, DecomposeLow2, PoseidonStoreOut, PoseidonStoreState** — multiple underconstrained
  components identified
- RISC Zero responded with formal verification via Picus to prevent recurrence

Source: [Veridise audit report](https://veridise.com/wp-content/uploads/2025/04/VAR-Risc0-241028-Round2-V4.pdf)

### 4.2 CVE-2025-52484 — Underconstrained rv32im (Fixed in 2.1.0)

A missing constraint in the rv32im circuit allowed a malicious prover to treat `rs1` and `rs2`
registers as the same value for 3-register instructions (`remu`, `divu`, etc.), enabling proof
forgery. Affected: `risc0-zkvm 2.0.0–2.0.2`. Fixed in `2.1.0`.

**Impact on Shadow:** Shadow uses `risc0-zkvm = "3.0.0"`. **Not affected.**

Source: [GHSA-g3qg-6746-3mg9](https://github.com/risc0/risc0/security/advisories/GHSA-g3qg-6746-3mg9)

### 4.3 CVE-2025-61588 — sys_read RCE (Fixed in 2.3.2 / 3.0.3)

A memory safety flaw in `sys_read` (the guest's host-I/O mechanism) allowed a malicious host to
write to an arbitrary memory address in the guest by crafting a response claiming to have read
more bytes than the actual buffer size. The fix landed in `risc0-zkvm 2.3.2` and `3.0.3`.

**Impact on Shadow:** Shadow uses `risc0-zkvm = "3.0.0"`. **Affected.** See CRITICAL finding below.

Source: [GHSA-jqq4-c7wq-36h7](https://github.com/risc0/risc0/security/advisories/GHSA-jqq4-c7wq-36h7)

---

## 5. Findings

---

### [CRITICAL] C1 — CVE-2025-61588: Vulnerable risc0-zkvm version (sys_read RCE)

**File:** `packages/risc0-prover/Cargo.toml:25`
**CVE:** CVE-2025-61588

**Description:**

The workspace pins `risc0-zkvm = { version = "3.0.0", default-features = false }`. With Cargo's
SemVer resolution (`^3.0.0`), this resolves to the highest available `3.0.x` release, which
includes versions prior to the patch (`3.0.3`). At the time of audit, `3.0.0` through `3.0.2`
are in the affected range.

CVE-2025-61588 exploits a pointer arithmetic error in `sys_read` — the RISC-V syscall used by
the guest to read input from the host. A malicious host can craft a `sys_read` response claiming
to have written more bytes than the guest's allocated buffer, causing arbitrary memory writes
inside the guest address space. This allows the host to overwrite guest code, data, or the
pre-commit state, producing fraudulent journal values that pass the Groth16 seal check.

**Threat model context:** In Shadow's normal operation, the host is the trusted Shadow server.
However:

1. A compromised server (supply-chain attack, misconfiguration, insider threat) could exploit
   this to generate journals with fabricated `nullifier`, `amount`, or `recipient` values.
2. The Groth16 verifier checks the seal against the journal digest — if the journal is forged
   within the guest, the seal will still be valid because the seal is computed *over* the forged
   journal.
3. There is no on-chain defense against this because the flaw operates inside the zkVM before
   the journal is committed.

**Proof of affected path:**

```rust
// methods/guest/src/main.rs
fn main() {
    let input: ClaimInput = env::read();  // <-- sys_read is called here
    ...
    env::commit_slice(&packed);           // attacker controls what gets committed
}
```

`env::read()` calls `sys_read` internally. With CVE-2025-61588 unpatched, the host can
overwrite the guest's heap during the `env::read()` call, corrupting `input` or the stack
before `env::commit_slice` executes.

**Recommendation:** Update all `risc0-*` crates to `3.0.3`:

```toml
# packages/risc0-prover/Cargo.toml
risc0-core    = "3.0.3"
risc0-build   = "3.0.3"
risc0-groth16 = "3.0.3"
risc0-zkp     = "3.0.3"
risc0-zkvm    = { version = "3.0.3", default-features = false }
```

Then rebuild and re-derive the circuit ID, update it in `Risc0CircuitVerifier`, and redeploy.

---

### [MEDIUM] M1 — Inline MPT nodes unsupported (correctness gap)

**File:** `packages/risc0-prover/crates/shadow-proof-core/src/lib.rs:941`

**Description:**

Ethereum's Merkle-Patricia Trie allows short nodes (encoded RLP < 32 bytes) to be embedded
inline inside a parent node as a list, rather than as a 32-byte keccak hash reference. The
circuit's `decode_rlp_list_payload_items` rejects any item that is itself a list:

```rust
fn decode_rlp_list_payload_items(input: &[u8]) -> Result<Vec<&[u8]>, ClaimValidationError> {
    ...
    while cursor < end {
        let item = decode_rlp_item(input, cursor)?;
        if item.is_list {                            // <-- rejects inline nodes
            return Err(ClaimValidationError::InvalidRlpNode);
        }
        ...
    }
}
```

A branch node's 17 children can each be either empty, a 32-byte hash, or an RLP-encoded inline
node (when the child node serializes to < 32 bytes). The inline case is an RLP list item. When
such a proof is provided, the circuit returns `InvalidRlpNode` and the claim fails.

**Current impact:** Minimal on Taiko Hoodi or Ethereum mainnet, where the state trie is large
enough that account nodes are always hash-referenced. However:

- Sparse testnets with few accounts may generate inline nodes for new accounts
- A user who deposits to a freshly derived `targetAddress` with no prior state may encounter
  this if the trie is shallow at that path
- Future EIP changes to the MPT (e.g., Verkle trees migration paths) could introduce new node
  types

**Recommendation:** Handle inline list nodes in `decode_rlp_list_payload_items` by recursing
into list items to extract their payload, or pass them as-is into `node_matches_reference` for
byte-equality comparison.

---

### [MEDIUM] M2 — Dead branch in `decode_compact_nibbles`

**File:** `packages/risc0-prover/crates/shadow-proof-core/src/lib.rs:920`

**Description:**

```rust
fn decode_compact_nibbles(encoded: &[u8]) -> Result<(bool, Vec<u8>), ClaimValidationError> {
    ...
    let is_odd = (flag & 0x1) != 0;

    let mut nibbles = Vec::with_capacity(encoded.len() * 2);
    if is_odd {
        nibbles.push(encoded[0] & 0x0f);
    }

    let start = if is_odd { 1 } else { 1 };   // <-- both branches return 1
    for byte in encoded.iter().skip(start) {
        nibbles.push(byte >> 4);
        nibbles.push(byte & 0x0f);
    }
    ...
}
```

`start` is always `1` regardless of `is_odd`. The function is *accidentally* correct:
- Odd path: first nibble is pushed before the loop; loop skips byte 0 (flag byte) — correct.
- Even path: no nibble from byte 0 is pushed; loop skips byte 0 (flag byte) — correct.

The bug is not a security or correctness issue, but it signals the author believed the two paths
required different `start` values. A future maintainer could introduce an actual divergence
assuming both branches were already different, masking a real regression.

**Recommendation:** Remove the dead branch:

```rust
let start = 1;  // always skip the flag byte (byte 0)
```

Add a comment explaining why `start = 1` for both cases.

---

### [MEDIUM] M3 — Groth16 trusted setup assumption undocumented

**Files:** `PRIVACY.md`, `DEPLOYMENT.md`, `packages/contracts/src/impl/Risc0CircuitVerifier.sol`

**Description:**

The system's ultimate soundness relies on the RISC Zero Groth16 trusted setup ceremony: if the
toxic waste from the ceremony was retained by any participant, they could forge Groth16 proofs
that pass `RiscZeroGroth16Verifier.verify()` without running the circuit. This is a foundational
cryptographic assumption for all Groth16-based systems.

Neither `PRIVACY.md` nor `DEPLOYMENT.md` mentions this assumption. Users reviewing the system's
security properties will not see it documented. The Veridise audit process and RISC Zero's
public ceremony provide reasonable assurance, but the assumption should be explicit.

**Recommendation:** Add a section to `PRIVACY.md` under "Trust Assumptions":

> **RISC Zero Groth16 trusted setup:** The on-chain verifier uses a Groth16 proof system that
> requires a one-time trusted setup ceremony. If the ceremony's toxic waste was compromised,
> an attacker could forge proofs without satisfying circuit constraints. Shadow relies on
> RISC Zero's publicly conducted ceremony. See: https://www.risczero.com/blog/ceremony.

---

### [LOW] L1 — `proof_node_lengths` field is redundant

**File:** `packages/risc0-prover/crates/shadow-proof-core/src/lib.rs:33,225-235`

**Description:**

`ClaimInput` includes `proof_node_lengths: Vec<u32>`. The circuit validates:

```rust
if node.len() != *declared_len as usize {
    return Err(ClaimValidationError::ProofShapeMismatch);
}
```

This check always passes as long as the `proof_nodes` entries were correctly populated, because
the lengths can be computed from the nodes themselves. The field adds 64 * 4 = 256 bytes of
redundant data to the serialized input and increases surface area for accidental mismatches
during serialization/deserialization. It does not provide any security benefit.

**Recommendation:** Remove `proof_node_lengths` from `ClaimInput` and compute lengths inline
from `proof_nodes.iter().map(|n| n.len())`. Update the serialization format with a version bump.

---

### [LOW] L2 — No block freshness constraint

**File:** `packages/risc0-prover/crates/shadow-proof-core/src/lib.rs:729-748`

**Description:**

`parse_state_root_from_block_header` validates that `keccak256(blockHeaderRLP) == blockHash`
and that the block number matches. It does not validate that the block is recent.

The system design (PRD §4) explicitly allows proofs against historical blocks. This is by
design. However, the consequence is:

1. A user can generate a valid proof using a block from months ago when their balance was higher.
2. They can fund `targetAddress` with `X` ETH, drain it to `X - delta`, then generate a proof
   against the old block to claim `X` — but only if the old block's state reflects `X` balance.
3. This is actually prevented because the MPT proof verifies the account balance *at the proven
   block*, and the on-chain contract mints ETH to the recipient. There is no escrow — the proof
   only demonstrates that the balance existed, not that it still exists. Minting is independent.

The real risk is **balance snapshot gaming**: a user could temporarily inflate their balance
(e.g., receive ETH from a flash loan-like mechanism), prove against that block, then repay,
creating a claim for ETH they no longer hold. Since Shadow mints L2 ETH (not transfers L1 ETH),
this could result in ETH being minted without corresponding L1 collateral.

This is likely a known protocol-level concern (ETH minting authorization is separate), but the
freshness window should be explicitly discussed in documentation.

**Recommendation:** Document the block freshness assumption explicitly. If the minting contract
is backed by a bridge or escrow that only covers current balances, add a maximum block age
constraint (e.g., block must be within the last N blocks from the current L1 anchor).

---

### [LOW] L3 — `decodeAndValidateProof` is externally callable

**File:** `packages/contracts/src/impl/Risc0CircuitVerifier.sol:79`

**Description:**

The function `decodeAndValidateProof` is declared `external` to support the `try this.decodeAndValidateProof(...)` pattern inside `verifyProof`. This is a standard Solidity pattern for catching reverts. However, it exposes the validation logic as a public API endpoint:

```solidity
function decodeAndValidateProof(bytes calldata _proof, uint256[] calldata _publicInputs)
    external
    view
    returns (bytes memory seal_, bytes32 journalDigest_)
```

Since it is `view`, no state mutation is possible. A caller can invoke it to:
- Test arbitrary proofs without going through `Shadow.claim()`
- Use it as a free (in terms of on-chain effects) probe to learn whether a proof is valid

This is not exploitable for fund theft, but it does allow proof front-running analysis and
unnecessary gas consumption by griefing calls. It also exposes internals that may complicate
future upgrades.

**Recommendation:** Consider adding an access guard (`onlyThis` or `private` with an alternative
try/catch structure), or at minimum acknowledge this in documentation as an intended exposure.

---

## 6. Positive Observations

The following patterns demonstrate strong security engineering:

**Nullifier design is sound.** `SHA256("shadow.nullifier.v1" ‖ chainId ‖ secret ‖ noteIndex)`
binds each note to a unique, deterministic, secret-dependent nullifier. Different `noteIndex`
values produce different nullifiers, preventing double-claiming of the same note while allowing
multiple notes per deposit. Cross-chain replay is prevented by `chainId` binding.

**All domain separation uses versioned magic prefixes.** Three distinct prefixes for recipient
hash, address derivation, and nullifier derivation. The `v1` suffix enables future migration.

**The guest program has a single commit path.** `env::commit_slice()` is called exactly once,
unconditionally after `evaluate_claim()` succeeds. There is no conditional commit pattern that
could be exploited. Any circuit failure causes a panic, which aborts the proof without
producing a valid seal.

**Overflow protection is comprehensive.** All accumulations use `checked_add`. All RLP length
parsing uses `checked_mul`. All array accesses are bounds-checked by Rust's slice semantics.

**Nullifier is consumed before minting.** `Shadow.claim()` sets `_consumed[nullifier] = true`
before calling `etherMinter.mintEth()`. Combined with `nonReentrant`, this prevents re-entrance
exploitation even if the minter has a callback.

**`balance_gte_total` is correct for >u128 balances.** The function first checks if any of the
high 16 bytes are non-zero (implying balance > u128::MAX), returning `true` immediately. This
correctly handles the impossible-but-correct case.

**Block hash is never caller-supplied to the verifier.** `ShadowVerifier` always fetches
`blockHash` from `TaikoAnchor.blockHashes(blockNumber)`. An attacker cannot substitute a
forged block hash by manipulating `publicInput.blockHash` because the verifier overwrites it
with the protocol-guaranteed value before building the `publicInputs` array.

**Receipt is verified immediately after proving.** `prove_claim()` calls
`receipt.verify(SHADOW_CLAIM_GUEST_ID)` immediately after the prover returns. This catches
prover bugs or receipt corruption before any downstream use.

---

## 7. Recommendations Summary

| ID | Severity | File | Action | Status |
|----|----------|------|--------|--------|
| C1 | Critical | `Cargo.toml` | Bump all `risc0-*` to `3.0.3`; redeploy circuit | **Fixed** (bumped to 3.0.3) |
| M1 | Medium | `shadow-proof-core/src/lib.rs:941` | Support inline MPT list items | Open |
| M2 | Medium | `shadow-proof-core/src/lib.rs:920` | Remove dead `start` branch | **Fixed** (auto-formatted) |
| M3 | Medium | `PRIVACY.md`, `DEPLOYMENT.md` | Document Groth16 trusted setup assumption | **Fixed** (added to `PRIVACY.md`) |
| L1 | Low | `shadow-proof-core/src/lib.rs:33` | Remove `proof_node_lengths` field | **Fixed** |
| L2 | Low | Protocol docs | Document block freshness / balance snapshot risk | **Fixed** (added to `PRIVACY.md`) |
| L3 | Low | `Risc0CircuitVerifier.sol:79` | Consider access-guarding `decodeAndValidateProof` | **Fixed** (`OnlyInternal` guard added) |

---

## 8. References

- [Veridise RISC Zero Round 2 Audit (2025-04)](https://veridise.com/wp-content/uploads/2025/04/VAR-Risc0-241028-Round2-V4.pdf)
- [GHSA-g3qg-6746-3mg9 — CVE-2025-52484 (underconstrained rv32im)](https://github.com/risc0/risc0/security/advisories/GHSA-g3qg-6746-3mg9)
- [GHSA-jqq4-c7wq-36h7 — CVE-2025-61588 (sys_read RCE)](https://github.com/risc0/risc0/security/advisories/GHSA-jqq4-c7wq-36h7)
- [RISC Zero Formally Verified zkVM](https://risczero.com/blog/RISCZero-formally-verified-zkvm)
- [HackenProof: Circuit Breaker — RISC Zero missing constraint](https://hackenproof.com/blog/for-hackers/risc-zero-zkvm-missing-constraint-vulnerability)
- [Veridise blog: RISC Zero ZK-VM security](https://veridise.com/blog/audit-insights/risc-zeros-zk-vm-security-how-veridise-enabled-risc-zero-to-achieve-provable-continuous-zk-security/)
- Ethereum Yellow Paper — Appendix D (Modified Merkle-Patricia Trie)
- [RISC Zero security advisories index](https://github.com/risc0/rz-security/blob/main/audits/README.md)
