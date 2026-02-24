use std::{
    env,
    fs,
    path::{Path, PathBuf},
    time::Instant,
};

use anyhow::{anyhow, bail, Context, Result};
use clap::{Parser, Subcommand};
use risc0_zkvm::{default_prover, ExecutorEnv, InnerReceipt, ProverOpts, Receipt};
use serde::{Deserialize, Serialize};
use shadow_proof_core::{evaluate_claim, unpack_journal, ClaimInput, ClaimJournal, MAX_NOTES};
use shadow_risc0_methods::{SHADOW_CLAIM_GUEST_ELF, SHADOW_CLAIM_GUEST_ID};

#[derive(Debug, Parser)]
#[command(name = "shadow-risc0-host")]
#[command(about = "Local RISC Zero prover for Shadow claims")]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Debug, Subcommand)]
enum Command {
    /// Generate a proof receipt and journal from an input JSON file.
    Prove {
        #[arg(long)]
        input: PathBuf,
        #[arg(long, default_value = "build/risc0/receipt.bin")]
        receipt: PathBuf,
        #[arg(long, default_value = "build/risc0/journal.json")]
        journal: PathBuf,
        #[arg(long, default_value = "composite")]
        receipt_kind: String,
    },
    /// Verify an existing receipt and print decoded journal.
    Verify {
        #[arg(long, default_value = "build/risc0/receipt.bin")]
        receipt: PathBuf,
    },
    /// Validate and inspect an input without running the prover.
    Inspect {
        #[arg(long)]
        input: PathBuf,
    },
    /// Export seal+journal bytes from a receipt for on-chain verification payloads.
    ExportProof {
        #[arg(long, default_value = "build/risc0/receipt.bin")]
        receipt: PathBuf,
        #[arg(long, default_value = "build/risc0/proof.json")]
        out: PathBuf,
    },
    /// Compress a succinct receipt to Groth16 for on-chain verification.
    /// This step requires Docker to be available.
    Compress {
        #[arg(long)]
        receipt: PathBuf,
        #[arg(long, default_value = "build/risc0/groth16-receipt.bin")]
        out: PathBuf,
    },
}

fn main() -> Result<()> {
    configure_risc0_env();

    let cli = Cli::parse();

    match cli.command {
        Command::Prove {
            input,
            receipt,
            journal,
            receipt_kind,
        } => cmd_prove(&input, &receipt, &journal, &receipt_kind),
        Command::Verify { receipt } => cmd_verify(&receipt),
        Command::Inspect { input } => cmd_inspect(&input),
        Command::ExportProof { receipt, out } => cmd_export_proof(&receipt, &out),
        Command::Compress { receipt, out } => cmd_compress(&receipt, &out),
    }
}

fn configure_risc0_env() {
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
            PathBuf::from(home).join(".risc0/extensions/v1.2.6-cargo-risczero-aarch64-apple-darwin/r0vm"),
        );
    }

    for candidate in candidates {
        if candidate.is_file() {
            env::set_var("RISC0_SERVER_PATH", candidate);
            break;
        }
    }
}

fn cmd_prove(input_path: &Path, receipt_path: &Path, journal_path: &Path, receipt_kind: &str) -> Result<()> {
    let input = load_claim_input(input_path)?;

    let env = ExecutorEnv::builder()
        .write(&input)
        .context("failed writing claim input to executor env")?
        .build()
        .context("failed to build executor env")?;

    let started = Instant::now();
    let opts = parse_prover_opts(receipt_kind)?;
    let prove_info = default_prover()
        .prove_with_opts(env, SHADOW_CLAIM_GUEST_ELF, &opts)
        .context("prover execution failed")?;
    let receipt = prove_info.receipt;
    let elapsed = started.elapsed();

    receipt
        .verify(SHADOW_CLAIM_GUEST_ID)
        .context("receipt verification failed immediately after proving")?;

    let journal = match unpack_journal(&receipt.journal.bytes) {
        Ok(journal) => journal,
        Err(packed_err) => receipt
            .journal
            .decode::<ClaimJournal>()
            .with_context(|| format!("failed decoding claim journal; packed decode error: {packed_err}"))?,
    };

    write_receipt(receipt_path, &receipt)?;
    write_json(journal_path, &journal)?;

    println!("Proved successfully in {:.2?}", elapsed);
    println!("Receipt: {}", receipt_path.display());
    println!("Journal: {}", journal_path.display());
    println!("Nullifier: 0x{}", hex::encode(journal.nullifier));
    println!("Receipt kind: {}", describe_receipt_kind(&receipt.inner));

    Ok(())
}

