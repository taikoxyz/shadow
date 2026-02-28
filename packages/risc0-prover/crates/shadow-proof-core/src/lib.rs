#![no_std]

extern crate alloc;

use alloc::vec::Vec;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tiny_keccak::{Hasher, Keccak};

pub const MAX_NOTES: usize = 5;
pub const MAX_TOTAL_WEI: u128 = 8_000_000_000_000_000_000;
pub const MAX_PROOF_DEPTH: usize = 64;
pub const MAX_NODE_BYTES: usize = 4096;

const MAGIC_RECIPIENT: &[u8] = b"shadow.recipient.v1";
const MAGIC_ADDRESS: &[u8] = b"shadow.address.v1";
const MAGIC_NULLIFIER: &[u8] = b"shadow.nullifier.v1";

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ClaimInput {
    pub block_number: u64,
    pub block_hash: [u8; 32],
    pub chain_id: u64,
    pub note_index: u32,
    pub amount: u128,
    pub recipient: [u8; 20],
    pub secret: [u8; 32],
    pub note_count: u32,
    pub amounts: Vec<u128>,
    pub recipient_hashes: Vec<[u8; 32]>,
    pub block_header_rlp: Vec<u8>,
    pub proof_depth: u32,
    pub proof_nodes: Vec<Vec<u8>>,
    pub proof_node_lengths: Vec<u32>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ClaimJournal {
    pub block_number: u64,
    /// The block hash that was verified against the RLP-encoded block header.
    /// The stateRoot is derived in-circuit from this block header; we commit
    /// to blockHash because that's what the on-chain Anchor contract provides.
    pub block_hash: [u8; 32],
    pub chain_id: u64,
    pub amount: u128,
    pub recipient: [u8; 20],
    pub nullifier: [u8; 32],
}

// Packed journal layout (little-endian fields, fixed widths):
// - block_number: u64 (8)
// - block_hash: bytes32 (32)
// - chain_id: u64 (8)
// - amount: u128 (16)
// - recipient: address (20)
// - nullifier: bytes32 (32)
//
// NOTE: `note_index` is intentionally NOT part of the public journal.
pub const PACKED_JOURNAL_LEN: usize = 116;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct PackedJournalError {
    pub expected: usize,
    pub actual: usize,
}

impl PackedJournalError {
    pub const fn invalid_length(actual: usize) -> Self {
        Self {
            expected: PACKED_JOURNAL_LEN,
            actual,
        }
    }
}

impl core::fmt::Display for PackedJournalError {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        write!(
            f,
            "invalid packed journal length: expected {}, got {}",
            self.expected, self.actual
        )
    }
}

pub fn pack_journal(journal: &ClaimJournal) -> [u8; PACKED_JOURNAL_LEN] {
    let mut out = [0u8; PACKED_JOURNAL_LEN];

    out[0..8].copy_from_slice(&journal.block_number.to_le_bytes());
    out[8..40].copy_from_slice(&journal.block_hash);
    out[40..48].copy_from_slice(&journal.chain_id.to_le_bytes());
    out[48..64].copy_from_slice(&journal.amount.to_le_bytes());
    out[64..84].copy_from_slice(&journal.recipient);
    out[84..116].copy_from_slice(&journal.nullifier);

    out
}

pub fn unpack_journal(bytes: &[u8]) -> Result<ClaimJournal, PackedJournalError> {
    if bytes.len() != PACKED_JOURNAL_LEN {
        return Err(PackedJournalError::invalid_length(bytes.len()));
    }

    let block_number = u64::from_le_bytes(copy_array::<8>(&bytes[0..8]));
    let block_hash = copy_array::<32>(&bytes[8..40]);
    let chain_id = u64::from_le_bytes(copy_array::<8>(&bytes[40..48]));
    let amount = u128::from_le_bytes(copy_array::<16>(&bytes[48..64]));
    let recipient = copy_array::<20>(&bytes[64..84]);
    let nullifier = copy_array::<32>(&bytes[84..116]);

    Ok(ClaimJournal {
        block_number,
        block_hash,
        chain_id,
        amount,
        recipient,
        nullifier,
    })
}

fn copy_array<const N: usize>(bytes: &[u8]) -> [u8; N] {
    let mut out = [0u8; N];
    out.copy_from_slice(bytes);
    out
}

#[derive(Clone, Copy, Debug)]
pub enum ClaimValidationError {
    InvalidNoteCount,
    InvalidNoteIndex,
    InvalidInputLengths,
    InactiveNoteHasZeroAmount,
    SelectedAmountMismatch,
    RecipientHashMismatch,
    TotalAmountExceeded,
    InvalidProofDepth,
    ProofShapeMismatch,
    ProofNodeTooLarge,
    InvalidNodeReference,
    InvalidRlpNode,
    InvalidTrieNode,
    InvalidTriePath,
    MissingAccountValue,
    InvalidAccountValue,
    InsufficientAccountBalance,
    InvalidBlockHeaderHash,
    InvalidBlockHeaderShape,
    BlockNumberMismatch,
}

