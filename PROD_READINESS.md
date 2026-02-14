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
  - Guest commits a packed **152-byte** journal, matching `Risc0CircuitVerifier` expectations
  - **Files:** `packages/risc0-prover/crates/shadow-proof-core/src/lib.rs`

- [x] **3) Block hash verification wired**
  - Proof generation retrieves block hash from anchor contract at the specified block number
  - Proof generation verifies account proof against block header RLP
  - **Files:** `packages/contracts/src/impl/ShadowVerifier.sol`

### On-chain Deployment

- [x] **4) On-chain deployment complete (Hoodi)**
  - Deploy script: `packages/contracts/script/DeployTaiko.s.sol`
  - RISC0 verifier: `0xd1934807041B168f383870A0d8F565aDe2DF9D7D`
  - Anchor: `0x1670130000000000000000000000000000010001`
  - Image ID: `0x9ea74bd84383a9ca3d776790823f48d79638cf8f99bccc77f2eac4cb70c89216`

- [x] **5) On-chain proof verification**
  - `Risc0CircuitVerifier.verifyProof(bytes,uint256[])` returns `true` for valid proofs
  - **Files:** `packages/contracts/src/impl/Risc0CircuitVerifier.sol`

- [x] **6) Claim transaction succeeds**
  - `Shadow.claim(bytes,PublicInput)` succeeds
  - Nullifier consumed
  - 0.1% claim fee applied
  - **Files:** `packages/contracts/src/impl/Shadow.sol`

### Security Verification

- [x] **7) Public input binding verified**
  - Journal fields validated against 120-element public inputs array
  - **Files:** `packages/contracts/src/impl/Risc0CircuitVerifier.sol`

- [x] **8) Nullifier double-spend prevention**
  - Atomic check-and-consume pattern
  - Access control on `consume()` function
  - **Files:** `packages/contracts/src/impl/Nullifier.sol`

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

| Contract | Address |
|----------|---------|
| Anchor | `0x1670130000000000000000000000000000010001` |
| RISC0 Verifier | `0xd1934807041B168f383870A0d8F565aDe2DF9D7D` |
| Image ID | `0x9ea74bd84383a9ca3d776790823f48d79638cf8f99bccc77f2eac4cb70c89216` |

---

## References

- [PRD](./PRD.md)
- [Public Inputs Spec](./packages/docs/public-inputs-spec.md)
- [EIP-7503](https://eips.ethereum.org/EIPS/eip-7503)