fn cmd_verify(receipt_path: &Path) -> Result<()> {
    let receipt = read_receipt(receipt_path)?;
    receipt
        .verify(SHADOW_CLAIM_GUEST_ID)
        .context("receipt verification failed")?;

    let journal = match unpack_journal(&receipt.journal.bytes) {
        Ok(journal) => journal,
        Err(packed_err) => receipt
            .journal
            .decode::<ClaimJournal>()
            .with_context(|| format!("failed decoding claim journal; packed decode error: {packed_err}"))?,
    };

    println!("Receipt verified: {}", receipt_path.display());
    println!("Nullifier: 0x{}", hex::encode(journal.nullifier));
    // Proof depth is not part of the public journal; it is validated inside the guest.

    Ok(())
}

fn cmd_inspect(input_path: &Path) -> Result<()> {
    let input = load_claim_input(input_path)?;
    let journal = evaluate_claim(&input).map_err(|e| anyhow!("claim evaluation failed: {}", e.as_str()))?;

    let notes_hash = shadow_proof_core::compute_notes_hash(
        input.note_count as usize,
        &input.amounts,
        &input.recipient_hashes,
    )
    .map_err(|e| anyhow!("notes hash evaluation failed: {}", e.as_str()))?;
    let pow_digest = shadow_proof_core::compute_pow_digest(&notes_hash, &input.secret);

    println!("Input validated: {}", input_path.display());
    println!("blockNumber: {}", journal.block_number);
    println!("chainId: {}", journal.chain_id);
    // noteIndex is a private witness; it is not part of the public journal.
    println!("noteIndex: {}", input.note_index);
    println!("amount: {}", journal.amount);
    println!("nullifier: 0x{}", hex::encode(journal.nullifier));
    println!("powDigest: 0x{}", hex::encode(pow_digest));

    Ok(())
}

#[derive(Debug, Serialize)]
struct ExportedProof {
    receipt_kind: String,
    seal_hex: String,
    journal_hex: String,
}