impl ClaimValidationError {
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::InvalidNoteCount => "invalid note count",
            Self::InvalidNoteIndex => "invalid note index",
            Self::InvalidInputLengths => "invalid input array lengths",
            Self::InactiveNoteHasZeroAmount => "active note amount must be non-zero",
            Self::SelectedAmountMismatch => "selected note amount does not match public amount",
            Self::RecipientHashMismatch => "selected note recipient hash mismatch",
            Self::TotalAmountExceeded => "total amount exceeds protocol limit",
            Self::InvalidProofDepth => "invalid account proof depth",
            Self::ProofShapeMismatch => "account proof depth/array shape mismatch",
            Self::ProofNodeTooLarge => "account proof node exceeds max byte length",
            Self::InvalidNodeReference => "account proof node does not match parent reference",
            Self::InvalidRlpNode => "invalid RLP node encoding",
            Self::InvalidTrieNode => "invalid trie node shape",
            Self::InvalidTriePath => "invalid trie path for target address",
            Self::MissingAccountValue => "account value missing from trie proof",
            Self::InvalidAccountValue => "invalid account value encoding",
            Self::InsufficientAccountBalance => "account balance is insufficient for note total",
            Self::InvalidBlockHeaderHash => "block header hash mismatch",
            Self::InvalidBlockHeaderShape => "invalid block header shape",
            Self::BlockNumberMismatch => "block header number mismatch",
        }
    }
}

pub fn evaluate_claim(input: &ClaimInput) -> Result<ClaimJournal, ClaimValidationError> {
    let note_count = input.note_count as usize;
    let note_index = input.note_index as usize;

    if note_count == 0 || note_count > MAX_NOTES {
        return Err(ClaimValidationError::InvalidNoteCount);
    }
    if note_index >= note_count {
        return Err(ClaimValidationError::InvalidNoteIndex);
    }
    if input.amounts.len() < note_count || input.recipient_hashes.len() < note_count {
        return Err(ClaimValidationError::InvalidInputLengths);
    }

    let selected_amount = input.amounts[note_index];
    if selected_amount != input.amount {
        return Err(ClaimValidationError::SelectedAmountMismatch);
    }

    let expected_recipient_hash = compute_recipient_hash(&input.recipient);
    if input.recipient_hashes[note_index] != expected_recipient_hash {
        return Err(ClaimValidationError::RecipientHashMismatch);
    }

    let mut total_amount: u128 = 0;
    for i in 0..note_count {
        let amt = input.amounts[i];
        if amt == 0 {
            return Err(ClaimValidationError::InactiveNoteHasZeroAmount);
        }
        total_amount = total_amount
            .checked_add(amt)
            .ok_or(ClaimValidationError::TotalAmountExceeded)?;
    }
    if total_amount > MAX_TOTAL_WEI {
        return Err(ClaimValidationError::TotalAmountExceeded);
    }

    if input.proof_depth == 0 || input.proof_depth as usize > MAX_PROOF_DEPTH {
        return Err(ClaimValidationError::InvalidProofDepth);
    }
    if input.proof_depth as usize != input.proof_nodes.len()
        || input.proof_depth as usize != input.proof_node_lengths.len()
    {
        return Err(ClaimValidationError::ProofShapeMismatch);
    }

    for (node, declared_len) in input
        .proof_nodes
        .iter()
        .zip(input.proof_node_lengths.iter())
    {
        if node.len() != *declared_len as usize {
            return Err(ClaimValidationError::ProofShapeMismatch);
        }
        if node.len() > MAX_NODE_BYTES {
            return Err(ClaimValidationError::ProofNodeTooLarge);
        }
    }

    let notes_hash = compute_notes_hash(note_count, &input.amounts, &input.recipient_hashes)?;
    let target_address = derive_target_address(&input.secret, input.chain_id, &notes_hash);
    let state_root = parse_state_root_from_block_header(
        &input.block_hash,
        input.block_number,
        &input.block_header_rlp,
    )?;
    let account_balance =
        verify_account_proof_and_get_balance(&state_root, &target_address, &input.proof_nodes)?;
    if !balance_gte_total(&account_balance, total_amount) {
        return Err(ClaimValidationError::InsufficientAccountBalance);
    }

    let nullifier = derive_nullifier(&input.secret, input.chain_id, input.note_index);

    // Note: stateRoot is derived in-circuit from block_header_rlp and verified against
    // input.block_hash. We commit to block_hash because that's what TaikoAnchor provides.
    Ok(ClaimJournal {
        block_number: input.block_number,
        block_hash: input.block_hash,
        chain_id: input.chain_id,
        amount: input.amount,
        recipient: input.recipient,
        nullifier,
    })
}

