//! Shadow prover library — core proving, verifying, exporting, and compressing logic.
//!
//! This crate extracts the proof generation pipeline from the `shadow-risc0-host` CLI
//! so it can be shared between the CLI binary and the backend server.

pub mod deposit;

use std::{
    env,
    fs,
    path::{Path, PathBuf},
    time::Instant,
};

use anyhow::{anyhow, bail, Context, Result};
use risc0_zkvm::{default_prover, ExecutorEnv, InnerReceipt, ProverOpts, Receipt};
use serde::{Deserialize, Serialize};
use shadow_proof_core::{evaluate_claim, unpack_journal, ClaimInput, ClaimJournal, MAX_NOTES};
use shadow_risc0_methods::{SHADOW_CLAIM_GUEST_ELF, SHADOW_CLAIM_GUEST_ID};

// Re-export types that callers need
pub use shadow_proof_core::{ClaimInput as ClaimInputCore, ClaimJournal as ClaimJournalCore};

/// The RISC Zero guest program image ID (circuit ID).
pub fn circuit_id() -> [u32; 8] {
    SHADOW_CLAIM_GUEST_ID
}

/// The RISC Zero guest program image ID as a hex string (0x-prefixed, 64 hex chars).
///
/// The encoding matches `Digest::as_bytes()` (i.e. `bytemuck::cast_slice`),
/// which serialises each `u32` word in **native** (little-endian on ARM/x86)
/// byte order, words 0 → 7.  This is the representation the on-chain
/// `RiscZeroGroth16Verifier.verify()` expects for `imageId`.
pub fn circuit_id_hex() -> String {
    let id = SHADOW_CLAIM_GUEST_ID;
    let bytes: Vec<u8> = id.iter().flat_map(|w| w.to_le_bytes()).collect();
    format!("0x{}", hex::encode(bytes))
}

/// Exported proof payload for on-chain submission.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExportedProof {
    pub receipt_kind: String,
    pub seal_hex: String,
    pub journal_hex: String,
}

/// Result of a proof generation run.
pub struct ProveResult {
    pub receipt: Receipt,
    pub journal: ClaimJournal,
    pub elapsed: std::time::Duration,
}

/// Configure RISC Zero environment variables for local proving.
pub fn configure_risc0_env() {
    // RISC Zero uses Rayon internally for parallel segment proving. On macOS,
    // spawned threads default to 512KB stack which causes SIGBUS during the
    // deeply recursive STARK computation. Set RUST_MIN_STACK so that Rayon
    // worker threads (created via std::thread::Builder with no explicit stack
    // size) inherit a large stack before the global pool is first initialized.
    if env::var("RUST_MIN_STACK").is_err() {
        env::set_var("RUST_MIN_STACK", "268435456"); // 256 MB
    }

    if env::var("RISC0_PROVER").is_err() {
        env::set_var("RISC0_PROVER", "local");
    }

    if env::var("RISC0_PROVER").ok().as_deref() != Some("ipc") || env::var("RISC0_SERVER_PATH").is_ok() {
        return;
    }

    let mut candidates = Vec::new();
    if let Ok(home) = env::var("HOME") {
        candidates.push(PathBuf::from(&home).join(".cargo/bin/r0vm"));
        candidates.push(
            PathBuf::from(home)
                .join(".risc0/extensions/v1.2.6-cargo-risczero-aarch64-apple-darwin/r0vm"),
        );
    }

    for candidate in candidates {
        if candidate.is_file() {
            env::set_var("RISC0_SERVER_PATH", candidate);
            break;
        }
    }
}

/// Generate a proof for a claim input.
///
/// Returns the receipt and decoded journal.
pub fn prove_claim(input: &ClaimInput, receipt_kind: &str) -> Result<ProveResult> {
    let env = ExecutorEnv::builder()
        .write(input)
        .context("failed writing claim input to executor env")?
        .build()
        .context("failed to build executor env")?;

    let started = Instant::now();
    let opts = parse_prover_opts(receipt_kind)?;
    let prove_info = default_prover()
        .prove_with_opts(env, SHADOW_CLAIM_GUEST_ELF, &opts)
        .map_err(|e| {
            // Build full cause chain for diagnostic output
            let chain: Vec<String> = std::iter::once(e.to_string())
                .chain(e.chain().skip(1).map(|c| c.to_string()))
                .collect();
            anyhow::anyhow!("prover execution failed: {}", chain.join(" | "))
        })?;
    let receipt = prove_info.receipt;
    let elapsed = started.elapsed();

    receipt
        .verify(SHADOW_CLAIM_GUEST_ID)
        .context("receipt verification failed immediately after proving")?;

    let journal = decode_journal(&receipt)?;

    Ok(ProveResult {
        receipt,
        journal,
        elapsed,
    })
}

