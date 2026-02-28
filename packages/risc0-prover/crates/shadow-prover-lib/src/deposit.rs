//! Deposit file loading, validation, and derivation utilities.
//!
//! Handles the v2 deposit file format:
//! ```json
//! {
//!   "version": "v2",
//!   "chainId": "167013",
//!   "secret": "0x...",
//!   "notes": [{ "recipient": "0x...", "amount": "123", "label": "..." }],
//!   "targetAddress": "0x..."
//! }
//! ```

use std::{fs, path::Path};

use anyhow::{bail, Context, Result};
use serde::{Deserialize, Serialize};
use shadow_proof_core::{
    compute_notes_hash, compute_recipient_hash, derive_nullifier, derive_target_address, MAX_NOTES,
};

/// A parsed deposit file (v2 schema).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DepositFile {
    pub version: String,
    pub chain_id: String,
    pub secret: String,
    pub notes: Vec<DepositNote>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub target_address: Option<String>,
}

/// A single note within a deposit.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DepositNote {
    pub recipient: String,
    pub amount: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
}

/// Derived information from a deposit file (addresses, nullifiers, hashes).
#[derive(Debug, Clone)]
pub struct DerivedDepositInfo {
    /// The chain ID as u64.
    pub chain_id: u64,
    /// The 32-byte secret.
    pub secret: [u8; 32],
    /// The derived target address (20 bytes).
    pub target_address: [u8; 20],
    /// The SHA-256 notes hash.
    pub notes_hash: [u8; 32],
    /// Per-note derived info.
    pub notes: Vec<DerivedNoteInfo>,
    /// Total amount across all notes (in wei).
    pub total_amount: u128,
}

/// Per-note derived information.
#[derive(Debug, Clone)]
pub struct DerivedNoteInfo {
    /// Note index (0-based).
    pub index: u32,
    /// Recipient address (20 bytes).
    pub recipient: [u8; 20],
    /// Amount in wei.
    pub amount: u128,
    /// Optional label.
    pub label: Option<String>,
    /// The nullifier for this note: SHA-256(magic || chainId || secret || noteIndex).
    pub nullifier: [u8; 32],
    /// The recipient hash: SHA-256(magic || left-padded recipient).
    pub recipient_hash: [u8; 32],
}

/// Load a deposit file from disk.
pub fn load_deposit(path: &Path) -> Result<DepositFile> {
    let raw =
        fs::read(path).with_context(|| format!("failed reading deposit {}", path.display()))?;
    let deposit: DepositFile = serde_json::from_slice(&raw)
        .with_context(|| format!("failed parsing deposit JSON {}", path.display()))?;
    Ok(deposit)
}

/// Validate a deposit file against the v2 schema constraints.
pub fn validate_deposit(deposit: &DepositFile) -> Result<()> {
    if deposit.version != "v2" {
        bail!(
            "unsupported deposit version: {} (expected v2)",
            deposit.version
        );
    }

    // chainId must be a decimal number string
    if deposit.chain_id.is_empty() || !deposit.chain_id.chars().all(|c| c.is_ascii_digit()) {
        bail!("invalid chainId: must be a decimal number string");
    }

    // secret must be a 32-byte hex string (0x-prefixed, 64 hex chars)
    parse_hex_bytes32(&deposit.secret).context("invalid secret")?;

    // notes: 1..=5
    if deposit.notes.is_empty() || deposit.notes.len() > MAX_NOTES {
        bail!(
            "invalid note count: {} (must be 1..{})",
            deposit.notes.len(),
            MAX_NOTES
        );
    }

    for (i, note) in deposit.notes.iter().enumerate() {
        // recipient must be a 20-byte hex address
        parse_hex_address(&note.recipient)
            .with_context(|| format!("invalid recipient in note {}", i))?;

        // amount must be a non-zero decimal number
        let amount = note
            .amount
            .parse::<u128>()
            .with_context(|| format!("invalid amount in note {}: {}", i, note.amount))?;
        if amount == 0 {
            bail!("note {} amount must be non-zero", i);
        }

        // label (optional) max 64 chars
        if let Some(ref label) = note.label {
            if label.len() > 64 {
                bail!("note {} label exceeds 64 characters", i);
            }
        }
    }

    // targetAddress (optional)
    if let Some(ref addr) = deposit.target_address {
        parse_hex_address(addr).context("invalid targetAddress")?;
    }

    Ok(())
}