pub fn compute_recipient_hash(recipient: &[u8; 20]) -> [u8; 32] {
    let mut input = [0u8; 64];
    input[..32].copy_from_slice(&pad_magic_label(MAGIC_RECIPIENT));

    let mut padded = [0u8; 32];
    padded[12..].copy_from_slice(recipient);
    input[32..].copy_from_slice(&padded);

    sha256(&input)
}

pub fn compute_notes_hash(
    note_count: usize,
    amounts: &[u128],
    recipient_hashes: &[[u8; 32]],
) -> Result<[u8; 32], ClaimValidationError> {
    if amounts.len() < note_count || recipient_hashes.len() < note_count || note_count > MAX_NOTES {
        return Err(ClaimValidationError::InvalidInputLengths);
    }

    let mut buf = [0u8; MAX_NOTES * 64];
    for i in 0..note_count {
        let start = i * 64;
        buf[start..start + 32].copy_from_slice(&u128_to_bytes32(amounts[i]));
        buf[start + 32..start + 64].copy_from_slice(&recipient_hashes[i]);
    }

    Ok(sha256(&buf))
}

pub fn derive_target_address(secret: &[u8; 32], chain_id: u64, notes_hash: &[u8; 32]) -> [u8; 20] {
    let mut input = [0u8; 128];
    input[..32].copy_from_slice(&pad_magic_label(MAGIC_ADDRESS));
    input[32..64].copy_from_slice(&u64_to_bytes32(chain_id));
    input[64..96].copy_from_slice(secret);
    input[96..128].copy_from_slice(notes_hash);

    let hash = sha256(&input);
    let mut out = [0u8; 20];
    out.copy_from_slice(&hash[12..32]);
    out
}

pub fn derive_nullifier(secret: &[u8; 32], chain_id: u64, note_index: u32) -> [u8; 32] {
    let mut input = [0u8; 128];
    input[..32].copy_from_slice(&pad_magic_label(MAGIC_NULLIFIER));
    input[32..64].copy_from_slice(&u64_to_bytes32(chain_id));
    input[64..96].copy_from_slice(secret);
    input[96..128].copy_from_slice(&u64_to_bytes32(note_index as u64));

    sha256(&input)
}

pub fn compute_proof_commitment(nodes: &[Vec<u8>]) -> [u8; 32] {
    let mut h = Sha256::new();
    for node in nodes {
        h.update((node.len() as u32).to_be_bytes());
        h.update(node.as_slice());
    }
    let out = h.finalize();
    let mut digest = [0u8; 32];
    digest.copy_from_slice(&out);
    digest
}

#[cfg(test)]
mod tests {
    extern crate std;

    use super::*;
    use alloc::vec;

    fn rlp_encode_bytes(raw: &[u8]) -> Vec<u8> {
        if raw.len() == 1 && raw[0] <= 0x7f {
            return vec![raw[0]];
        }

        if raw.len() <= 55 {
            let mut out = Vec::with_capacity(1 + raw.len());
            out.push(0x80u8 + raw.len() as u8);
            out.extend_from_slice(raw);
            return out;
        }

        let len_bytes = usize_to_be_bytes(raw.len());
        let mut out = Vec::with_capacity(1 + len_bytes.len() + raw.len());
        out.push(0xb7u8 + len_bytes.len() as u8);
        out.extend_from_slice(&len_bytes);
        out.extend_from_slice(raw);
        out
    }

    fn rlp_encode_list(items: &[Vec<u8>]) -> Vec<u8> {
        let payload_len: usize = items.iter().map(|it| it.len()).sum();
        let mut payload = Vec::with_capacity(payload_len);
        for it in items {
            payload.extend_from_slice(it);
        }

        if payload.len() <= 55 {
            let mut out = Vec::with_capacity(1 + payload.len());
            out.push(0xc0u8 + payload.len() as u8);
            out.extend_from_slice(&payload);
            return out;
        }

        let len_bytes = usize_to_be_bytes(payload.len());
        let mut out = Vec::with_capacity(1 + len_bytes.len() + payload.len());
        out.push(0xf7u8 + len_bytes.len() as u8);
        out.extend_from_slice(&len_bytes);
        out.extend_from_slice(&payload);
        out
    }

    fn usize_to_be_bytes(mut value: usize) -> Vec<u8> {
        if value == 0 {
            return vec![0u8];
        }
        let mut out = Vec::new();
        while value > 0 {
            out.push((value & 0xff) as u8);
            value >>= 8;
        }
        out.reverse();
        out
    }

    fn u64_to_min_be_bytes(value: u64) -> Vec<u8> {
        if value == 0 {
            return Vec::new();
        }
        let buf = value.to_be_bytes();
        let first = buf.iter().position(|b| *b != 0).unwrap_or(buf.len());
        buf[first..].to_vec()
    }

