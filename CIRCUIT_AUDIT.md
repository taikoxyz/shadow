# Shadow Circuit Audit Report

**Date**: 2026-02-23
**Scope**: `packages/risc0-prover/crates/shadow-proof-core/src/lib.rs` (zkVM guest circuit)
**Framework**: RISC Zero zkVM v3.0.0 with Groth16 receipts

---

## Executive Summary

The Shadow circuit implements a privacy-preserving ETH claim system where users prove ownership of funds at a derived target address without revealing the secret or full note set. This audit analyzes the circuit for **soundness** (all required constraints are enforced) and **completeness** (all inputs are properly wired).

**Overall Assessment**: The circuit is well-designed with proper constraint enforcement. Several observations and recommendations are provided below.

---

## 1. Circuit Architecture Overview

### 1.1 Input/Output Structure

**Private Inputs (`ClaimInput`):**
| Field | Type | Purpose |
|-------|------|---------|
| `block_number` | `u64` | Block number for balance proof |
| `block_hash` | `[u8; 32]` | Expected block hash |
| `chain_id` | `u64` | Chain identifier |
| `note_index` | `u32` | Index of note being claimed |
| `amount` | `u128` | Amount of the selected note |
| `recipient` | `[u8; 20]` | Recipient address of selected note |
| `secret` | `[u8; 32]` | User secret (never revealed) |
| `note_count` | `u32` | Number of notes in set (1-5) |
| `amounts` | `Vec<u128>` | All note amounts |
| `recipient_hashes` | `Vec<[u8; 32]>` | Hashed recipients for all notes |
| `block_header_rlp` | `Vec<u8>` | Full RLP-encoded block header |
| `proof_depth` | `u32` | Merkle-Patricia trie proof depth |
| `proof_nodes` | `Vec<Vec<u8>>` | MPT proof nodes |
| `proof_node_lengths` | `Vec<u32>` | Lengths of proof nodes |

**Public Outputs (`ClaimJournal` - 116 bytes packed):**
| Field | Type | Offset | Purpose |
|-------|------|--------|---------|
| `block_number` | `u64` | 0-7 | Committed block number |
| `block_hash` | `[u8; 32]` | 8-39 | Committed block hash |
| `chain_id` | `u64` | 40-47 | Chain ID |
| `amount` | `u128` | 48-63 | Claimed amount |
| `recipient` | `[u8; 20]` | 64-83 | Claim recipient |
| `nullifier` | `[u8; 32]` | 84-115 | Derived nullifier |

**Private-Only Values (NOT in journal):**
- `note_index` - Hidden to prevent note set linkability

---

## 2. Soundness Analysis

### 2.1 Constraint Checklist (Per PRD Requirements)

| PRD Requirement | Circuit Enforcement | Status |
|-----------------|---------------------|--------|
| Note index within bounds | `note_index >= note_count` returns `InvalidNoteIndex` | ✅ SOUND |
| Selected note matches public amount | `amounts[note_index] != amount` returns `SelectedAmountMismatch` | ✅ SOUND |
| Recipient bound via hash | `recipient_hashes[note_index] != compute_recipient_hash(recipient)` | ✅ SOUND |
| All note amounts non-zero | Loop checks `amt == 0` for active notes | ✅ SOUND |
| Total amount <= 8 ETH | `total_amount > MAX_TOTAL_WEI` returns `TotalAmountExceeded` | ✅ SOUND |
| Target address derived correctly | `derive_target_address(secret, chain_id, notes_hash)` | ✅ SOUND |
| Block header hash verified | `keccak256(block_header_rlp) != block_hash` | ✅ SOUND |
| State root extracted from header | `parse_state_root_from_block_header()` at index 3 | ✅ SOUND |
| MPT proof valid under state root | Full trie traversal with hash verification | ✅ SOUND |
| Account balance >= total notes | `balance_gte_total(account_balance, total_amount)` | ✅ SOUND |
| Nullifier derived correctly | `derive_nullifier(secret, chain_id, note_index)` | ✅ SOUND |

