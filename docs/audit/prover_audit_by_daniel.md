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
to public inputs. No open findings.

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
10. **Nullifier** — `nullifier = SHA256("shadow.nullifier.v1" ‖ chainId ‖ secret ‖ noteIndex ‖ notesHash)`

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

**Impact on Shadow:** Shadow uses `risc0-zkvm = "3.0.3"`. **Not affected.**

Source: [GHSA-g3qg-6746-3mg9](https://github.com/risc0/risc0/security/advisories/GHSA-g3qg-6746-3mg9)

### 4.3 CVE-2025-61588 — sys_read RCE (Fixed in 2.3.2 / 3.0.3)

A memory safety flaw in `sys_read` (the guest's host-I/O mechanism) allowed a malicious host to
write to an arbitrary memory address in the guest by crafting a response claiming to have read
more bytes than the actual buffer size. The fix landed in `risc0-zkvm 2.3.2` and `3.0.3`.

**Impact on Shadow:** Shadow was on `risc0-zkvm = "3.0.0"`. **Was affected; patched to `3.0.3`.**

Source: [GHSA-jqq4-c7wq-36h7](https://github.com/risc0/risc0/security/advisories/GHSA-jqq4-c7wq-36h7)

---

## 5. Positive Observations

The following patterns demonstrate strong security engineering:

**Nullifier design is sound.** `SHA256("shadow.nullifier.v1" ‖ chainId ‖ secret ‖ noteIndex ‖ notesHash)`
binds each note to a unique, deterministic, secret-dependent nullifier. `notesHash` commits to
the full note set, preventing cross-deposit nullifier collisions (a nullifier for note index `i`
from one deposit cannot be replayed as if it were index `i` from a different deposit with a
different note set). Different `noteIndex` values produce different nullifiers, preventing
double-claiming of the same note while allowing multiple notes per deposit. Cross-chain replay is
prevented by `chainId` binding.

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

## 6. References

- [Veridise RISC Zero Round 2 Audit (2025-04)](https://veridise.com/wp-content/uploads/2025/04/VAR-Risc0-241028-Round2-V4.pdf)
- [GHSA-g3qg-6746-3mg9 — CVE-2025-52484 (underconstrained rv32im)](https://github.com/risc0/risc0/security/advisories/GHSA-g3qg-6746-3mg9)
- [GHSA-jqq4-c7wq-36h7 — CVE-2025-61588 (sys_read RCE)](https://github.com/risc0/risc0/security/advisories/GHSA-jqq4-c7wq-36h7)
- [RISC Zero Formally Verified zkVM](https://risczero.com/blog/RISCZero-formally-verified-zkvm)
- [HackenProof: Circuit Breaker — RISC Zero missing constraint](https://hackenproof.com/blog/for-hackers/risc-zero-zkvm-missing-constraint-vulnerability)
- [Veridise blog: RISC Zero ZK-VM security](https://veridise.com/blog/audit-insights/risc-zeros-zk-vm-security-how-veridise-enabled-risc-zero-to-achieve-provable-continuous-zk-security/)
- Ethereum Yellow Paper — Appendix D (Modified Merkle-Patricia Trie)
- [RISC Zero security advisories index](https://github.com/risc0/rz-security/blob/main/audits/README.md)