    fn make_block_header_rlp(block_number: u64, state_root: [u8; 32]) -> Vec<u8> {
        let fields = vec![
            rlp_encode_bytes(&[0x11u8; 32]),                      // parentHash
            rlp_encode_bytes(&[0x22u8; 32]),                      // sha3Uncles
            rlp_encode_bytes(&[0x33u8; 20]),                      // miner
            rlp_encode_bytes(&state_root),                        // stateRoot
            rlp_encode_bytes(&[0x44u8; 32]),                      // transactionsRoot
            rlp_encode_bytes(&[0x55u8; 32]),                      // receiptsRoot
            rlp_encode_bytes(&[0u8; 256]),                        // logsBloom
            rlp_encode_bytes(&[]),                                // difficulty
            rlp_encode_bytes(&u64_to_min_be_bytes(block_number)), // number
            rlp_encode_bytes(&[0x01]),                            // gasLimit
            rlp_encode_bytes(&[]),                                // gasUsed
            rlp_encode_bytes(&[0x02]),                            // timestamp
            rlp_encode_bytes(&[]),                                // extraData
            rlp_encode_bytes(&[0x66u8; 32]),                      // mixHash
            rlp_encode_bytes(&[0x77u8; 8]),                       // nonce
            rlp_encode_bytes(&[0x01]),                            // baseFeePerGas
            rlp_encode_bytes(&[0x88u8; 32]),                      // withdrawalsRoot
        ];
        rlp_encode_list(&fields)
    }

    fn nibbles_to_compact_path(nibbles: &[u8], is_leaf: bool) -> Vec<u8> {
        let is_odd = (nibbles.len() % 2) == 1;
        let flags = (if is_leaf { 0x2 } else { 0x0 }) | (if is_odd { 0x1 } else { 0x0 });

        let mut out = Vec::new();
        if is_odd {
            out.push((flags << 4) | (nibbles[0] & 0x0f));
            for pair in nibbles[1..].chunks(2) {
                out.push((pair[0] << 4) | (pair[1] & 0x0f));
            }
        } else {
            out.push(flags << 4);
            for pair in nibbles.chunks(2) {
                out.push((pair[0] << 4) | (pair[1] & 0x0f));
            }
        }
        out
    }

    #[test]
    fn nullifier_includes_note_index() {
        let secret = [7u8; 32];
        let chain_id = 167013u64;

        let n0 = derive_nullifier(&secret, chain_id, 0);
        let n1 = derive_nullifier(&secret, chain_id, 1);

        assert_ne!(n0, n1);
    }

    #[test]
    fn decode_rlp_item_handles_single_byte_and_empty_string() {
        let item = decode_rlp_item(&[0x7f], 0).unwrap();
        assert!(!item.is_list);
        assert_eq!(item.payload_offset, 0);
        assert_eq!(item.payload_len, 1);
        assert_eq!(item.total_len, 1);

        // 0x80 encodes an empty string.
        let item = decode_rlp_item(&[0x80], 0).unwrap();
        assert!(!item.is_list);
        assert_eq!(item.payload_offset, 1);
        assert_eq!(item.payload_len, 0);
        assert_eq!(item.total_len, 1);
    }

    #[test]
    fn decode_rlp_list_payload_items_rejects_nested_list_items() {
        // [[0x01]] is a list whose only element is another list. We reject nested lists.
        let inner = rlp_encode_list(&[rlp_encode_bytes(&[0x01])]);
        let outer = rlp_encode_list(&[inner]);
        let err = decode_rlp_list_payload_items(&outer).unwrap_err();
        assert!(matches!(err, ClaimValidationError::InvalidRlpNode));
    }

    #[test]
    fn decode_compact_nibbles_roundtrip_even_leaf_and_odd_extension() {
        let even = vec![0x0, 0x1, 0x2, 0x3];
        let encoded = nibbles_to_compact_path(&even, true);
        let (is_leaf, decoded) = decode_compact_nibbles(&encoded).unwrap();
        assert!(is_leaf);
        assert_eq!(decoded, even);

        let odd = vec![0xa, 0xb, 0xc];
        let encoded = nibbles_to_compact_path(&odd, false);
        let (is_leaf, decoded) = decode_compact_nibbles(&encoded).unwrap();
        assert!(!is_leaf);
        assert_eq!(decoded, odd);
    }

    #[test]
    fn parse_state_root_from_block_header_accepts_matching_block_number() {
        let state_root = [0xaau8; 32];
        let block_number = 4_739_555u64;
        let header = make_block_header_rlp(block_number, state_root);
        let block_hash = keccak256(&header);

        let parsed =
            parse_state_root_from_block_header(&block_hash, block_number, &header).unwrap();
        assert_eq!(parsed, state_root);
    }

    #[test]
    fn parse_state_root_from_block_header_rejects_block_number_mismatch() {
        let state_root = [0xbbu8; 32];
        let block_number = 4_739_555u64;
        let header = make_block_header_rlp(block_number, state_root);
        let block_hash = keccak256(&header);

        let err =
            parse_state_root_from_block_header(&block_hash, block_number + 1, &header).unwrap_err();
        assert!(matches!(err, ClaimValidationError::BlockNumberMismatch));
    }

