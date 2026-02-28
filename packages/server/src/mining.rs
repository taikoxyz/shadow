//! Deposit creation: generate a random secret and derive the target address.

use std::path::Path;

use anyhow::{bail, Context, Result};
use rand::RngCore;
use shadow_proof_core::{
    compute_notes_hash, compute_recipient_hash, derive_target_address, MAX_NOTES,
};

/// Input for creating a new deposit.
pub struct MineRequest {
    pub chain_id: u64,
    pub notes: Vec<MineNote>,
}

pub struct MineNote {
    pub recipient: [u8; 20],
    pub amount: u128,
    pub label: Option<String>,
}

/// Result of deposit creation.
pub struct MineResult {
    pub secret: [u8; 32],
    pub target_address: [u8; 20],
}

/// Create a deposit by generating a random secret and deriving the target address.
pub fn mine_deposit(req: &MineRequest) -> Result<MineResult> {
    if req.notes.is_empty() || req.notes.len() > MAX_NOTES {
        bail!(
            "invalid note count: {} (must be 1..={})",
            req.notes.len(),
            MAX_NOTES
        );
    }

    let amounts: Vec<u128> = req.notes.iter().map(|n| n.amount).collect();
    let recipient_hashes: Vec<[u8; 32]> = req
        .notes
        .iter()
        .map(|n| compute_recipient_hash(&n.recipient))
        .collect();

    let notes_hash = compute_notes_hash(req.notes.len(), &amounts, &recipient_hashes)
        .map_err(|e| anyhow::anyhow!("notes hash computation failed: {}", e.as_str()))?;

    let mut rng = rand::thread_rng();
    let mut secret = [0u8; 32];
    rng.fill_bytes(&mut secret);

    let target_address = derive_target_address(&secret, req.chain_id, &notes_hash);
    Ok(MineResult {
        secret,
        target_address,
    })
}

/// Write a v2 deposit JSON file to the workspace directory.
///
/// Returns the filename that was written.
pub fn write_deposit_file(
    workspace: &Path,
    chain_id: u64,
    secret: &[u8; 32],
    target_address: &[u8; 20],
    notes: &[MineNote],
    comment: Option<&str>,
) -> Result<String> {
    let hex_addr = hex::encode(target_address);
    let first4 = &hex_addr[..4];
    let last4 = &hex_addr[hex_addr.len() - 4..];
    let timestamp = timestamp_now();
    let filename = format!("deposit-{first4}-{last4}-{timestamp}.json");

    let notes_json: Vec<serde_json::Value> = notes
        .iter()
        .map(|n| {
            let mut obj = serde_json::json!({
                "recipient": format!("0x{}", hex::encode(n.recipient)),
                "amount": n.amount.to_string(),
            });
            if let Some(ref label) = n.label {
                obj["label"] = serde_json::Value::String(label.clone());
            }
            obj
        })
        .collect();

    let mut deposit_json = serde_json::json!({
        "version": "v2",
        "created": timestamp,
        "chainId": chain_id.to_string(),
        "secret": format!("0x{}", hex::encode(secret)),
        "notes": notes_json,
        "targetAddress": format!("0x{}", hex::encode(target_address)),
    });
    if let Some(c) = comment {
        deposit_json["comment"] = serde_json::Value::String(c.to_string());
    }

    let path = workspace.join(&filename);
    let contents =
        serde_json::to_string_pretty(&deposit_json).context("failed to serialize deposit JSON")?;
    std::fs::write(&path, contents)
        .with_context(|| format!("failed to write {}", path.display()))?;

    Ok(filename)
}

/// Generate a compact ISO 8601 UTC timestamp: `YYYYMMDDTHHMMSS`.
fn timestamp_now() -> String {
    use std::time::SystemTime;
    let now = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .unwrap_or_default();
    let secs = now.as_secs();
    let days = secs / 86400;
    let time_of_day = secs % 86400;
    let hours = time_of_day / 3600;
    let minutes = (time_of_day % 3600) / 60;
    let seconds = time_of_day % 60;

    let (year, month, day) = civil_from_days(days as i64);
    format!(
        "{:04}{:02}{:02}T{:02}{:02}{:02}",
        year, month, day, hours, minutes, seconds
    )
}

/// Gregorian civil date from day count since Unix epoch.
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

/// Parse a 0x-prefixed hex address string into 20 bytes.
pub fn parse_hex_address(hex_str: &str) -> Result<[u8; 20]> {
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