### 2.2 Cryptographic Soundness

**Hash Functions:**
- SHA256 (sha2 crate): Used for `notes_hash`, `target_address`, `nullifier`, `recipient_hash`
- Keccak256 (tiny-keccak crate): Used for block header hash and MPT node hashing

**Domain Separation:**
```rust
const MAGIC_RECIPIENT: &[u8] = b"shadow.recipient.v1";
const MAGIC_ADDRESS: &[u8] = b"shadow.address.v1";
const MAGIC_NULLIFIER: &[u8] = b"shadow.nullifier.v1";
```
✅ Proper domain separation prevents cross-function hash collisions.

### 2.3 Detailed Constraint Analysis

#### 2.3.1 Note Validity Constraints

```rust
// Note count bounds (1-5)
if note_count == 0 || note_count > MAX_NOTES {
    return Err(ClaimValidationError::InvalidNoteCount);
}

// Note index bounds
if note_index >= note_count {
    return Err(ClaimValidationError::InvalidNoteIndex);
}

// Amount binding
let selected_amount = input.amounts[note_index];
if selected_amount != input.amount {
    return Err(ClaimValidationError::SelectedAmountMismatch);
}

// Recipient hash binding
let expected_recipient_hash = compute_recipient_hash(&input.recipient);
if input.recipient_hashes[note_index] != expected_recipient_hash {
    return Err(ClaimValidationError::RecipientHashMismatch);
}
```

✅ **SOUND**: Selected note is fully bound to public outputs via amount equality and recipient hash verification.

#### 2.3.2 Target Address Derivation

```rust
pub fn derive_target_address(secret: &[u8; 32], chain_id: u64, notes_hash: &[u8; 32]) -> [u8; 20] {
    let mut input = [0u8; 128];
    input[..32].copy_from_slice(&pad_magic_label(MAGIC_ADDRESS));
    input[32..64].copy_from_slice(&u64_to_bytes32(chain_id));
    input[64..96].copy_from_slice(secret);
    input[96..128].copy_from_slice(notes_hash);

    let hash = sha256(&input);
    let mut out = [0u8; 20];
    out.copy_from_slice(&hash[12..32]);  // Last 20 bytes
    out
}
```

✅ **SOUND**: Target address is deterministically derived from `(secret, chainId, notesHash)`. The `notesHash` commits to all amounts and recipient hashes.

#### 2.3.3 Nullifier Derivation

```rust
pub fn derive_nullifier(secret: &[u8; 32], chain_id: u64, note_index: u32) -> [u8; 32] {
    let mut input = [0u8; 128];
    input[..32].copy_from_slice(&pad_magic_label(MAGIC_NULLIFIER));
    input[32..64].copy_from_slice(&u64_to_bytes32(chain_id));
    input[64..96].copy_from_slice(secret);
    input[96..128].copy_from_slice(&u64_to_bytes32(note_index as u64));

    sha256(&input)
}
```

✅ **SOUND**: Nullifier is unique per `(secret, chainId, noteIndex)`. Different notes from the same deposit file produce different nullifiers.

#### 2.3.4 Block Header & State Root Verification

```rust
fn parse_state_root_from_block_header(
    expected_block_hash: &[u8; 32],
    block_header_rlp: &[u8],
) -> Result<[u8; 32], ClaimValidationError> {
    // Verify block header hashes to expected block hash
    if keccak256(block_header_rlp) != *expected_block_hash {
        return Err(ClaimValidationError::InvalidBlockHeaderHash);
    }

    // Extract stateRoot (field index 3 in Ethereum block header)
    let fields = decode_rlp_list_payload_items(block_header_rlp)?;
    if fields.len() < 4 || fields[3].len() != 32 {
        return Err(ClaimValidationError::InvalidBlockHeaderShape);
    }

    Ok(to_32(fields[3]))
}
```

✅ **SOUND**: Block header is verified via keccak256 hash, and stateRoot is extracted at the correct index (3) per Ethereum specification.

#### 2.3.5 Merkle-Patricia Trie Proof Verification

