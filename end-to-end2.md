# End-to-End Test Report: Shadow Protocol on Taiko Hoodi

**Date:** February 23, 2026
**Network:** Taiko Hoodi Testnet (Chain ID: 167013)
**Test Result:** **PASSED**

---

## 1. Deployment Summary

All contracts deployed successfully with the correct RISC0 image ID.

| Contract | Address | Explorer |
|----------|---------|----------|
| DummyEtherMinter | `0x71f360597bbDB01CA24A70d9d4ABB3BB5EF5E8d9` | [View](https://hoodi.taikoscan.io/address/0x71f360597bbDB01CA24A70d9d4ABB3BB5EF5E8d9) |
| Risc0CircuitVerifier | `0x1e3e9D95233Cce7544F8986660738497eF373997` | [View](https://hoodi.taikoscan.io/address/0x1e3e9D95233Cce7544F8986660738497eF373997) |
| ShadowVerifier | `0x0B98084BD3e775d0c5Fa61C9E59383D7b7a45B96` | [View](https://hoodi.taikoscan.io/address/0x0B98084BD3e775d0c5Fa61C9E59383D7b7a45B96) |
| Shadow (implementation) | `0x7eC396B34df5c64A371512b25c680699eD5BB5e5` | [View](https://hoodi.taikoscan.io/address/0x7eC396B34df5c64A371512b25c680699eD5BB5e5) |
| Shadow (proxy) | `0xCd45084D91bC488239184EEF39dd20bCb710e7C2` | [View](https://hoodi.taikoscan.io/address/0xCd45084D91bC488239184EEF39dd20bCb710e7C2) |

### Configuration

| Parameter | Value |
|-----------|-------|
| Deployer | `0xe36C0F16d5fB473CC5181f5fb86b6Eb3299aD9cb` |
| Owner | `0xe36C0F16d5fB473CC5181f5fb86b6Eb3299aD9cb` |
| TaikoAnchor | `0x1670130000000000000000000000000000010001` |
| RISC0 Verifier (v3.0.1) | `0xd1934807041B168f383870A0d8F565aDe2DF9D7D` |
| Image ID | `0x37a5e85c934ec15f7752cfced2f407f40e6c28978dffcb3b895dc100a76acaf8` |

---

## 2. Deposit Setup

A new deposit file was created with 2 notes using the PoW mining script.

**Deposit File:** `packages/docs/data/deposits/e2e-test.deposit.json`

| Field | Value |
|-------|-------|
| Chain ID | `167013` |
| Target Address | `0xd9fe053ed78f86e035c3b8a3e80a85217a643a52` |
| Total Amount | 0.002 ETH (2 notes × 0.001 ETH) |
| Recipient | `0xe36C0F16d5fB473CC5181f5fb86b6Eb3299aD9cb` |

### Notes

| Note | Amount | Recipient |
|------|--------|-----------|
| #0 | 0.001 ETH | `0xe36C0F16d5fB473CC5181f5fb86b6Eb3299aD9cb` |
| #1 | 0.001 ETH | `0xe36C0F16d5fB473CC5181f5fb86b6Eb3299aD9cb` |

### Target Funding

The target address was funded with 0.003 ETH (0.001 ETH extra for margin).

| Transaction | Hash |
|-------------|------|
| Fund Target | [`0x8fcca6cb156693ea99e4b3886d034bc7705944d53862180a54e962f4aacfe083`](https://hoodi.taikoscan.io/tx/0x8fcca6cb156693ea99e4b3886d034bc7705944d53862180a54e962f4aacfe083) |

---

## 3. Proof Generation & Claims

### Note #0 Claim

| Step | Details |
|------|---------|
| Proof Block | 4693415 |
| Block Hash | `0x...` (verified on-chain) |
| Nullifier | `0x931b7d70597c771cd0c21a091956c7f66ca0a76a86cab23ce32fbac7b8295757` |
| Claim Tx | [`0x8614ac72c6b534b0b89c1ff4ba70b53a0fa9cfba49a6174a7ac377312b849b02`](https://hoodi.taikoscan.io/tx/0x8614ac72c6b534b0b89c1ff4ba70b53a0fa9cfba49a6174a7ac377312b849b02) |
| Status | **SUCCESS** |

### Duplicate Claim Test (Nullifier Protection)

Attempted to claim note #0 again with the same proof:

```
Error: nullifier already consumed: 0x931b7d70597c771cd0c21a091956c7f66ca0a76a86cab23ce32fbac7b8295757
```

**Result:** **PASSED** - Nullifier protection working correctly.

### Note #1 Claim

| Step | Details |
|------|---------|
| Proof Block | 4693476 |
| Block Hash | `0x...` (verified on-chain) |
| Nullifier | (different from note #0) |
| Claim Tx | [`0xae7d54c7f8ecaa6b681a9eae00186e73fc11d209f7b98e1ff3c7f3137cc6d253`](https://hoodi.taikoscan.io/tx/0xae7d54c7f8ecaa6b681a9eae00186e73fc11d209f7b98e1ff3c7f3137cc6d253) |
| Status | **SUCCESS** |

---

## 4. Test Summary

| Test Case | Result |
|-----------|--------|
| Contract Deployment | PASSED |
| Deposit Mining (PoW) | PASSED |
| Target Funding | PASSED |
| ZK Proof Generation (Note #0) | PASSED |
| On-chain Proof Verification (Note #0) | PASSED |
| Claim Execution (Note #0) | PASSED |
| Nullifier Protection (Duplicate Rejection) | PASSED |
| ZK Proof Generation (Note #1) | PASSED |
| On-chain Proof Verification (Note #1) | PASSED |
| Claim Execution (Note #1) | PASSED |

---

## 5. Architecture Verification

This test validated the following architectural components:

1. **TaikoAnchor Integration**: The `blockHashes(uint256)` function correctly returns historical block hashes on L2.

2. **ZK Circuit**: The RISC0 guest correctly:
   - Verifies `keccak256(header_rlp) == blockHash`
   - Extracts `stateRoot` from the RLP-encoded header
   - Verifies Merkle-Patricia trie proof against the derived stateRoot
   - Commits `blockHash` (not stateRoot) to the journal

3. **On-chain Verification**: The ShadowVerifier correctly:
   - Fetches block hash from TaikoAnchor
   - Verifies the RISC0 Groth16 proof
   - Validates public inputs match the journal commitment
   - Enforces nullifier uniqueness

4. **ETH Distribution**: The Shadow contract correctly mints ETH to recipients upon valid claim.

---

## 6. Commands Reference

### Deploy Contracts
```bash
cd packages/contracts
FOUNDRY_PROFILE=layer2 \
DEPLOYER_PK=0x... \
IMAGE_ID=0x37a5e85c934ec15f7752cfced2f407f40e6c28978dffcb3b895dc100a76acaf8 \
forge script script/DeployTaiko.s.sol:DeployTaiko \
  --rpc-url https://rpc.hoodi.taiko.xyz \
  --broadcast
```

### Mine Deposit
```bash
node packages/risc0-prover/scripts/mine-deposit.mjs \
  --out packages/docs/data/deposits/e2e-test.deposit.json \
  --chain-id 167013 \
  --recipient 0xe36C0F16d5fB473CC5181f5fb86b6Eb3299aD9cb \
  --amount-wei 1000000000000000 \
  --note-count 2 \
  --same-recipient
```

### Fund Target Address
```bash
cast send <TARGET_ADDRESS> \
  --value 3000000000000000 \
  --rpc-url https://rpc.hoodi.taiko.xyz \
  --private-key 0x...
```

### Generate Proof
```bash
node packages/risc0-prover/scripts/shadowcli.mjs prove \
  --deposit packages/docs/data/deposits/e2e-test.deposit.json \
  --rpc https://rpc.hoodi.taiko.xyz \
  --note-index 0 \
  --proof-out packages/docs/data/deposits/e2e-note-0.proof.json
```

### Submit Claim
```bash
node packages/risc0-prover/scripts/shadowcli.mjs claim \
  --proof packages/docs/data/deposits/e2e-note-0.proof.json \
  --shadow 0xCd45084D91bC488239184EEF39dd20bCb710e7C2 \
  --rpc https://rpc.hoodi.taiko.xyz \
  --private-key 0x...
```

---

## 7. Known Issues & Notes

1. **Image ID Mismatch**: The deployment script `DeployTaiko.s.sol` has a hardcoded image ID that may not match the current prover build. Always pass `IMAGE_ID` as an environment variable to ensure consistency.

2. **Testnet Resets**: Taiko Hoodi testnet may be reset periodically, wiping deployed contracts. Protocol contracts (like TaikoAnchor) survive resets, but application contracts need redeployment.

3. **Gas Costs**: Claim transactions cost approximately 500k-600k gas due to RISC0 Groth16 verification.

---

## 8. Conclusion

The Shadow protocol is fully functional on Taiko Hoodi testnet. All core features work as designed:
- Zero-knowledge proof generation and verification
- On-chain block hash anchoring via TaikoAnchor
- Nullifier-based replay protection
- Multi-note deposits and claims

The system is ready for further testing and mainnet preparation.
