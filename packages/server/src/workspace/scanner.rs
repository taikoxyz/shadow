//! Workspace scanner: discovers deposit and proof files in a directory,
//! validates them, and correlates proofs to their deposits.

use std::{
    collections::HashMap,
    fs,
    path::{Path, PathBuf},
};

use serde::Serialize;
use shadow_proof_core::{
    compute_notes_hash, compute_recipient_hash, derive_nullifier, derive_target_address,
    MAX_NOTES,
};

/// Index of all deposits and their proof status in a workspace.
#[derive(Debug, Clone, Serialize)]
pub struct WorkspaceIndex {
    pub deposits: Vec<DepositEntry>,
}

/// A deposit file with its derived metadata and proof correlation.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DepositEntry {
    /// The deposit ID (filename stem, e.g. "deposit-ffe8-fde9-20260224T214613").
    pub id: String,
    /// Full filename.
    pub filename: String,
    /// Chain ID.
    pub chain_id: String,
    /// Derived target address (0x-prefixed).
    pub target_address: String,
    /// Total amount across all notes (wei as decimal string).
    pub total_amount: String,
    /// Number of notes.
    pub note_count: usize,
    /// UTC creation timestamp parsed from the filename (if parseable).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub created_at: Option<String>,
    /// Whether a proof file exists for this deposit.
    pub has_proof: bool,
    /// Proof filename (if exists).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub proof_file: Option<String>,
    /// Whether the proof file contains valid (non-empty) proof data.
    /// None if no proof exists, Some(false) if the proof has empty seal/proof fields.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub proof_valid: Option<bool>,
    /// Per-note info.
    pub notes: Vec<NoteEntry>,
    /// Optional user comment.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub comment: Option<String>,
}

/// Per-note information within a deposit.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteEntry {
    /// Note index.
    pub index: u32,
    /// Recipient address (0x-prefixed).
    pub recipient: String,
    /// Amount in wei (decimal string).
    pub amount: String,
    /// Optional label.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    /// Nullifier (0x-prefixed hex).
    pub nullifier: String,
    /// Claim status: "unknown" (not yet queried on-chain).
    pub claim_status: String,
}

/// Scan a workspace directory and return an index of all deposits.
pub fn scan_workspace(workspace: &Path) -> WorkspaceIndex {
    let entries = match fs::read_dir(workspace) {
        Ok(entries) => entries,
        Err(e) => {
            tracing::warn!(error = %e, path = %workspace.display(), "failed to read workspace directory");
            return WorkspaceIndex {
                deposits: Vec::new(),
            };
        }
    };

    // Collect filenames
    let mut deposit_files: Vec<(String, PathBuf)> = Vec::new();
    let mut proof_files: Vec<String> = Vec::new();

    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        if is_deposit_filename(&name) {
            deposit_files.push((name, path));
        } else if is_proof_filename(&name) {
            proof_files.push(name);
        }
    }

    // Build proof lookup: deposit_stem -> newest proof filename.
    //
    // Multiple proof files may exist for the same deposit (e.g. after regeneration).
    // We sort lexicographically — since proof filenames embed a compact ISO 8601
    // timestamp (`YYYYMMDDTHHMMSS`), lexicographic order equals chronological order.
    // The last entry after sorting is therefore the newest.
    let mut proof_map: HashMap<String, Vec<String>> = HashMap::new();
    for pf in &proof_files {
        if let Some(stem) = proof_deposit_stem(pf) {
            proof_map.entry(stem.to_string()).or_default().push(pf.clone());
        }
    }
    let proof_map: HashMap<String, String> = proof_map
        .into_iter()
        .filter_map(|(stem, mut proofs)| {
            proofs.sort();
            proofs.into_iter().last().map(|newest| (stem, newest))
        })
        .collect();

    // Process each deposit
    let mut deposits: Vec<DepositEntry> = Vec::new();
    for (filename, path) in &deposit_files {
        match process_deposit(filename, path, &proof_map) {
            Ok(entry) => deposits.push(entry),
            Err(e) => {
                tracing::warn!(file = %filename, error = %e, "skipping invalid deposit file");
            }
        }
    }

    // Sort by filename (which includes timestamp, so roughly chronological)
    deposits.sort_by(|a, b| a.filename.cmp(&b.filename));

    WorkspaceIndex { deposits }
}

