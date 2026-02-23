# Migration Plan: Remove CheckpointStore, Use Anchor blockHashes()

## Overview

This plan migrates the Shadow protocol from using `ICheckpointStore` (which stores both `blockHash` and `stateRoot`) to using `IAnchor.blockHashes()` exclusively. The ZK proof will commit to `blockHash` in its journal, while `stateRoot` is derived and verified entirely in-circuit.

### Architecture Summary

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           ON-CHAIN (L2 Only)                            │
├─────────────────────────────────────────────────────────────────────────┤
│  User submits: (proof, blockNumber, chainId, amount, recipient, nullifier)
│                              │
│                              ▼
│  ┌─────────────────┐    ┌──────────────────┐
│  │  TaikoAnchor    │───▶│  ShadowVerifier  │
│  │  .blockHashes() │    │  (fetches hash)  │
│  └─────────────────┘    └────────┬─────────┘
│         │                        │
│         │ bytes32 blockHash      │ builds publicInputs[87]
│         │                        │   - blockNumber
│         ▼                        │   - blockHash (32 bytes)
│  ┌─────────────────┐             │   - chainId, amount
│  │  Canonical      │             │   - recipient, nullifier
│  │  Block Hash     │             │
│  └─────────────────┘             ▼
│                        ┌──────────────────────┐
│                        │ Risc0CircuitVerifier │
│                        │ - decodes (seal, journal)
│                        │ - validates journal matches publicInputs
│                        │ - journal[8..40] = blockHash ✓
│                        │ - calls risc0Verifier.verify()
│                        └──────────────────────┘
└─────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────┐
│                        ZK CIRCUIT (RISC0 Guest)                         │
├─────────────────────────────────────────────────────────────────────────┤
│  Private Witnesses:                                                     │
│    - block_header_rlp (full RLP-encoded header)                         │
│    - secret, note_index, amounts, recipient_hashes                      │
│    - proof_nodes (Merkle-Patricia trie proof)                           │
│                                                                         │
│  In-Circuit Verification:                                               │
│    1. keccak256(block_header_rlp) == input.block_hash ✓                 │
│    2. state_root = header.fields[3] (extracted from RLP)                │
│    3. verify_account_proof(state_root, target_address) → balance ✓      │
│    4. balance >= total_amount ✓                                         │
│    5. pow_digest valid (24 trailing zero bits) ✓                        │
│                                                                         │
│  Public Journal Output (116 bytes):                                     │
│    [0..8)   block_number (u64 LE)                                       │
│    [8..40)  block_hash (bytes32) ← CANONICAL BINDING                    │
│    [40..48) chain_id (u64 LE)                                           │
│    [48..64) amount (u128 LE)                                            │
│    [64..84) recipient (address)                                         │
│    [84..116) nullifier (bytes32)                                        │
└─────────────────────────────────────────────────────────────────────────┘
```

### Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| Journal commits to `blockHash`, not `stateRoot` | On-chain Anchor provides `blockHashes()`, so journal binding matches available data |
| `stateRoot` derived in-circuit from RLP header | Ensures actual account state is verified, not user-provided data |
| `keccak256(header_rlp) == blockHash` verified in-circuit | Proves the header is genuine for the claimed block |
| All transactions on L2 only | No L1 access needed; Anchor is pre-deployed on Taiko L2 |

---

## Current State Analysis

### Already Completed (Staged Changes)

| Component | Status | Details |
|-----------|--------|---------|
| `ShadowVerifier.sol` | ✅ Done | Uses `IAnchor`, queries `anchor.blockHashes()` |
| `lib.rs` (Rust core) | ✅ Done | `ClaimJournal.block_hash` field, `pack_journal` outputs blockHash at bytes 8-40 |
| `Risc0CircuitVerifier.sol` | ✅ Done | Validates `blockHash` at journal offset 8-39 |
| `ShadowPublicInputs.sol` | ✅ Done | Public inputs layout includes `blockHash` at indices 1-32 |
| `ShadowVerifier.t.sol` | ✅ Done | Uses `MockAnchor` |
| `MockAnchor.sol` | ✅ Done | Provides `setBlockHash()` and `blockHashes()` |
| `IAnchor.sol` | ✅ Done | Interface with `blockHashes(uint256) → bytes32` |
| `DeployWithAnchor.s.sol` | ✅ Done | Production deployment using TaikoAnchor |

### Still Needs Work

| Component | Status | Required Changes |
|-----------|--------|------------------|
| `Shadow.t.sol` | ❌ Pending | Switch from `MockCheckpointStore` to `MockAnchor` |
| `ShadowDummyEtherMinterIntegration.t.sol` | ❌ Pending | Check if uses CheckpointStore |
| `DeployTaiko.s.sol` | ❌ Pending | Remove checkpoint references, use anchor |
| `DeployWithMockCheckpoint.s.sol` | ❌ Pending | Delete or convert to MockAnchor |
| `DeployWithOfficialRisc0.s.sol` | ❌ Pending | Check for checkpoint references |
| `DeployWithV3Verifier.s.sol` | ❌ Pending | Check for checkpoint references |
| `ICheckpointStore.sol` | ❌ Pending | Delete (no longer used) |
| `MockCheckpointStore.sol` | ❌ Pending | Delete (no longer used) |
| `lib.rs` comment line 52 | ❌ Pending | Update comment from "state_root" to "block_hash" |
| Documentation | ❌ Pending | Update specs to reflect blockHash binding |

---

## Detailed Todo List

### Phase 1: Update Test Files

#### 1.1 Update `Shadow.t.sol`
**File:** `packages/contracts/test/Shadow.t.sol`

Changes required:
- [ ] Replace `import {MockCheckpointStore}` with `import {MockAnchor}`
- [ ] Change `MockCheckpointStore internal checkpointStore` to `MockAnchor internal anchor`
- [ ] Update `setUp()`: `anchor = new MockAnchor()` instead of `checkpointStore = new MockCheckpointStore()`
- [ ] Update `ShadowVerifier` constructor call: `new ShadowVerifier(address(anchor), ...)`
- [ ] Replace all `checkpointStore.setCheckpoint(blockNumber, bytes32(0), stateRoot)` calls with `anchor.setBlockHash(blockNumber, blockHash)`
- [ ] Update test variable names: `stateRoot` → `blockHash` where appropriate

**Lines to modify:** 12, 17, 24, 26, 56-57, 86-87, 115-116, 132-133, 151, 173, 195, 217, 235, 253

#### 1.2 Check `ShadowDummyEtherMinterIntegration.t.sol`
**File:** `packages/contracts/test/ShadowDummyEtherMinterIntegration.t.sol`

- [ ] Verify if it uses CheckpointStore
- [ ] Update to use MockAnchor if needed

### Phase 2: Update Deployment Scripts

#### 2.1 Update `DeployTaiko.s.sol`
**File:** `packages/contracts/script/DeployTaiko.s.sol`

Changes required:
- [ ] Remove `HOODI_CHECKPOINT_STORE` constant (line 17)
- [ ] Add `HOODI_ANCHOR` constant: `0x1670130000000000000000000000000000010001`
- [ ] Rename `checkpointStore` variable to `anchor` (lines 34, 43, 50, 57, 66)
- [ ] Update env var from `CHECKPOINT_STORE` to `ANCHOR`
- [ ] Update log messages

#### 2.2 Delete `DeployWithMockCheckpoint.s.sol`
**File:** `packages/contracts/script/DeployWithMockCheckpoint.s.sol`

- [ ] Delete this file entirely (obsolete with Anchor migration)
- [ ] Or: Convert to `DeployWithMockAnchor.s.sol` for local testing

#### 2.3 Check `DeployWithOfficialRisc0.s.sol`
**File:** `packages/contracts/script/DeployWithOfficialRisc0.s.sol`

- [ ] Check for checkpoint references
- [ ] Update to use Anchor if needed

#### 2.4 Check `DeployWithV3Verifier.s.sol`
**File:** `packages/contracts/script/DeployWithV3Verifier.s.sol`

- [ ] Check for checkpoint references
- [ ] Update to use Anchor if needed

### Phase 3: Remove Obsolete Files

#### 3.1 Delete `ICheckpointStore.sol`
**File:** `packages/contracts/src/iface/ICheckpointStore.sol`

- [ ] Verify no remaining imports
- [ ] Delete file

#### 3.2 Delete `MockCheckpointStore.sol`
**File:** `packages/contracts/test/mocks/MockCheckpointStore.sol`

- [ ] Verify no remaining imports
- [ ] Delete file

### Phase 4: Update Comments and Documentation

#### 4.1 Fix Rust Comment
**File:** `packages/risc0-prover/crates/shadow-proof-core/src/lib.rs`

- [ ] Update line 52 comment from `// - state_root: bytes32 (32)` to `// - block_hash: bytes32 (32)`