    #[test]
    fn node_matches_reference_supports_hashed_and_inlined_children() {
        let node = b"some rlp node bytes".to_vec();

        let digest = keccak256(&node);
        assert!(node_matches_reference(&node, &digest));

        let mut wrong = digest;
        wrong[0] ^= 1;
        assert!(!node_matches_reference(&node, &wrong));

        // Inline reference is a literal byte-equality check.
        assert!(node_matches_reference(&node, &node));
        assert!(!node_matches_reference(&node, b"other"));
    }

    #[test]
    fn verify_account_proof_accepts_single_leaf_root_and_extracts_balance() {
        let target_address = [0x11u8; 20];
        let key_hash = keccak256(&target_address);
        let key_nibbles = hash_to_nibbles(&key_hash);

        // Leaf path commits the entire key (this models a trie with a single key at the root).
        let path = nibbles_to_compact_path(&key_nibbles, true);

        // Account RLP: [nonce, balance, storageRoot, codeHash]
        let nonce = rlp_encode_bytes(&[]); // 0
        let balance_raw = [0x01u8, 0x02, 0x03, 0x04, 0x05];
        let balance = rlp_encode_bytes(&balance_raw);
        let storage_root = rlp_encode_bytes(&[0x22u8; 32]);
        let code_hash = rlp_encode_bytes(&[0x33u8; 32]);
        let account_rlp = rlp_encode_list(&[nonce, balance, storage_root, code_hash]);

        // MPT leaf node RLP: [path, accountRlpBytes]
        let leaf_node = rlp_encode_list(&[rlp_encode_bytes(&path), rlp_encode_bytes(&account_rlp)]);
        let state_root = keccak256(&leaf_node);

        let balance_32 =
            verify_account_proof_and_get_balance(&state_root, &target_address, &[leaf_node])
                .unwrap();

        let mut expected = [0u8; 32];
        expected[32 - balance_raw.len()..].copy_from_slice(&balance_raw);
        assert_eq!(balance_32, expected);
    }

    #[test]
    fn verify_account_proof_rejects_state_root_mismatch() {
        let target_address = [0x11u8; 20];
        let key_hash = keccak256(&target_address);
        let key_nibbles = hash_to_nibbles(&key_hash);
        let path = nibbles_to_compact_path(&key_nibbles, true);

        let account_rlp = rlp_encode_list(&[
            rlp_encode_bytes(&[]),
            rlp_encode_bytes(&[0x01]),
            rlp_encode_bytes(&[0x22u8; 32]),
            rlp_encode_bytes(&[0x33u8; 32]),
        ]);
        let leaf_node = rlp_encode_list(&[rlp_encode_bytes(&path), rlp_encode_bytes(&account_rlp)]);

        let wrong_root = [0x99u8; 32];
        let err = verify_account_proof_and_get_balance(&wrong_root, &target_address, &[leaf_node])
            .unwrap_err();
        assert!(matches!(err, ClaimValidationError::InvalidNodeReference));
    }

    #[test]
    fn verify_account_proof_rejects_trie_path_mismatch() {
        let target_address = [0x11u8; 20];
        let key_hash = keccak256(&target_address);
        let mut key_nibbles = hash_to_nibbles(&key_hash);
        key_nibbles[0] ^= 1; // corrupt the path
        let path = nibbles_to_compact_path(&key_nibbles, true);

        let account_rlp = rlp_encode_list(&[
            rlp_encode_bytes(&[]),
            rlp_encode_bytes(&[0x01]),
            rlp_encode_bytes(&[0x22u8; 32]),
            rlp_encode_bytes(&[0x33u8; 32]),
        ]);
        let leaf_node = rlp_encode_list(&[rlp_encode_bytes(&path), rlp_encode_bytes(&account_rlp)]);
        let state_root = keccak256(&leaf_node);

        let err = verify_account_proof_and_get_balance(&state_root, &target_address, &[leaf_node])
            .unwrap_err();
        assert!(matches!(err, ClaimValidationError::InvalidTriePath));
    }