fn process_deposit(
    filename: &str,
    path: &Path,
    proof_map: &HashMap<String, String>,
) -> anyhow::Result<DepositEntry> {
    let raw = fs::read(path)?;

    #[derive(serde::Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct DepositJson {
        version: String,
        chain_id: String,
        secret: String,
        notes: Vec<NoteJson>,
        target_address: Option<String>,
        #[serde(default)]
        comment: Option<String>,
    }

    #[derive(serde::Deserialize)]
    struct NoteJson {
        recipient: String,
        amount: String,
        label: Option<String>,
    }

    let deposit: DepositJson = serde_json::from_slice(&raw)?;

    if deposit.version != "v2" {
        anyhow::bail!("unsupported version: {}", deposit.version);
    }

    let note_count = deposit.notes.len();
    if note_count == 0 || note_count > MAX_NOTES {
        anyhow::bail!("invalid note count: {}", note_count);
    }

    let chain_id: u64 = deposit.chain_id.parse()?;
    let secret = parse_hex_bytes32(&deposit.secret)?;

    let mut amounts: Vec<u128> = Vec::with_capacity(note_count);
    let mut recipient_hashes: Vec<[u8; 32]> = Vec::with_capacity(note_count);
    let mut note_entries: Vec<NoteEntry> = Vec::with_capacity(note_count);
    let mut total_amount: u128 = 0;

    for (i, note) in deposit.notes.iter().enumerate() {
        let recipient = parse_hex_address(&note.recipient)?;
        let amount: u128 = note.amount.parse()?;
        let recipient_hash = compute_recipient_hash(&recipient);
        let nullifier = derive_nullifier(&secret, chain_id, i as u32);

        amounts.push(amount);
        recipient_hashes.push(recipient_hash);
        total_amount = total_amount.checked_add(amount).unwrap_or(u128::MAX);

        note_entries.push(NoteEntry {
            index: i as u32,
            recipient: format!("0x{}", hex::encode(recipient)),
            amount: note.amount.clone(),
            label: note.label.clone(),
            nullifier: format!("0x{}", hex::encode(nullifier)),
            claim_status: "unknown".to_string(),
        });
    }

    let notes_hash = compute_notes_hash(note_count, &amounts, &recipient_hashes)
        .map_err(|e| anyhow::anyhow!("notes hash: {}", e.as_str()))?;
    let target_address = derive_target_address(&secret, chain_id, &notes_hash);

    // Verify targetAddress field if present
    if let Some(ref expected) = deposit.target_address {
        let expected_bytes = parse_hex_address(expected)?;
        if expected_bytes != target_address {
            anyhow::bail!("targetAddress mismatch");
        }
    }

    let stem = deposit_stem(filename);
    let proof_file = proof_map.get(stem).cloned();
    let created_at = parse_timestamp_from_filename(filename);

    // Validate the proof file (if it exists)
    let proof_valid = proof_file.as_ref().map(|pf| {
        let proof_path = path.parent().unwrap_or(path).join(pf);
        validate_proof_file(&proof_path)
    });

    Ok(DepositEntry {
        id: stem.to_string(),
        filename: filename.to_string(),
        chain_id: deposit.chain_id,
        target_address: format!("0x{}", hex::encode(target_address)),
        total_amount: total_amount.to_string(),
        note_count,
        created_at,
        has_proof: proof_file.is_some(),
        proof_file,
        proof_valid,
        notes: note_entries,
        comment: deposit.comment,
    })
}

// ---------------------------------------------------------------------------
// Proof file validation
// ---------------------------------------------------------------------------

/// Check whether a proof file has valid (non-empty) proof data.
///
/// A proof file is considered valid if it parses as JSON, has a non-empty
/// "notes" array, and the first note has a non-empty "seal" or "proof" field.
/// Dev-mode proofs (generated without the `prove` feature) have empty fields
/// and are therefore marked as invalid.
fn validate_proof_file(path: &Path) -> bool {
    let raw = match fs::read(path) {
        Ok(r) => r,
        Err(_) => return false,
    };
    let val: serde_json::Value = match serde_json::from_slice(&raw) {
        Ok(v) => v,
        Err(_) => return false,
    };
    let notes = match val.get("notes").and_then(|v| v.as_array()) {
        Some(n) if !n.is_empty() => n,
        _ => return false,
    };
    let first = &notes[0];
    let seal = first.get("seal").and_then(|v| v.as_str()).unwrap_or("");
    let proof = first.get("proof").and_then(|v| v.as_str()).unwrap_or("");
    !seal.is_empty() || !proof.is_empty()
}

// ---------------------------------------------------------------------------
// Filename utilities (duplicated from deposit module to avoid risc0 dependency)
// ---------------------------------------------------------------------------

fn is_deposit_filename(name: &str) -> bool {
    name.starts_with("deposit-") && name.ends_with(".json") && !name.contains(".proof")
}

fn is_proof_filename(name: &str) -> bool {
    name.starts_with("deposit-") && name.contains(".proof-") && name.ends_with(".json")
}

fn deposit_stem(filename: &str) -> &str {
    filename.strip_suffix(".json").unwrap_or(filename)
}

fn proof_deposit_stem(proof_filename: &str) -> Option<&str> {
    let name = proof_filename
        .strip_suffix(".json")
        .unwrap_or(proof_filename);
    name.find(".proof-").map(|idx| &name[..idx])
}

