# Shadow — Production Readiness

This checklist tracks end-to-end readiness for Shadow on **Taiko Hoodi**:

- Local proof generation (no Docker)
- On-chain verifier wiring (Taiko `ICheckpointStore` + RISC0 verifier)
- Claim execution + nullifier consumption
- Contract verification on TaikoScan (Etherscan)

## Checklist

- [x] **1) RISC0 guest+host proving pipeline works (no Docker)**
  - `shadow-risc0-host prove --receipt-kind groth16` succeeds using local `snarkjs` shrinkwrap.

- [x] **2) Journal format is chain-verifiable**
  - Guest commits a packed **288-byte** journal (not RISC0 serde), matching `Risc0CircuitVerifier` expectations.

- [x] **3) Hoodi checkpoint flow wired**
  - Proof generation resolves a recent L1 checkpoint via Hoodi `ICheckpointStore` (`0x1670130000000000000000000000000000000005`)
  - Proof generation fetches `eth_getProof` from Hoodi L1 at the checkpoint block.

- [x] **4) On-chain deployment complete (Hoodi L2)**
  - Deploy script: `packages/contracts/script/DeployTaiko.s.sol`
  - Default verifier: Taiko Hoodi RISC0 verifier (`0xd1934807041B168f383870A0d8F565aDe2DF9D7D`)

- [x] **5) On-chain proof verification (view)**
  - `Risc0CircuitVerifier.verifyProof(bytes,uint256[])` returns `true` for a generated Groth16 proof.

- [x] **6) Claim transaction succeeds**
  - `Shadow.claim(bytes,PublicInput)` succeeds
  - Nullifier consumed
  - `DummyEtherMinter.EthMinted` + `Shadow.Claimed` emitted

- [x] **7) Contracts verified on TaikoScan (Etherscan API v2)**
  - Verified: `DummyEtherMinter`, `Nullifier`, `Risc0CircuitVerifier`, `ShadowVerifier`, `Shadow` (implementation), `ERC1967Proxy`

- [ ] **8) One-command setup + one-command prove UX (nice-to-have)**
  - Auto-build host binary if missing.
  - Document a single setup command that installs all prerequisites (rzup component + deps) per OS.