    #[test]
    fn verify_account_proof_traverses_branch_then_leaf_with_hashed_child_reference() {
        let target_address = [0x11u8; 20];
        let key_hash = keccak256(&target_address);
        let key_nibbles = hash_to_nibbles(&key_hash);

        let nonce = rlp_encode_bytes(&[]);
        let balance_raw = [0x05u8, 0x04, 0x03, 0x02, 0x01];
        let balance = rlp_encode_bytes(&balance_raw);
        let storage_root = rlp_encode_bytes(&[0x22u8; 32]);
        let code_hash = rlp_encode_bytes(&[0x33u8; 32]);
        let account_rlp = rlp_encode_list(&[nonce, balance, storage_root, code_hash]);

        // Build leaf for the remaining nibbles after the branch consumed the first nibble.
        let leaf_path = nibbles_to_compact_path(&key_nibbles[1..], true);
        let leaf_node =
            rlp_encode_list(&[rlp_encode_bytes(&leaf_path), rlp_encode_bytes(&account_rlp)]);
        let leaf_hash = keccak256(&leaf_node);

        // Root branch chooses next child based on the first nibble.
        let mut branch_items = Vec::with_capacity(17);
        for idx in 0..16usize {
            if idx == key_nibbles[0] as usize {
                branch_items.push(rlp_encode_bytes(&leaf_hash));
            } else {
                branch_items.push(rlp_encode_bytes(&[]));
            }
        }
        branch_items.push(rlp_encode_bytes(&[])); // branch value slot (unused)

        let branch_node = rlp_encode_list(&branch_items);
        let state_root = keccak256(&branch_node);

        let balance_32 = verify_account_proof_and_get_balance(
            &state_root,
            &target_address,
            &[branch_node, leaf_node],
        )
        .unwrap();

        let mut expected = [0u8; 32];
        expected[32 - balance_raw.len()..].copy_from_slice(&balance_raw);
        assert_eq!(balance_32, expected);
    }

    #[test]
    fn verify_account_proof_rejects_when_parent_child_reference_hash_mismatches() {
        let target_address = [0x11u8; 20];
        let key_hash = keccak256(&target_address);
        let key_nibbles = hash_to_nibbles(&key_hash);

        let account_rlp = rlp_encode_list(&[
            rlp_encode_bytes(&[]),
            rlp_encode_bytes(&[0x01]),
            rlp_encode_bytes(&[0x22u8; 32]),
            rlp_encode_bytes(&[0x33u8; 32]),
        ]);

        let leaf_path = nibbles_to_compact_path(&key_nibbles[1..], true);
        let leaf_node =
            rlp_encode_list(&[rlp_encode_bytes(&leaf_path), rlp_encode_bytes(&account_rlp)]);
        let mut leaf_hash = keccak256(&leaf_node);
        leaf_hash[0] ^= 1;

        let mut branch_items = Vec::with_capacity(17);
        for idx in 0..16usize {
            if idx == key_nibbles[0] as usize {
                branch_items.push(rlp_encode_bytes(&leaf_hash));
            } else {
                branch_items.push(rlp_encode_bytes(&[]));
            }
        }
        branch_items.push(rlp_encode_bytes(&[]));
        let branch_node = rlp_encode_list(&branch_items);
        let state_root = keccak256(&branch_node);

        let err = verify_account_proof_and_get_balance(
            &state_root,
            &target_address,
            &[branch_node, leaf_node],
        )
        .unwrap_err();
        assert!(matches!(err, ClaimValidationError::InvalidNodeReference));
    }
}

fn u128_to_bytes32(value: u128) -> [u8; 32] {
    let mut out = [0u8; 32];
    out[16..].copy_from_slice(&value.to_be_bytes());
    out
}

fn u64_to_bytes32(value: u64) -> [u8; 32] {
    let mut out = [0u8; 32];
    out[24..].copy_from_slice(&value.to_be_bytes());
    out
}

fn pad_magic_label(label: &[u8]) -> [u8; 32] {
    let mut out = [0u8; 32];
    let n = core::cmp::min(32, label.len());
    out[..n].copy_from_slice(&label[..n]);
    out
}

fn sha256(data: &[u8]) -> [u8; 32] {
    let mut h = Sha256::new();
    h.update(data);
    let out = h.finalize();
    let mut digest = [0u8; 32];
    digest.copy_from_slice(&out);
    digest
}

fn keccak256(data: &[u8]) -> [u8; 32] {
    let mut keccak = Keccak::v256();
    keccak.update(data);
    let mut out = [0u8; 32];
    keccak.finalize(&mut out);
    out
}

fn parse_state_root_from_block_header(
    expected_block_hash: &[u8; 32],
    expected_block_number: u64,
    block_header_rlp: &[u8],
) -> Result<[u8; 32], ClaimValidationError> {
    if keccak256(block_header_rlp) != *expected_block_hash {
        return Err(ClaimValidationError::InvalidBlockHeaderHash);
    }

    let fields = decode_rlp_list_payload_items(block_header_rlp)?;
    if fields.len() < 9 || fields[3].len() != 32 {
        return Err(ClaimValidationError::InvalidBlockHeaderShape);
    }
    let block_number = parse_u64_from_rlp_quantity(fields[8])
        .ok_or(ClaimValidationError::InvalidBlockHeaderShape)?;
    if block_number != expected_block_number {
        return Err(ClaimValidationError::BlockNumberMismatch);
    }

    Ok(to_32(fields[3]))
}