The `verify_account_proof_and_get_balance()` function implements full MPT traversal:

1. **Root Node Verification**: First node must hash to `state_root`
2. **Child Reference Verification**: Each subsequent node must match parent's reference (hash or inline)
3. **Path Verification**: Key path (keccak256 of address nibbles) matches trie path
4. **Node Type Handling**: Correctly handles branch nodes (17 elements) and extension/leaf nodes (2 elements)
5. **Balance Extraction**: Decodes account RLP and extracts balance field

✅ **SOUND**: Full MPT verification implemented correctly.

---

## 3. Completeness Analysis

### 3.1 Private Input Wiring

| Private Input | Wired To | Verification |
|---------------|----------|--------------|
| `secret` | Target address derivation, nullifier derivation | ✅ |
| `note_index` | Note selection, nullifier derivation | ✅ |
| `amounts[]` | Total sum, selected amount check | ✅ |
| `recipient_hashes[]` | Notes hash, selected recipient check | ✅ |
| `block_header_rlp` | Block hash verification, state root extraction | ✅ |
| `proof_nodes[]` | MPT verification, balance extraction | ✅ |

### 3.2 Public Output Wiring

| Public Output | Source | Verification |
|---------------|--------|--------------|
| `block_number` | Direct from input | ✅ Passed through |
| `block_hash` | Direct from input (verified against header) | ✅ Constrained |
| `chain_id` | Direct from input (used in derivations) | ✅ Constrained |
| `amount` | From input (verified against selected note) | ✅ Constrained |
| `recipient` | From input (verified via hash) | ✅ Constrained |
| `nullifier` | Derived in circuit | ✅ Computed |

### 3.3 Missing/Optional Inputs

**Intentionally Excluded from Journal:**
- `note_index`: Hidden for privacy (prevents note set linkability)
- `target_address`: Hidden for privacy (reduces deposit-claim linkability)
- `state_root`: Derived from block header (not separate input)

✅ **COMPLETE**: All required inputs are properly wired.

---

## 4. Security Observations

### 4.1 Potential Issues

#### 4.1.1 [INFO] Block Number Not Cryptographically Bound

**Location**: `evaluate_claim()` line 251-258

**Observation**: `block_number` is passed through directly from input without cryptographic binding to the block header. The circuit verifies `block_hash` against the header but does not verify that `block_number` matches the header's number field.

**Impact**: Low. The on-chain verifier fetches `blockHash` from TaikoAnchor using `blockNumber`, so a mismatch would cause verification to fail. The circuit's role is to prove the balance at a specific block hash, which is verified.

**Recommendation**: Consider extracting and verifying `block_number` from the RLP header (field index 8) for defense-in-depth.

#### 4.1.2 [INFO] Notes Hash Commits to Fixed-Size Buffer

**Location**: `compute_notes_hash()` lines 282-289

```rust
let mut buf = [0u8; MAX_NOTES * 64];  // 320 bytes
for i in 0..note_count {
    let start = i * 64;
    buf[start..start + 32].copy_from_slice(&u128_to_bytes32(amounts[i]));
    buf[start + 32..start + 64].copy_from_slice(&recipient_hashes[i]);
}

Ok(sha256(&buf))  // Always hashes full 320 bytes
```

**Observation**: The hash always processes 320 bytes regardless of `note_count`. Unused slots are zero-filled.

**Impact**: None. This is actually beneficial as it creates a fixed-size commitment regardless of note count, preventing length-extension style attacks.

#### 4.1.3 [INFO] RLP Decoder Rejects Nested Lists

**Location**: `decode_rlp_list_payload_items()` line 862-863

```rust
if item.is_list {
    return Err(ClaimValidationError::InvalidRlpNode);
}
```

**Impact**: Intentional restriction for MPT nodes. Branch nodes contain hash references (strings), not nested lists. This prevents potential DoS via deeply nested structures.

### 4.2 Strengths