/// Derive all cryptographic information from a deposit file.
///
/// This computes:
/// - Target address from (secret, chainId, notesHash)
/// - Nullifiers for each note from (secret, chainId, noteIndex)
/// - Notes hash, total amount
pub fn derive_deposit_info(deposit: &DepositFile) -> Result<DerivedDepositInfo> {
    let chain_id: u64 = deposit
        .chain_id
        .parse()
        .context("chainId is not a valid u64")?;
    let secret = parse_hex_bytes32(&deposit.secret)?;

    let note_count = deposit.notes.len();
    let mut amounts = Vec::with_capacity(note_count);
    let mut recipient_hashes = Vec::with_capacity(note_count);
    let mut derived_notes = Vec::with_capacity(note_count);
    let mut total_amount: u128 = 0;

    for (i, note) in deposit.notes.iter().enumerate() {
        let recipient = parse_hex_address(&note.recipient)?;
        let amount: u128 = note
            .amount
            .parse()
            .with_context(|| format!("invalid amount in note {}", i))?;

        let recipient_hash = compute_recipient_hash(&recipient);
        let nullifier = derive_nullifier(&secret, chain_id, i as u32);

        amounts.push(amount);
        recipient_hashes.push(recipient_hash);
        total_amount = total_amount
            .checked_add(amount)
            .context("total amount overflow")?;

        derived_notes.push(DerivedNoteInfo {
            index: i as u32,
            recipient,
            amount,
            label: note.label.clone(),
            nullifier,
            recipient_hash,
        });
    }

    let notes_hash = compute_notes_hash(note_count, &amounts, &recipient_hashes)
        .map_err(|e| anyhow::anyhow!("notes hash computation failed: {}", e.as_str()))?;
    let target_address = derive_target_address(&secret, chain_id, &notes_hash);

    // If targetAddress is present in the deposit file, verify it matches
    if let Some(ref expected_addr) = deposit.target_address {
        let expected = parse_hex_address(expected_addr)?;
        if expected != target_address {
            bail!(
                "targetAddress mismatch: file says 0x{} but derived 0x{}",
                hex::encode(expected),
                hex::encode(target_address)
            );
        }
    }

    Ok(DerivedDepositInfo {
        chain_id,
        secret,
        target_address,
        notes_hash,
        notes: derived_notes,
        total_amount,
    })
}

// ---------------------------------------------------------------------------
// Filename utilities
// ---------------------------------------------------------------------------

/// Generate a deposit filename from a target address and UTC timestamp.
///
/// Format: `deposit-<first4hex>-<last4hex>-<YYYYMMDDTHHMMSS>.json`
pub fn deposit_filename(target_address: &[u8; 20], timestamp: &str) -> String {
    let hex_addr = hex::encode(target_address);
    let first4 = &hex_addr[..4];
    let last4 = &hex_addr[hex_addr.len() - 4..];
    format!("deposit-{first4}-{last4}-{timestamp}.json")
}

/// Generate a proof filename from the deposit stem and proof UTC timestamp.
///
/// Format: `<deposit-stem>.proof-<YYYYMMDDTHHMMSS>.json`
///
/// The deposit stem already includes the deposit timestamp, e.g.:
/// `deposit-ffe8-fde9-20260224T214613.proof-20260225T103000.json`
pub fn proof_filename(deposit_stem: &str, proof_timestamp: &str) -> String {
    format!("{deposit_stem}.proof-{proof_timestamp}.json")
}

/// Extract the deposit stem from a deposit filename (without .json extension).
///
/// e.g. `deposit-ffe8-fde9-20260224T214613.json` → `deposit-ffe8-fde9-20260224T214613`
pub fn deposit_stem(deposit_filename: &str) -> &str {
    deposit_filename
        .strip_suffix(".json")
        .unwrap_or(deposit_filename)
}

/// Check if a filename matches the deposit file pattern.
pub fn is_deposit_filename(name: &str) -> bool {
    name.starts_with("deposit-") && name.ends_with(".json") && !name.contains(".proof")
}

/// Check if a filename matches the proof file pattern.
pub fn is_proof_filename(name: &str) -> bool {
    name.starts_with("deposit-") && name.contains(".proof-") && name.ends_with(".json")
}

/// Extract the deposit stem from a proof filename.
///
/// e.g. `deposit-ffe8-fde9-20260224T214613.proof-20260225T103000.json`
///   → `deposit-ffe8-fde9-20260224T214613`
pub fn proof_deposit_stem(proof_filename: &str) -> Option<&str> {
    let name = proof_filename
        .strip_suffix(".json")
        .unwrap_or(proof_filename);
    // Find ".proof-" and return everything before it
    name.find(".proof-").map(|idx| &name[..idx])
}