#### 4.2 Update Documentation
**Files:** Various docs in `packages/contracts/docs/`

- [ ] Update `circuit-public-inputs-spec.md` if it references stateRoot in journal
- [ ] Update `public-inputs.md` if needed
- [ ] Update any README files mentioning CheckpointStore

### Phase 5: Verification

#### 5.1 Run Tests
- [ ] `cd packages/contracts && forge test`
- [ ] Verify all tests pass

#### 5.2 Build Prover
- [ ] `cd packages/risc0-prover && cargo build --release`
- [ ] Verify no compilation errors

#### 5.3 Verify No Remaining References
- [ ] `grep -r "CheckpointStore\|checkpoint" packages/contracts/src/`
- [ ] `grep -r "CheckpointStore\|checkpoint" packages/contracts/test/`
- [ ] `grep -r "CheckpointStore\|checkpoint" packages/contracts/script/`
- [ ] Ensure only lib dependencies remain (OpenZeppelin Checkpoints.sol is unrelated)

---

## File Change Summary

| Action | File Path |
|--------|-----------|
| **MODIFY** | `packages/contracts/test/Shadow.t.sol` |
| **CHECK** | `packages/contracts/test/ShadowDummyEtherMinterIntegration.t.sol` |
| **MODIFY** | `packages/contracts/script/DeployTaiko.s.sol` |
| **DELETE** | `packages/contracts/script/DeployWithMockCheckpoint.s.sol` |
| **CHECK** | `packages/contracts/script/DeployWithOfficialRisc0.s.sol` |
| **CHECK** | `packages/contracts/script/DeployWithV3Verifier.s.sol` |
| **DELETE** | `packages/contracts/src/iface/ICheckpointStore.sol` |
| **DELETE** | `packages/contracts/test/mocks/MockCheckpointStore.sol` |
| **MODIFY** | `packages/risc0-prover/crates/shadow-proof-core/src/lib.rs` (comment only) |

---

## TaikoAnchor Contract Reference

**Address on Taiko Hoodi L2:** `0x1670130000000000000000000000000000010001`

**Interface:**
```solidity
interface IAnchor {
    function blockHashes(uint256 _blockNumber) external view returns (bytes32 _blockHash_);
}
```

**Behavior:**
- Returns the canonical block hash for a given block number
- Returns `bytes32(0)` if block number is not yet anchored
- Pre-deployed system contract on Taiko L2

---

## Security Considerations

1. **Block Hash Canonicity**: `blockHash` from Anchor is authoritative for L2 block history
2. **StateRoot Derivation**: Circuit verifies `keccak256(header_rlp) == blockHash`, then extracts `stateRoot` from header field [3]
3. **No L1 Access**: All verification happens on L2 using L2 block data
4. **Replay Protection**: Nullifier tracking prevents double-claiming
5. **Balance Verification**: MPT proof verifies account balance against derived `stateRoot`

---

## Estimated Changes

- **Tests:** ~50 lines modified
- **Scripts:** ~30 lines modified
- **Deletions:** ~65 lines (ICheckpointStore + MockCheckpointStore)
- **Comments:** ~2 lines

Total: ~150 lines changed/deleted