fn parse_u64_from_rlp_quantity(bytes: &[u8]) -> Option<u64> {
    if bytes.len() > 8 {
        return None;
    }

    let mut out = 0u64;
    for b in bytes {
        out = out.checked_mul(256)?;
        out = out.checked_add(*b as u64)?;
    }
    Some(out)
}

#[derive(Clone, Copy)]
struct RlpItem {
    is_list: bool,
    payload_offset: usize,
    payload_len: usize,
    total_len: usize,
}

fn verify_account_proof_and_get_balance(
    state_root: &[u8; 32],
    target_address: &[u8; 20],
    proof_nodes: &[Vec<u8>],
) -> Result<[u8; 32], ClaimValidationError> {
    let key_hash = keccak256(target_address);
    let key_nibbles = hash_to_nibbles(&key_hash);

    let mut key_index = 0usize;
    let mut expected_ref: Option<Vec<u8>> = None;
    let mut account_rlp: Option<Vec<u8>> = None;

    for (depth, node) in proof_nodes.iter().enumerate() {
        if depth == 0 {
            if keccak256(node) != *state_root {
                return Err(ClaimValidationError::InvalidNodeReference);
            }
        } else {
            let parent_ref = expected_ref
                .as_ref()
                .ok_or(ClaimValidationError::InvalidTriePath)?;
            if !node_matches_reference(node, parent_ref) {
                return Err(ClaimValidationError::InvalidNodeReference);
            }
        }

        let elements = decode_rlp_list_payload_items(node)?;
        match elements.len() {
            17 => {
                if key_index == key_nibbles.len() {
                    let value = elements[16];
                    if value.is_empty() {
                        return Err(ClaimValidationError::MissingAccountValue);
                    }
                    account_rlp = Some(value.to_vec());
                    if depth + 1 != proof_nodes.len() {
                        return Err(ClaimValidationError::InvalidTriePath);
                    }
                    break;
                }

                let next_ref = elements[key_nibbles[key_index] as usize];
                if next_ref.is_empty() {
                    return Err(ClaimValidationError::MissingAccountValue);
                }
                expected_ref = Some(next_ref.to_vec());
                key_index += 1;
            }
            2 => {
                let (is_leaf, path_nibbles) = decode_compact_nibbles(elements[0])?;
                if key_index + path_nibbles.len() > key_nibbles.len() {
                    return Err(ClaimValidationError::InvalidTriePath);
                }
                if key_nibbles[key_index..key_index + path_nibbles.len()] != path_nibbles[..] {
                    return Err(ClaimValidationError::InvalidTriePath);
                }
                key_index += path_nibbles.len();

                if is_leaf {
                    if key_index != key_nibbles.len() {
                        return Err(ClaimValidationError::InvalidTriePath);
                    }
                    let value = elements[1];
                    if value.is_empty() {
                        return Err(ClaimValidationError::MissingAccountValue);
                    }
                    account_rlp = Some(value.to_vec());
                    if depth + 1 != proof_nodes.len() {
                        return Err(ClaimValidationError::InvalidTriePath);
                    }
                    break;
                }

                let next_ref = elements[1];
                if next_ref.is_empty() {
                    return Err(ClaimValidationError::InvalidTriePath);
                }
                expected_ref = Some(next_ref.to_vec());
            }
            _ => return Err(ClaimValidationError::InvalidTrieNode),
        }
    }

    let account = account_rlp.ok_or(ClaimValidationError::MissingAccountValue)?;
    decode_account_balance(&account)
}

fn node_matches_reference(node: &[u8], reference: &[u8]) -> bool {
    match reference.len() {
        0 => false,
        32 => keccak256(node) == to_32(reference),
        _ => node == reference,
    }
}

fn decode_account_balance(account_rlp: &[u8]) -> Result<[u8; 32], ClaimValidationError> {
    let fields = decode_rlp_list_payload_items(account_rlp)?;
    if fields.len() != 4 {
        return Err(ClaimValidationError::InvalidAccountValue);
    }

    let balance_raw = fields[1];
    if balance_raw.len() > 32 {
        return Err(ClaimValidationError::InvalidAccountValue);
    }

    let mut out = [0u8; 32];
    out[32 - balance_raw.len()..].copy_from_slice(balance_raw);
    Ok(out)
}

fn balance_gte_total(balance: &[u8; 32], total: u128) -> bool {
    if balance[..16].iter().any(|b| *b != 0) {
        return true;
    }
    let mut low = [0u8; 16];
    low.copy_from_slice(&balance[16..]);
    u128::from_be_bytes(low) >= total
}

fn hash_to_nibbles(hash: &[u8; 32]) -> [u8; 64] {
    let mut out = [0u8; 64];
    let mut idx = 0usize;
    for b in hash {
        out[idx] = b >> 4;
        out[idx + 1] = b & 0x0f;
        idx += 2;
    }
    out
}