/// Try to parse the ISO 8601 compact timestamp from a deposit filename.
///
/// e.g. `deposit-ffe8-fde9-20260224T214613.json` → `2026-02-24T21:46:13Z`
fn parse_timestamp_from_filename(filename: &str) -> Option<String> {
    // Extract the timestamp part: everything after the 3rd '-' and before '.json'
    let stem = filename.strip_suffix(".json")?;
    let parts: Vec<&str> = stem.splitn(4, '-').collect();
    if parts.len() < 4 {
        return None;
    }
    let ts = parts[3]; // "20260224T214613"
    if ts.len() != 15 || !ts.contains('T') {
        return None;
    }
    // Convert "20260224T214613" to "2026-02-24T21:46:13Z"
    Some(format!(
        "{}-{}-{}T{}:{}:{}Z",
        &ts[0..4],
        &ts[4..6],
        &ts[6..8],
        &ts[9..11],
        &ts[11..13],
        &ts[13..15]
    ))
}

// ---------------------------------------------------------------------------
// Hex parsing helpers
// ---------------------------------------------------------------------------

fn parse_hex_bytes32(hex_str: &str) -> anyhow::Result<[u8; 32]> {
    let stripped = hex_str
        .strip_prefix("0x")
        .or_else(|| hex_str.strip_prefix("0X"))
        .ok_or_else(|| anyhow::anyhow!("expected 0x prefix"))?;
    if stripped.len() != 64 {
        anyhow::bail!("expected 64 hex chars, got {}", stripped.len());
    }
    let bytes = hex::decode(stripped)?;
    let mut out = [0u8; 32];
    out.copy_from_slice(&bytes);
    Ok(out)
}

fn parse_hex_address(hex_str: &str) -> anyhow::Result<[u8; 20]> {
    let stripped = hex_str
        .strip_prefix("0x")
        .or_else(|| hex_str.strip_prefix("0X"))
        .ok_or_else(|| anyhow::anyhow!("expected 0x prefix"))?;
    if stripped.len() != 40 {
        anyhow::bail!("expected 40 hex chars, got {}", stripped.len());
    }
    let bytes = hex::decode(stripped)?;
    let mut out = [0u8; 20];
    out.copy_from_slice(&bytes);
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn write_deposit_file(dir: &Path, filename: &str, json: &str) {
        let path = dir.join(filename);
        let mut f = fs::File::create(path).unwrap();
        f.write_all(json.as_bytes()).unwrap();
    }

    fn sample_deposit_json() -> &'static str {
        r#"{
            "version": "v2",
            "chainId": "167013",
            "secret": "0x8c4d3df220b9aa338eafbe43871a800a9ef971fc7242c4d0de98e056cc8c7bfa",
            "notes": [
                {
                    "recipient": "0x1111111111111111111111111111111111111111",
                    "amount": "1230000000000",
                    "label": "note #0"
                }
            ]
        }"#
    }

    #[test]
    fn scan_finds_deposit_file() {
        let dir = tempfile::tempdir().unwrap();
        write_deposit_file(
            dir.path(),
            "deposit-ffe8-fde9-20260224T214613.json",
            sample_deposit_json(),
        );

        let index = scan_workspace(dir.path());
        assert_eq!(index.deposits.len(), 1);

        let d = &index.deposits[0];
        assert_eq!(d.id, "deposit-ffe8-fde9-20260224T214613");
        assert_eq!(d.chain_id, "167013");
        assert_eq!(d.note_count, 1);
        assert!(!d.has_proof);
        assert_eq!(d.notes[0].amount, "1230000000000");
        assert_eq!(d.created_at.as_deref(), Some("2026-02-24T21:46:13Z"));
    }

    #[test]
    fn scan_correlates_proof_file() {
        let dir = tempfile::tempdir().unwrap();
        write_deposit_file(
            dir.path(),
            "deposit-ffe8-fde9-20260224T214613.json",
            sample_deposit_json(),
        );
        // Create an empty proof file (content doesn't matter for correlation)
        write_deposit_file(
            dir.path(),
            "deposit-ffe8-fde9-20260224T214613.proof-20260225T103000.json",
            "{}",
        );

        let index = scan_workspace(dir.path());
        assert_eq!(index.deposits.len(), 1);
        assert!(index.deposits[0].has_proof);
        assert_eq!(
            index.deposits[0].proof_file.as_deref(),
            Some("deposit-ffe8-fde9-20260224T214613.proof-20260225T103000.json")
        );
    }

    #[test]
    fn scan_ignores_non_deposit_files() {
        let dir = tempfile::tempdir().unwrap();
        write_deposit_file(dir.path(), "random.json", "{}");
        write_deposit_file(dir.path(), "note-0.proof.json", "{}");

        let index = scan_workspace(dir.path());
        assert!(index.deposits.is_empty());
    }

    #[test]
    fn scan_skips_invalid_deposit() {
        let dir = tempfile::tempdir().unwrap();
        write_deposit_file(
            dir.path(),
            "deposit-aaaa-bbbb-20260101T000000.json",
            r#"{"version": "v1", "bad": true}"#,
        );

        let index = scan_workspace(dir.path());
        assert!(index.deposits.is_empty());
    }

    #[test]
    fn parse_timestamp_from_filename_works() {
        assert_eq!(
            parse_timestamp_from_filename("deposit-ffe8-fde9-20260224T214613.json"),
            Some("2026-02-24T21:46:13Z".to_string())
        );
        assert_eq!(
            parse_timestamp_from_filename("deposit-abcd-efgh-short.json"),
            None
        );
    }
}