/// Generate a compact ISO 8601 UTC timestamp for filenames: `YYYYMMDDTHHMMSS`.
pub fn timestamp_now() -> String {
    use std::time::SystemTime;
    let now = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .unwrap_or_default();
    format_timestamp_secs(now.as_secs())
}

/// Format a Unix timestamp (seconds) as `YYYYMMDDTHHMMSS` in UTC.
pub fn format_timestamp_secs(unix_secs: u64) -> String {
    // Manual UTC date/time computation (no chrono dependency needed)
    let secs = unix_secs;
    let days = secs / 86400;
    let time_of_day = secs % 86400;

    let hours = time_of_day / 3600;
    let minutes = (time_of_day % 3600) / 60;
    let seconds = time_of_day % 60;

    // Civil date from day count (days since 1970-01-01)
    let (year, month, day) = civil_from_days(days as i64);

    format!(
        "{:04}{:02}{:02}T{:02}{:02}{:02}",
        year, month, day, hours, minutes, seconds
    )
}

// ---------------------------------------------------------------------------
// Hex parsing helpers
// ---------------------------------------------------------------------------

fn parse_hex_bytes32(hex_str: &str) -> Result<[u8; 32]> {
    let stripped = hex_str
        .strip_prefix("0x")
        .or_else(|| hex_str.strip_prefix("0X"))
        .context("secret must start with 0x")?;
    if stripped.len() != 64 {
        bail!("expected 32 bytes (64 hex chars), got {}", stripped.len());
    }
    let bytes = hex::decode(stripped).context("invalid hex")?;
    let mut out = [0u8; 32];
    out.copy_from_slice(&bytes);
    Ok(out)
}

fn parse_hex_address(hex_str: &str) -> Result<[u8; 20]> {
    let stripped = hex_str
        .strip_prefix("0x")
        .or_else(|| hex_str.strip_prefix("0X"))
        .context("address must start with 0x")?;
    if stripped.len() != 40 {
        bail!("expected 20 bytes (40 hex chars), got {}", stripped.len());
    }
    let bytes = hex::decode(stripped).context("invalid hex")?;
    let mut out = [0u8; 20];
    out.copy_from_slice(&bytes);
    Ok(out)
}

// ---------------------------------------------------------------------------
// Civil date computation (Gregorian calendar from day count since epoch)
// Algorithm from Howard Hinnant's chrono-Compatible Low-Level Date Algorithms
// ---------------------------------------------------------------------------

