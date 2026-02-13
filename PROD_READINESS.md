# Shadow — Production Readiness

This checklist tracks end-to-end readiness for Shadow on **Taiko Hoodi**:

- Local proof generation (no Docker)
- On-chain verifier wiring (Taiko `ICheckpointStore` + RISC0 verifier)
- Claim execution + nullifier consumption
- Contract verification on TaikoScan (Etherscan)

## Status Summary

| Category | Status | Notes |
|----------|--------|-------|
| Core Protocol | **Ready** | All cryptographic operations verified |
| On-chain Contracts | **Ready** | Deployed and verified |
| Proof Generation | **Ready** | RISC0 Groth16 working |
| Security | **Conditional** | See blocking issues below |
| UX | **Incomplete** | Setup automation pending |

## Blocking Issues for Mainnet

| ID | Issue | Severity | Status |
|----|-------|----------|--------|
| M-1 | State root freshness not enforced | Medium | **OPEN** |
| M-2 | Privacy limitations undocumented | Medium | **OPEN** |
| M-3 | Missing E2E integration tests | Medium | **OPEN** |

See [REVIEW_1.md](./REVIEW_1.md) for detailed analysis.

---

## Checklist

### Core Protocol

- [x] **1) RISC0 guest+host proving pipeline works (no Docker)**
  - `shadow-risc0-host prove --receipt-kind groth16` succeeds using local `snarkjs` shrinkwrap.
  - **Files:** `packages/risc0-prover/host/src/main.rs`

- [x] **2) Journal format is chain-verifiable**
  - Guest commits a packed **288-byte** journal (not RISC0 serde), matching `Risc0CircuitVerifier` expectations.
  - **Files:** `packages/risc0-prover/crates/shadow-proof-core/src/lib.rs:82-101`

- [x] **3) Hoodi checkpoint flow wired**
  - Proof generation resolves a recent L1 checkpoint via Hoodi `ICheckpointStore` (`0x1670130000000000000000000000000000000005`)
  - Proof generation fetches `eth_getProof` from Hoodi L1 at the checkpoint block.
  - **Files:** `packages/contracts/script/DeployTaiko.s.sol:18`

### On-chain Deployment

- [x] **4) On-chain deployment complete (Hoodi L2)**
  - Deploy script: `packages/contracts/script/DeployTaiko.s.sol`
  - Default verifier: Taiko Hoodi RISC0 verifier (`0xd1934807041B168f383870A0d8F565aDe2DF9D7D`)
  - Image ID: `0x924fe3521927419a1f555ded0ed87883a170c21474e2a577cf8b124751f026c5`

- [x] **5) On-chain proof verification (view)**
  - `Risc0CircuitVerifier.verifyProof(bytes,uint256[])` returns `true` for a generated Groth16 proof.
  - **Files:** `packages/contracts/src/impl/Risc0CircuitVerifier.sol:60-81`

- [x] **6) Claim transaction succeeds**
  - `Shadow.claim(bytes,PublicInput)` succeeds
  - Nullifier consumed
  - `DummyEtherMinter.EthMinted` + `Shadow.Claimed` emitted
  - **Files:** `packages/contracts/src/impl/Shadow.sol:42-55`

- [x] **7) Contracts verified on TaikoScan (Etherscan API v2)**
  - Verified: `DummyEtherMinter`, `Nullifier`, `Risc0CircuitVerifier`, `ShadowVerifier`, `Shadow` (implementation), `ERC1967Proxy`

### Security Verification

- [x] **8) Public input binding verified**
  - All 8 public inputs properly constrained in circuit
  - Journal matches public inputs with field-by-field validation
  - **Files:** `packages/circuits/circuits/shadow/Shadow.circom:27-35`

- [x] **9) Nullifier double-spend prevention verified**
  - Atomic check-and-consume pattern
  - Access control on `consume()` function
  - Test coverage for reuse attempt
  - **Files:** `packages/contracts/src/impl/Nullifier.sol:23-31`

- [x] **10) Domain separation verified**
  - Magic prefixes consistent across TS/Rust/Circom
  - ChainId binding in nullifier and address derivation
  - **Files:** `packages/circuits/circuits/lib/constants.circom`

- [ ] **11) State root freshness enforced**
  - PRD requires: "blockNumber is sufficiently recent"
  - Current: Only checks `blockNumber > 0`
  - **BLOCKING:** Implement `MAX_BLOCK_AGE` check
  - **Files:** `packages/contracts/src/impl/ShadowVerifier.sol:29`

### Test Coverage

- [x] **12) Unit tests pass**
  - Contract tests: `packages/contracts/test/Shadow.t.sol`
  - Circuit tests: `packages/circuits/test/`

- [ ] **13) E2E integration tests**
  - Missing: Full deposit file -> proof generation -> claim test
  - Current: Component-level integration only

- [ ] **14) Fuzz testing**
  - Not implemented
  - Recommended for boundary conditions

### Documentation

- [ ] **15) Privacy limitations documented**
  - Required: User-facing privacy guarantees
  - What is private: target address, secret, full note set
  - What is NOT private: claim amount, recipient, timing
  - **BLOCKING:** Create user documentation

### UX

- [ ] **16) One-command setup + one-command prove UX (nice-to-have)**
  - Auto-build host binary if missing.
  - Document a single setup command that installs all prerequisites (rzup component + deps) per OS.

---

## Deployed Contract Addresses (Taiko Hoodi)

| Contract | Address | Verified |
|----------|---------|----------|
| Nullifier | TBD | Yes |
| DummyEtherMinter | TBD | Yes |
| Risc0CircuitVerifier | TBD | Yes |
| ShadowVerifier | TBD | Yes |
| Shadow (Implementation) | TBD | Yes |
| Shadow (Proxy) | TBD | Yes |

---

## Go/No-Go Decision

### Testnet: **GO**
- Core protocol is sound
- All critical paths tested
- Contracts deployed and verified

### Mainnet: **NO-GO** (until blocking issues resolved)
- M-1: State root freshness (security)
- M-2: Privacy documentation (UX/legal)
- M-3: E2E tests (confidence)

---

## References

- [PRD](./packages/docs/PRD.md)
- [REVIEW_1.md](./REVIEW_1.md) - Detailed security review
- [EIP-7503](https://eips.ethereum.org/EIPS/eip-7503) - Inspiration