fn decode_compact_nibbles(encoded: &[u8]) -> Result<(bool, Vec<u8>), ClaimValidationError> {
    if encoded.is_empty() {
        return Err(ClaimValidationError::InvalidTriePath);
    }

    let flag = encoded[0] >> 4;
    if flag > 3 {
        return Err(ClaimValidationError::InvalidTriePath);
    }
    let is_leaf = (flag & 0x2) != 0;
    let is_odd = (flag & 0x1) != 0;

    let mut nibbles = Vec::with_capacity(encoded.len() * 2);
    if is_odd {
        nibbles.push(encoded[0] & 0x0f);
    }

    let start = if is_odd { 1 } else { 1 };
    for byte in encoded.iter().skip(start) {
        nibbles.push(byte >> 4);
        nibbles.push(byte & 0x0f);
    }

    Ok((is_leaf, nibbles))
}

fn decode_rlp_list_payload_items(input: &[u8]) -> Result<Vec<&[u8]>, ClaimValidationError> {
    let top = decode_rlp_item(input, 0)?;
    if !top.is_list || top.total_len != input.len() {
        return Err(ClaimValidationError::InvalidRlpNode);
    }

    let mut out = Vec::new();
    let mut cursor = top.payload_offset;
    let end = top.payload_offset + top.payload_len;

    while cursor < end {
        let item = decode_rlp_item(input, cursor)?;
        if item.is_list {
            return Err(ClaimValidationError::InvalidRlpNode);
        }
        let payload_end = item.payload_offset + item.payload_len;
        if payload_end > input.len() {
            return Err(ClaimValidationError::InvalidRlpNode);
        }
        out.push(&input[item.payload_offset..payload_end]);
        cursor += item.total_len;
    }

    if cursor != end {
        return Err(ClaimValidationError::InvalidRlpNode);
    }
    Ok(out)
}

fn decode_rlp_item(input: &[u8], offset: usize) -> Result<RlpItem, ClaimValidationError> {
    if offset >= input.len() {
        return Err(ClaimValidationError::InvalidRlpNode);
    }

    let prefix = input[offset];
    if prefix <= 0x7f {
        return Ok(RlpItem {
            is_list: false,
            payload_offset: offset,
            payload_len: 1,
            total_len: 1,
        });
    }

    if prefix <= 0xb7 {
        let len = (prefix - 0x80) as usize;
        let payload_offset = offset + 1;
        let total_len = 1 + len;
        if payload_offset + len > input.len() {
            return Err(ClaimValidationError::InvalidRlpNode);
        }
        return Ok(RlpItem {
            is_list: false,
            payload_offset,
            payload_len: len,
            total_len,
        });
    }

    if prefix <= 0xbf {
        let len_of_len = (prefix - 0xb7) as usize;
        let len_offset = offset + 1;
        if len_offset + len_of_len > input.len() {
            return Err(ClaimValidationError::InvalidRlpNode);
        }
        let len = read_be_usize(&input[len_offset..len_offset + len_of_len])?;
        let payload_offset = len_offset + len_of_len;
        let total_len = 1 + len_of_len + len;
        if payload_offset + len > input.len() {
            return Err(ClaimValidationError::InvalidRlpNode);
        }
        return Ok(RlpItem {
            is_list: false,
            payload_offset,
            payload_len: len,
            total_len,
        });
    }

    if prefix <= 0xf7 {
        let len = (prefix - 0xc0) as usize;
        let payload_offset = offset + 1;
        let total_len = 1 + len;
        if payload_offset + len > input.len() {
            return Err(ClaimValidationError::InvalidRlpNode);
        }
        return Ok(RlpItem {
            is_list: true,
            payload_offset,
            payload_len: len,
            total_len,
        });
    }

    let len_of_len = (prefix - 0xf7) as usize;
    let len_offset = offset + 1;
    if len_offset + len_of_len > input.len() {
        return Err(ClaimValidationError::InvalidRlpNode);
    }
    let len = read_be_usize(&input[len_offset..len_offset + len_of_len])?;
    let payload_offset = len_offset + len_of_len;
    let total_len = 1 + len_of_len + len;
    if payload_offset + len > input.len() {
        return Err(ClaimValidationError::InvalidRlpNode);
    }
    Ok(RlpItem {
        is_list: true,
        payload_offset,
        payload_len: len,
        total_len,
    })
}

fn read_be_usize(input: &[u8]) -> Result<usize, ClaimValidationError> {
    if input.is_empty() || input.len() > core::mem::size_of::<usize>() {
        return Err(ClaimValidationError::InvalidRlpNode);
    }
    let mut out = 0usize;
    for b in input {
        out = out
            .checked_mul(256)
            .ok_or(ClaimValidationError::InvalidRlpNode)?;
        out = out
            .checked_add(*b as usize)
            .ok_or(ClaimValidationError::InvalidRlpNode)?;
    }
    Ok(out)
}

fn to_32(input: &[u8]) -> [u8; 32] {
    let mut out = [0u8; 32];
    out.copy_from_slice(input);
    out
}