fn civil_from_days(days: i64) -> (i32, u32, u32) {
    let z = days + 719468;
    let era = if z >= 0 { z } else { z - 146096 } / 146097;
    let doe = (z - era * 146097) as u32;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    (y as i32, m, d)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn deposit_filename_format() {
        let addr: [u8; 20] = [
            0xff, 0xe8, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
            0x00, 0x00, 0x00, 0x00, 0xfd, 0xe9,
        ];
        let name = deposit_filename(&addr, "20260224T214613");
        assert_eq!(name, "deposit-ffe8-fde9-20260224T214613.json");
    }

    #[test]
    fn proof_filename_format() {
        let name = proof_filename("deposit-ffe8-fde9-20260224T214613", "20260225T103000");
        assert_eq!(
            name,
            "deposit-ffe8-fde9-20260224T214613.proof-20260225T103000.json"
        );
    }

    #[test]
    fn deposit_stem_extraction() {
        assert_eq!(
            deposit_stem("deposit-ffe8-fde9-20260224T214613.json"),
            "deposit-ffe8-fde9-20260224T214613"
        );
    }

    #[test]
    fn is_deposit_filename_works() {
        assert!(is_deposit_filename(
            "deposit-ffe8-fde9-20260224T214613.json"
        ));
        assert!(!is_deposit_filename(
            "deposit-ffe8-fde9-20260224T214613.proof-20260225T103000.json"
        ));
        assert!(!is_deposit_filename("note-0.proof.json"));
        assert!(!is_deposit_filename("random.json"));
    }

    #[test]
    fn is_proof_filename_works() {
        assert!(is_proof_filename(
            "deposit-ffe8-fde9-20260224T214613.proof-20260225T103000.json"
        ));
        assert!(!is_proof_filename("deposit-ffe8-fde9-20260224T214613.json"));
        assert!(!is_proof_filename("note-0.proof.json"));
    }

    #[test]
    fn proof_deposit_stem_extraction() {
        assert_eq!(
            proof_deposit_stem("deposit-ffe8-fde9-20260224T214613.proof-20260225T103000.json"),
            Some("deposit-ffe8-fde9-20260224T214613")
        );
        assert_eq!(
            proof_deposit_stem("deposit-ffe8-fde9-20260224T214613.json"),
            None
        );
    }

    #[test]
    fn validate_deposit_good() {
        let deposit = DepositFile {
            version: "v2".into(),
            chain_id: "167013".into(),
            secret: "0x8c4d3df220b9aa338eafbe43871a800a9ef971fc7242c4d0de98e056cc8c7bfa".into(),
            notes: vec![DepositNote {
                recipient: "0x1111111111111111111111111111111111111111".into(),
                amount: "1230000000000".into(),
                label: Some("example".into()),
            }],
            target_address: None,
        };
        validate_deposit(&deposit).unwrap();
    }

    #[test]
    fn validate_deposit_bad_version() {
        let deposit = DepositFile {
            version: "v1".into(),
            chain_id: "167013".into(),
            secret: "0x8c4d3df220b9aa338eafbe43871a800a9ef971fc7242c4d0de98e056cc8c7bfa".into(),
            notes: vec![DepositNote {
                recipient: "0x1111111111111111111111111111111111111111".into(),
                amount: "100".into(),
                label: None,
            }],
            target_address: None,
        };
        assert!(validate_deposit(&deposit).is_err());
    }

    #[test]
    fn validate_deposit_empty_notes() {
        let deposit = DepositFile {
            version: "v2".into(),
            chain_id: "167013".into(),
            secret: "0x8c4d3df220b9aa338eafbe43871a800a9ef971fc7242c4d0de98e056cc8c7bfa".into(),
            notes: vec![],
            target_address: None,
        };
        assert!(validate_deposit(&deposit).is_err());
    }

    #[test]
    fn validate_deposit_zero_amount() {
        let deposit = DepositFile {
            version: "v2".into(),
            chain_id: "167013".into(),
            secret: "0x8c4d3df220b9aa338eafbe43871a800a9ef971fc7242c4d0de98e056cc8c7bfa".into(),
            notes: vec![DepositNote {
                recipient: "0x1111111111111111111111111111111111111111".into(),
                amount: "0".into(),
                label: None,
            }],
            target_address: None,
        };
        assert!(validate_deposit(&deposit).is_err());
    }

    #[test]
    fn derive_deposit_info_computes_correctly() {
        let deposit = DepositFile {
            version: "v2".into(),
            chain_id: "167013".into(),
            secret: "0x8c4d3df220b9aa338eafbe43871a800a9ef971fc7242c4d0de98e056cc8c7bfa".into(),
            notes: vec![
                DepositNote {
                    recipient: "0x1111111111111111111111111111111111111111".into(),
                    amount: "1230000000000".into(),
                    label: Some("note #0".into()),
                },
                DepositNote {
                    recipient: "0x2222222222222222222222222222222222222222".into(),
                    amount: "4560000000000".into(),
                    label: None,
                },
            ],
            target_address: None,
        };

        let info = derive_deposit_info(&deposit).unwrap();
        assert_eq!(info.chain_id, 167013);
        assert_eq!(info.notes.len(), 2);
        assert_eq!(info.total_amount, 1230000000000 + 4560000000000);
        assert_eq!(info.notes[0].index, 0);
        assert_eq!(info.notes[1].index, 1);
        assert_eq!(info.notes[0].amount, 1230000000000);
        assert_eq!(info.notes[1].amount, 4560000000000);
        // Nullifiers should differ per note index
        assert_ne!(info.notes[0].nullifier, info.notes[1].nullifier);
        // Target address should be 20 bytes (non-zero)
        assert_ne!(info.target_address, [0u8; 20]);
    }

    #[test]
    fn derive_deposit_info_verifies_target_address() {
        let deposit = DepositFile {
            version: "v2".into(),
            chain_id: "167013".into(),
            secret: "0x8c4d3df220b9aa338eafbe43871a800a9ef971fc7242c4d0de98e056cc8c7bfa".into(),
            notes: vec![DepositNote {
                recipient: "0x1111111111111111111111111111111111111111".into(),
                amount: "1230000000000".into(),
                label: None,
            }],
            target_address: Some("0x0000000000000000000000000000000000000001".into()),
        };

        // Should fail because the computed target address won't match
        assert!(derive_deposit_info(&deposit).is_err());
    }

    #[test]
    fn format_timestamp_secs_epoch() {
        assert_eq!(format_timestamp_secs(0), "19700101T000000");
    }

    #[test]
    fn format_timestamp_secs_known_date() {
        // 2026-02-24T21:46:13 UTC = 1771969573 Unix
        assert_eq!(format_timestamp_secs(1771969573), "20260224T214613");
    }
}