fn cmd_export_proof(receipt_path: &Path, out_path: &Path) -> Result<()> {
    let receipt = read_receipt(receipt_path)?;

    let (receipt_kind, seal_bytes) = match &receipt.inner {
        InnerReceipt::Succinct(inner) => ("succinct".to_string(), inner.get_seal_bytes()),
        InnerReceipt::Groth16(inner) => {
            use risc0_zkvm::Groth16ReceiptVerifierParameters;
            use risc0_zkvm::sha::Digestible as _;

            // EVM verifier expects: 4-byte selector prefix || abi.encode(Seal).
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

    let exported = ExportedProof {
        receipt_kind,
        seal_hex: format!("0x{}", hex::encode(seal_bytes)),
        journal_hex: format!("0x{}", hex::encode(receipt.journal.bytes)),
    };
    write_json(out_path, &exported)?;
    println!("Exported proof payload: {}", out_path.display());
    Ok(())
}

fn cmd_compress(receipt_path: &Path, out_path: &Path) -> Result<()> {
    let receipt = read_receipt(receipt_path)?;

    // Verify it's a succinct receipt
    match &receipt.inner {
        InnerReceipt::Succinct(_) => {}
        InnerReceipt::Groth16(_) => bail!("Receipt is already Groth16"),
        InnerReceipt::Composite(_) => bail!(
            "Cannot compress composite receipt directly to Groth16; use --receipt-kind succinct first"
        ),
        _ => bail!("Unsupported receipt type for compression"),
    }

    println!("Compressing succinct receipt to Groth16...");
    println!("This step requires Docker and may take several minutes.");

    let started = Instant::now();
    let prover = default_prover();
    let compressed = prover
        .compress(&ProverOpts::groth16(), &receipt)
        .context("failed to compress receipt to Groth16")?;
    let elapsed = started.elapsed();

    // Verify the compressed receipt
    compressed
        .verify(SHADOW_CLAIM_GUEST_ID)
        .context("compressed receipt verification failed")?;

    write_receipt(out_path, &compressed)?;

    println!("Compressed to Groth16 in {:.2?}", elapsed);
    println!("Output: {}", out_path.display());
    println!("Receipt kind: {}", describe_receipt_kind(&compressed.inner));

    Ok(())
}

fn parse_prover_opts(receipt_kind: &str) -> Result<ProverOpts> {
    match receipt_kind {
        "composite" => Ok(ProverOpts::composite()),
        "succinct" => Ok(ProverOpts::succinct()),
        "groth16" => Ok(ProverOpts::groth16()),
        _ => bail!("unsupported receipt kind: {receipt_kind} (expected composite|succinct|groth16)"),
    }
}

fn describe_receipt_kind(inner: &InnerReceipt) -> &'static str {
    match inner {
        InnerReceipt::Composite(_) => "composite",
        InnerReceipt::Succinct(_) => "succinct",
        InnerReceipt::Groth16(_) => "groth16",
        InnerReceipt::Fake(_) => "fake",
        _ => "unknown",
    }
}

fn write_receipt(path: &Path, receipt: &Receipt) -> Result<()> {
    ensure_parent(path)?;
    let bytes = bincode::serialize(receipt).context("failed serializing receipt")?;
    fs::write(path, bytes).with_context(|| format!("failed writing receipt to {}", path.display()))?;
    Ok(())
}

fn read_receipt(path: &Path) -> Result<Receipt> {
    let bytes = fs::read(path).with_context(|| format!("failed reading receipt {}", path.display()))?;
    let receipt = bincode::deserialize(&bytes).context("failed deserializing receipt")?;
    Ok(receipt)
}

fn write_json<T: serde::Serialize>(path: &Path, value: &T) -> Result<()> {
    ensure_parent(path)?;
    let encoded = serde_json::to_vec_pretty(value).context("failed encoding json")?;
    fs::write(path, encoded).with_context(|| format!("failed writing json {}", path.display()))?;
    Ok(())
}

fn ensure_parent(path: &Path) -> Result<()> {
    let parent = path
        .parent()
        .ok_or_else(|| anyhow!("path has no parent: {}", path.display()))?;
    fs::create_dir_all(parent)
        .with_context(|| format!("failed creating parent dir {}", parent.display()))?;
    Ok(())
}

#[derive(Debug, Deserialize)]
struct LegacyClaimInput {
    #[serde(rename = "blockNumber")]
    block_number: String,
    #[serde(rename = "blockHash")]
    block_hash: Vec<String>,
    #[serde(rename = "blockHeaderRlp")]
    block_header_rlp: Vec<String>,
    #[serde(rename = "chainId")]
    chain_id: String,
    #[serde(rename = "noteIndex")]
    note_index: String,
    amount: String,
    recipient: Vec<String>,
    secret: Vec<String>,
    #[serde(rename = "noteCount")]
    note_count: String,
    amounts: Vec<String>,
    #[serde(rename = "recipientHashes")]
    recipient_hashes: Vec<Vec<String>>,
    #[serde(rename = "proofDepth")]
    proof_depth: String,
    #[serde(rename = "proofNodes")]
    proof_nodes: Vec<Vec<String>>,
    #[serde(rename = "proofNodeLengths")]
    proof_node_lengths: Vec<String>,
}

fn load_claim_input(path: &Path) -> Result<ClaimInput> {
    let raw = fs::read(path).with_context(|| format!("failed reading input {}", path.display()))?;

    if let Ok(native) = serde_json::from_slice::<ClaimInput>(&raw) {
        return Ok(native);
    }

    let legacy: LegacyClaimInput = serde_json::from_slice(&raw)
        .with_context(|| format!("failed parsing input as legacy format: {}", path.display()))?;
    legacy_to_input(legacy)
}

fn legacy_to_input(legacy: LegacyClaimInput) -> Result<ClaimInput> {
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
    if let Some(hex) = value.strip_prefix("0x") {
        u32::from_str_radix(hex, 16).with_context(|| format!("invalid u32 hex: {value}"))
    } else {
        value
            .parse::<u32>()
            .with_context(|| format!("invalid u32 value: {value}"))
    }
}

fn parse_u64(value: &str) -> Result<u64> {
    if let Some(hex) = value.strip_prefix("0x") {
        u64::from_str_radix(hex, 16).with_context(|| format!("invalid u64 hex: {value}"))
    } else {
        value
            .parse::<u64>()
            .with_context(|| format!("invalid u64 value: {value}"))
    }
}

fn parse_u128(value: &str) -> Result<u128> {
    if let Some(hex) = value.strip_prefix("0x") {
        u128::from_str_radix(hex, 16).with_context(|| format!("invalid u128 hex: {value}"))
    } else {
        value
            .parse::<u128>()
            .with_context(|| format!("invalid u128 value: {value}"))
    }
}