/// Verify an existing receipt and return the decoded journal.
pub fn verify_receipt(receipt: &Receipt) -> Result<ClaimJournal> {
    receipt
        .verify(SHADOW_CLAIM_GUEST_ID)
        .context("receipt verification failed")?;
    decode_journal(receipt)
}

/// Validate and evaluate a claim input without running the prover.
///
/// Returns the expected journal (as if the proof succeeded).
pub fn inspect_claim(input: &ClaimInput) -> Result<ClaimJournal> {
    evaluate_claim(input).map_err(|e| anyhow!("claim evaluation failed: {}", e.as_str()))
}

/// Export seal+journal bytes from a receipt for on-chain verification.
pub fn export_proof(receipt: &Receipt) -> Result<ExportedProof> {
    let (receipt_kind, seal_bytes) = match &receipt.inner {
        InnerReceipt::Succinct(inner) => ("succinct".to_string(), inner.get_seal_bytes()),
        InnerReceipt::Groth16(inner) => {
            use risc0_zkvm::sha::Digestible as _;
            use risc0_zkvm::Groth16ReceiptVerifierParameters;

            let selector = {
                let digest = Groth16ReceiptVerifierParameters::default().digest();
                let mut out = [0u8; 4];
                out.copy_from_slice(&digest.as_bytes()[..4]);
                out
            };

            let mut out = Vec::with_capacity(4 + inner.seal.len());
            out.extend_from_slice(&selector);
            out.extend_from_slice(&inner.seal);
            ("groth16".to_string(), out)
        }
        InnerReceipt::Composite(_) => bail!(
            "cannot export on-chain proof from composite receipt; re-run prove with --receipt-kind succinct"
        ),
        InnerReceipt::Fake(_) => bail!("cannot export on-chain proof from fake receipt"),
        _ => bail!("unsupported receipt type for export"),
    };

    Ok(ExportedProof {
        receipt_kind,
        seal_hex: format!("0x{}", hex::encode(seal_bytes)),
        journal_hex: format!("0x{}", hex::encode(&receipt.journal.bytes)),
    })
}

/// Compress a succinct receipt to Groth16 for on-chain verification.
pub fn compress_receipt(receipt: &Receipt) -> Result<Receipt> {
    match &receipt.inner {
        InnerReceipt::Succinct(_) => {}
        InnerReceipt::Groth16(_) => bail!("Receipt is already Groth16"),
        InnerReceipt::Composite(_) => bail!(
            "Cannot compress composite receipt directly to Groth16; use --receipt-kind succinct first"
        ),
        _ => bail!("Unsupported receipt type for compression"),
    }

    let prover = default_prover();
    let compressed = prover
        .compress(&ProverOpts::groth16(), receipt)
        .context("failed to compress receipt to Groth16")?;

    compressed
        .verify(SHADOW_CLAIM_GUEST_ID)
        .context("compressed receipt verification failed")?;

    Ok(compressed)
}

/// Describe the receipt kind as a human-readable string.
pub fn describe_receipt_kind(inner: &InnerReceipt) -> &'static str {
    match inner {
        InnerReceipt::Composite(_) => "composite",
        InnerReceipt::Succinct(_) => "succinct",
        InnerReceipt::Groth16(_) => "groth16",
        InnerReceipt::Fake(_) => "fake",
        _ => "unknown",
    }
}

/// Serialize a receipt to bytes (bincode format).
pub fn serialize_receipt(receipt: &Receipt) -> Result<Vec<u8>> {
    bincode::serialize(receipt).context("failed serializing receipt")
}

/// Deserialize a receipt from bytes (bincode format).
pub fn deserialize_receipt(bytes: &[u8]) -> Result<Receipt> {
    bincode::deserialize(bytes).context("failed deserializing receipt")
}

