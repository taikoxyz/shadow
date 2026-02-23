# Shadow — Production Readiness

This checklist tracks end-to-end readiness for Shadow on **Taiko Hoodi**.

## Status Summary

| Category | Status | Notes |
|----------|--------|-------|
| Core Protocol | **Ready** | All cryptographic operations verified |
| On-chain Contracts | **Ready** | Deployed and verified |
| Proof Generation | **Ready** | RISC0 Groth16 working |
| Security | **Ready** | Verified via audit |
| Documentation | **Ready** | All specs updated |

## Checklist

### Core Protocol

- [x] **1) RISC0 guest+host proving pipeline works (Groth16 requires Docker)**
  - `shadow-risc0-host prove --receipt-kind groth16` succeeds
  - **Files:** `packages/risc0-prover/host/src/main.rs`

- [x] **2) Journal format is chain-verifiable**
  - Guest commits a packed **116-byte** journal (not RISC0 serde), matching `Risc0CircuitVerifier` expectations.
  - **Files:** `packages/risc0-prover/crates/shadow-proof-core/src/lib.rs:82-101`

- [x] **3) Block hash verification wired**
  - Proof generation retrieves block hash from anchor contract at the specified block number
  - Proof generation verifies account proof against block header RLP
  - **Files:** `packages/contracts/src/impl/ShadowVerifier.sol`

### On-chain Deployment

- [x] **4) On-chain deployment complete (Hoodi)**
  - Deploy script: `packages/contracts/script/DeployTaiko.s.sol`
  - Default verifier: Taiko Hoodi RISC0 verifier (`0xd1934807041B168f383870A0d8F565aDe2DF9D7D`)
  - Image ID: `0x67e4b7b2bab50e0cbb1159f0b74cc7ffba1266fa6c516b51e6a4917fa3062a61`

- [x] **5) On-chain proof verification**
  - `Risc0CircuitVerifier.verifyProof(bytes,uint256[])` returns `true` for valid proofs
  - **Files:** `packages/contracts/src/impl/Risc0CircuitVerifier.sol`

- [x] **6) Claim transaction succeeds**
  - `Shadow.claim(bytes,PublicInput)` succeeds
  - Nullifier consumed
  - 0.1% claim fee applied
  - **Files:** `packages/contracts/src/impl/Shadow.sol`

- [x] **7) Contracts verified on TaikoScan (Etherscan API v2)**
  - Verified: `DummyEtherMinter`, `Risc0CircuitVerifier`, `ShadowVerifier`, `Shadow` (implementation), `ERC1967Proxy`

### Security Verification

- [x] **8) Public input binding verified**
  - Guest packs a fixed-length journal committed in the receipt.
  - `Risc0CircuitVerifier` validates journal fields against the 87-element public inputs array.
  - **Files:** `packages/risc0-prover/crates/shadow-proof-core/src/lib.rs`, `packages/contracts/src/impl/Risc0CircuitVerifier.sol`

- [x] **8) Nullifier double-spend prevention**
  - Atomic check-and-consume pattern
  - Test coverage for reuse attempt
  - **Files:** `packages/contracts/src/impl/Shadow.sol`

- [x] **9) Domain separation**
  - Magic prefixes consistent across components
  - ChainId binding in nullifier and address derivation

- [x] **10) Block hash verification**
  - Anchor contract provides canonical block hashes
  - ShadowVerifier validates blockHash matches anchor
  - **Files:** `packages/contracts/src/impl/ShadowVerifier.sol`

### Test Coverage

- [x] **11) Unit tests pass**
  - 56 tests passing
  - Coverage: Shadow, ShadowVerifier, Risc0CircuitVerifier, Nullifier, DummyEtherMinter, ShadowPublicInputs

- [ ] **12) E2E integration tests**
  - Full deposit -> prove -> claim flow not automated

### Documentation

- [x] **13) Public inputs specification**
  - **File:** `packages/docs/public-inputs-spec.md`

- [x] **14) Privacy limitations documented**
  - **File:** `PRD.md` (merged from PRIVACY.md)

---

## Deployed Contract Addresses (Taiko Hoodi)

| Contract | Address | Verified |
|----------|---------|----------|
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
- M-3: E2E tests (confidence)

---

## References

- [PRD](./PRD.md)
- [Public Inputs Spec](./packages/docs/public-inputs-spec.md)
- [EIP-7503](https://eips.ethereum.org/EIPS/eip-7503)