1. **Domain Separation**: All hash functions use unique magic prefixes
2. **Overflow Protection**: Uses `checked_add` for amount summation
3. **Bounds Checking**: Strict validation of array lengths and indices
4. **No Panic Paths**: All errors return `Result` types (except guest entry point)
5. **No-std Compatible**: Minimal attack surface, no filesystem or network access
6. **Inline Reference Support**: MPT verifier correctly handles both hashed and inline node references

---

## 5. Contract-Circuit Alignment

### 5.1 Journal Binding Verification

**Circuit Journal Layout (Little-Endian):**
```
[0:8]     block_number (u64 LE)
[8:40]    block_hash   (32 bytes)
[40:48]   chain_id     (u64 LE)
[48:64]   amount       (u128 LE)
[64:84]   recipient    (20 bytes)
[84:116]  nullifier    (32 bytes)
```

**Contract Expectation (`Risc0CircuitVerifier.sol`):**
```solidity
uint256 blockNumber = _readLeUint(_journal, 0, 8);   // ✅ Matches
bytes32 blockHash = _readBytes32(_journal, 8);       // ✅ Matches
uint256 chainId = _readLeUint(_journal, 40, 8);      // ✅ Matches
uint256 amount = _readLeUint(_journal, 48, 16);      // ✅ Matches
address recipient = _readAddress(_journal, 64);      // ✅ Matches
bytes32 nullifier = _readBytes32(_journal, 84);      // ✅ Matches
```

✅ **ALIGNED**: Journal layout matches contract parsing exactly.

### 5.2 Public Input Array Binding

**Contract (`ShadowPublicInputs.sol`):**
```
[0]       blockNumber (uint256)
[1-32]    blockHash   (32 x uint256, MSB first)
[33]      chainId     (uint256)
[34]      amount      (uint256)
[35-54]   recipient   (20 x uint256, MSB first)
[55-86]   nullifier   (32 x uint256, MSB first)
```

**Verification in `Risc0CircuitVerifier._requireJournalMatchesPublicInputs()`:**
- All scalar fields compared directly ✅
- All byte fields reconstructed with correct endianness ✅
- Byte values validated to be in `[0, 255]` ✅

✅ **ALIGNED**: Public inputs array matches journal binding.

---

## 6. Recommendations

### 6.1 High Priority

None identified.

### 6.2 Medium Priority

1. **Add block_number verification**: Extract block number from RLP header and verify it matches the input `block_number` for defense-in-depth.

### 6.3 Low Priority

1. **Fuzz testing**: The RLP decoder and MPT verifier would benefit from extensive fuzz testing with malformed inputs.

2. **Documentation**: Add inline comments explaining the Ethereum block header field indices (parentHash=0, uncleHash=1, coinbase=2, stateRoot=3, etc.).

---

## 7. Test Coverage Review

The circuit includes unit tests for:
- Nullifier uniqueness per note index
- RLP decoding edge cases
- Compact nibble encoding roundtrip
- Node reference matching (hashed vs inline)
- Single-leaf MPT proof verification
- Branch + leaf MPT proof verification
- State root mismatch rejection
- Trie path mismatch rejection
- Parent-child hash mismatch rejection

**Recommended Additional Tests:**
- Extension node traversal
- Deep MPT proofs (>10 levels)
- Maximum note count (5 notes)
- Boundary conditions for balance comparison (balance == total, balance < total)
- Invalid block header shapes (too few fields, wrong stateRoot length)

---

## 8. Conclusion

The Shadow circuit is well-implemented with proper constraint enforcement for all PRD requirements. The circuit correctly:

1. **Binds the claim** to a specific note via amount and recipient hash verification
2. **Derives the target address** deterministically from the secret and note set
3. **Verifies the account balance** via full Merkle-Patricia trie proof validation
4. **Produces a unique nullifier** per note to prevent double-spending

The circuit outputs align correctly with contract expectations, and the journal binding in `Risc0CircuitVerifier` faithfully reconstructs all committed values.

**Audit Status**: PASSED with informational observations

---

*This audit was conducted on 2026-02-23. It covers the circuit logic in `shadow-proof-core` and its integration with the on-chain verification contracts.*