/// Write a receipt to a file (bincode format).
pub fn write_receipt(path: &Path, receipt: &Receipt) -> Result<()> {
    ensure_parent(path)?;
    let bytes = serialize_receipt(receipt)?;
    fs::write(path, bytes).with_context(|| format!("failed writing receipt to {}", path.display()))?;
    Ok(())
}

/// Read a receipt from a file (bincode format).
pub fn read_receipt(path: &Path) -> Result<Receipt> {
    let bytes = fs::read(path).with_context(|| format!("failed reading receipt {}", path.display()))?;
    deserialize_receipt(&bytes)
}

/// Write a value as pretty-printed JSON to a file.
pub fn write_json<T: serde::Serialize>(path: &Path, value: &T) -> Result<()> {
    ensure_parent(path)?;
    let encoded = serde_json::to_vec_pretty(value).context("failed encoding json")?;
    fs::write(path, encoded).with_context(|| format!("failed writing json {}", path.display()))?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Legacy input parsing
// ---------------------------------------------------------------------------

/// Legacy claim input format (from JS CLI's JSON output).
#[derive(Debug, Deserialize)]
pub struct LegacyClaimInput {
    #[serde(rename = "blockNumber")]
    pub block_number: String,
    #[serde(rename = "blockHash")]
    pub block_hash: Vec<String>,
    #[serde(rename = "blockHeaderRlp")]
    pub block_header_rlp: Vec<String>,
    #[serde(rename = "chainId")]
    pub chain_id: String,
    #[serde(rename = "noteIndex")]
    pub note_index: String,
    pub amount: String,
    pub recipient: Vec<String>,
    pub secret: Vec<String>,
    #[serde(rename = "noteCount")]
    pub note_count: String,
    pub amounts: Vec<String>,
    #[serde(rename = "recipientHashes")]
    pub recipient_hashes: Vec<Vec<String>>,
    #[serde(rename = "proofDepth")]
    pub proof_depth: String,
    #[serde(rename = "proofNodes")]
    pub proof_nodes: Vec<Vec<String>>,
    #[serde(rename = "proofNodeLengths")]
    pub proof_node_lengths: Vec<String>,
}

/// Load a claim input from a JSON file (supports both native and legacy formats).
pub fn load_claim_input(path: &Path) -> Result<ClaimInput> {
    let raw = fs::read(path).with_context(|| format!("failed reading input {}", path.display()))?;

    if let Ok(native) = serde_json::from_slice::<ClaimInput>(&raw) {
        return Ok(native);
    }

    let legacy: LegacyClaimInput = serde_json::from_slice(&raw)
        .with_context(|| format!("failed parsing input as legacy format: {}", path.display()))?;
    legacy_to_input(legacy)
}

/// Convert a legacy claim input to the native format.
pub fn legacy_to_input(legacy: LegacyClaimInput) -> Result<ClaimInput> {
    let note_count = parse_u32(&legacy.note_count)?;
    let proof_depth = parse_u32(&legacy.proof_depth)?;

    if note_count == 0 || note_count as usize > MAX_NOTES {
        bail!("noteCount must be in [1, {}]", MAX_NOTES);
    }

    let block_hash = parse_fixed_u8_array::<32>(&legacy.block_hash)?;
    let block_header_rlp = parse_u8_vec(&legacy.block_header_rlp)?;
    let recipient = parse_fixed_u8_array::<20>(&legacy.recipient)?;
    let secret = parse_fixed_u8_array::<32>(&legacy.secret)?;

    if legacy.amounts.len() < note_count as usize {
        bail!("amounts length is smaller than noteCount");
    }
    if legacy.recipient_hashes.len() < note_count as usize {
        bail!("recipientHashes length is smaller than noteCount");
    }
    if legacy.proof_nodes.len() < proof_depth as usize {
        bail!("proofNodes length is smaller than proofDepth");
    }
    if legacy.proof_node_lengths.len() < proof_depth as usize {
        bail!("proofNodeLengths length is smaller than proofDepth");
    }

    let mut amounts = Vec::with_capacity(note_count as usize);
    for i in 0..note_count as usize {
        amounts.push(parse_u128(&legacy.amounts[i])?);
    }

    let mut recipient_hashes = Vec::with_capacity(note_count as usize);
    for i in 0..note_count as usize {
        recipient_hashes.push(parse_fixed_u8_array::<32>(&legacy.recipient_hashes[i])?);
    }

    let mut proof_nodes = Vec::with_capacity(proof_depth as usize);
    let mut proof_node_lengths = Vec::with_capacity(proof_depth as usize);
    for i in 0..proof_depth as usize {
        let declared_len = parse_u32(&legacy.proof_node_lengths[i])?;
        let full_node = &legacy.proof_nodes[i];
        if full_node.len() < declared_len as usize {
            bail!("proof node {} shorter than declared length", i);
        }

        let mut node = Vec::with_capacity(declared_len as usize);
        for entry in full_node.iter().take(declared_len as usize) {
            node.push(parse_u8(entry)?);
        }
        proof_nodes.push(node);
        proof_node_lengths.push(declared_len);
    }

    Ok(ClaimInput {
        block_number: parse_u64(&legacy.block_number)?,
        block_hash,
        chain_id: parse_u64(&legacy.chain_id)?,
        note_index: parse_u32(&legacy.note_index)?,
        amount: parse_u128(&legacy.amount)?,
        recipient,
        secret,
        note_count,
        amounts,
        recipient_hashes,
        block_header_rlp,
        proof_depth,
        proof_nodes,
        proof_node_lengths,
    })
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

fn decode_journal(receipt: &Receipt) -> Result<ClaimJournal> {
    match unpack_journal(&receipt.journal.bytes) {
        Ok(journal) => Ok(journal),
        Err(packed_err) => receipt
            .journal
            .decode::<ClaimJournal>()
            .with_context(|| {
                format!(
                    "failed decoding claim journal; packed decode error: {packed_err}"
                )
            }),
    }
}

fn parse_prover_opts(receipt_kind: &str) -> Result<ProverOpts> {
    match receipt_kind {
        "composite" => Ok(ProverOpts::composite()),
        "succinct" => Ok(ProverOpts::succinct()),
        "groth16" => Ok(ProverOpts::groth16()),
        _ => bail!("unsupported receipt kind: {receipt_kind} (expected composite|succinct|groth16)"),
    }
}

fn ensure_parent(path: &Path) -> Result<()> {
    let parent = path
        .parent()
        .ok_or_else(|| anyhow!("path has no parent: {}", path.display()))?;
    fs::create_dir_all(parent)
        .with_context(|| format!("failed creating parent dir {}", parent.display()))?;
    Ok(())
}

fn parse_u8_vec(values: &[String]) -> Result<Vec<u8>> {
    let mut out = Vec::with_capacity(values.len());
    for value in values {
        out.push(parse_u8(value)?);
    }
    Ok(out)
}

fn parse_fixed_u8_array<const N: usize>(values: &[String]) -> Result<[u8; N]> {
    if values.len() != N {
        bail!("expected {} elements, got {}", N, values.len());
    }
    let mut out = [0u8; N];
    for (i, value) in values.iter().enumerate() {
        out[i] = parse_u8(value)?;
    }
    Ok(out)
}

fn parse_u8(value: &str) -> Result<u8> {
    let n = value
        .parse::<u16>()
        .with_context(|| format!("invalid u8 value: {value}"))?;
    u8::try_from(n).map_err(|_| anyhow!("u8 out of range: {value}"))
}

fn parse_u32(value: &str) -> Result<u32> {
    if let Some(hex_str) = value.strip_prefix("0x") {
        u32::from_str_radix(hex_str, 16).with_context(|| format!("invalid u32 hex: {value}"))
    } else {
        value
            .parse::<u32>()
            .with_context(|| format!("invalid u32 value: {value}"))
    }
}

fn parse_u64(value: &str) -> Result<u64> {
    if let Some(hex_str) = value.strip_prefix("0x") {
        u64::from_str_radix(hex_str, 16).with_context(|| format!("invalid u64 hex: {value}"))
    } else {
        value
            .parse::<u64>()
            .with_context(|| format!("invalid u64 value: {value}"))
    }
}

fn parse_u128(value: &str) -> Result<u128> {
    if let Some(hex_str) = value.strip_prefix("0x") {
        u128::from_str_radix(hex_str, 16).with_context(|| format!("invalid u128 hex: {value}"))
    } else {
        value
            .parse::<u128>()
            .with_context(|| format!("invalid u128 value: {value}"))
    }
}
