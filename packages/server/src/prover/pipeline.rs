//! Proof generation pipeline.
//!
//! Given a deposit file and RPC URL, proves ALL notes in the deposit sequentially
//! and bundles the results into a single proof file.

use std::{path::Path, sync::Arc};

use anyhow::{bail, Context, Result};
use serde::{Deserialize, Serialize};
use shadow_proof_core::{
    compute_notes_hash, compute_recipient_hash, derive_nullifier, derive_target_address,
    ClaimInput, MAX_NODE_BYTES, MAX_NOTES,
};

use super::{
    queue::{ProgressExtra, ProofQueue},
    rpc::{self, BlockData},
};

/// Bundled proof file: contains proofs for ALL notes in a deposit.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BundledProof {
    /// Version marker.
    pub version: String,
    /// UTC creation timestamp (`YYYYMMDDTHHMMSS`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub created: Option<String>,
    /// RISC Zero guest image ID (circuit ID) used to generate the proofs (0x-prefixed hex).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub circuit_id: Option<String>,
    /// Deposit file this proof belongs to.
    pub deposit_file: String,
    /// Block number used for all proofs.
    pub block_number: String,
    /// Block hash (0x-prefixed hex).
    pub block_hash: String,
    /// Chain ID.
    pub chain_id: String,
    /// Per-note proof results.
    pub notes: Vec<NoteProofResult>,
}

/// Proof result for a single note.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteProofResult {
    pub note_index: u32,
    pub amount: String,
    pub recipient: String,
    pub nullifier: String,
    /// Groth16 seal bytes (0x-prefixed hex). Empty if `prove` feature disabled.
    pub seal: String,
    /// Journal bytes (0x-prefixed hex). Empty if `prove` feature disabled.
    pub journal: String,
    /// ABI-encoded `(bytes seal, bytes journal)` for direct on-chain use.
    /// Empty string if proof generation is not available (feature `prove` disabled).
    pub proof: String,
    /// Base64-encoded receipt (for verification/re-export).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub receipt_base64: Option<String>,
}

/// Run the proof pipeline for a deposit file.
///
/// This function:
/// 1. Loads and validates the deposit file
/// 2. Fetches block data and account proof via RPC
/// 3. Proves each note sequentially
/// 4. Returns the bundled proof
pub async fn run_pipeline(
    workspace: &Path,
    deposit_filename: &str,
    rpc_url: &str,
    queue: Arc<ProofQueue>,
    mut cancel_rx: tokio::sync::oneshot::Receiver<()>,
) -> Result<BundledProof> {
    let deposit_path = workspace.join(deposit_filename);
    let pipeline_start = std::time::Instant::now();

    // 1. Load and parse deposit
    let raw = std::fs::read(&deposit_path)
        .with_context(|| format!("failed reading {}", deposit_filename))?;

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct DepositJson {
        version: String,
        chain_id: String,
        secret: String,
        notes: Vec<NoteJson>,
        target_address: Option<String>,
    }

    #[derive(Deserialize)]
    struct NoteJson {
        recipient: String,
        amount: String,
    }

    let deposit: DepositJson = serde_json::from_slice(&raw)?;
    if deposit.version != "v2" {
        bail!("unsupported deposit version: {}", deposit.version);
    }

    let chain_id: u64 = deposit.chain_id.parse()?;
    let secret = parse_hex_bytes32(&deposit.secret)?;
    let note_count = deposit.notes.len();

    if note_count == 0 || note_count > MAX_NOTES {
        bail!("invalid note count: {}", note_count);
    }

    tracing::info!(
        deposit = %deposit_filename,
        chain_id = chain_id,
        note_count = note_count,
        "pipeline started"
    );

    // Derive crypto values
    let mut amounts: Vec<u128> = Vec::new();
    let mut recipients: Vec<[u8; 20]> = Vec::new();
    let mut recipient_hashes: Vec<[u8; 32]> = Vec::new();

    for note in &deposit.notes {
        let recipient = parse_hex_address(&note.recipient)?;
        let amount: u128 = note.amount.parse()?;
        recipients.push(recipient);
        amounts.push(amount);
        recipient_hashes.push(compute_recipient_hash(&recipient));
    }

    let notes_hash = compute_notes_hash(note_count, &amounts, &recipient_hashes)
        .map_err(|e| anyhow::anyhow!("notes hash failed: {}", e.as_str()))?;
    let target_address = derive_target_address(&secret, chain_id, &notes_hash);

    tracing::debug!(
        target_address = %format!("0x{}", hex::encode(target_address)),
        "target address derived"
    );

    // Verify targetAddress if present
    if let Some(ref expected) = deposit.target_address {
        let expected_bytes = parse_hex_address(expected)?;
        if expected_bytes != target_address {
            bail!("targetAddress mismatch");
        }
    }

    // 2. Fetch block data and account proof via RPC
    queue
        .update_progress(
            0,
            "Fetching block data from chain...",
            Some(&ProgressExtra {
                chain_id: Some(chain_id),
                stage: Some("rpc_block".into()),
                ..Default::default()
            }),
        )
        .await;

    let http_client = reqwest::Client::new();

    // Verify chain ID
    let rpc_chain_id = rpc::eth_chain_id(&http_client, rpc_url).await?;
    if rpc_chain_id != chain_id {
        bail!(
            "chain ID mismatch: deposit says {} but RPC returns {}",
            chain_id,
            rpc_chain_id
        );
    }

    tracing::debug!(chain_id = chain_id, "chain ID verified against RPC");

    let block = rpc::eth_get_block(&http_client, rpc_url, "latest").await?;

    tracing::info!(block_number = block.number, "block fetched for proving");

    queue
        .update_progress(
            0,
            "Fetching account proof from Merkle tree...",
            Some(&ProgressExtra {
                chain_id: Some(chain_id),
                block_number: Some(block.number),
                stage: Some("rpc_proof".into()),
                ..Default::default()
            }),
        )
        .await;

    let account_proof =
        rpc::eth_get_proof(&http_client, rpc_url, &target_address, block.number).await?;

    tracing::info!(
        proof_depth = account_proof.proof_nodes.len(),
        "account proof fetched"
    );

    if account_proof.proof_nodes.is_empty() {
        bail!("account proof is empty; target address may not exist on-chain");
    }

    // 3. Prove each note sequentially
    let mut note_results: Vec<NoteProofResult> = Vec::with_capacity(note_count);

    for i in 0..note_count {
        let note_start = std::time::Instant::now();

        // Check for cancellation between notes
        if cancel_rx.try_recv().is_ok() {
            bail!("proof generation cancelled by user");
        }

        tracing::info!(
            note = i,
            total = note_count,
            amount = amounts[i],
            "proving note"
        );

        queue
            .update_progress(
                i as u32,
                &format!("Proving note {}/{}", i + 1, note_count),
                Some(&ProgressExtra {
                    block_number: Some(block.number),
                    chain_id: Some(chain_id),
                    elapsed_secs: Some(pipeline_start.elapsed().as_secs_f64()),
                    stage: Some("proving".into()),
                    ..Default::default()
                }),
            )
            .await;

        let nullifier = derive_nullifier(&secret, chain_id, i as u32);

        let claim_input = build_claim_input(
            &block,
            chain_id,
            i as u32,
            amounts[i],
            &recipients[i],
            &secret,
            note_count as u32,
            &amounts,
            &recipient_hashes,
            &account_proof.proof_nodes,
        )?;

        // Race the prover against the cancel signal so Kill takes effect
        // immediately even during a long RISC Zero computation.
        let note_proof = tokio::select! {
            result = prove_single_note(claim_input) => match result {
                Ok(p) => p,
                Err(e) => {
                    // Log full cause chain to server terminal for diagnosis
                    let chain: Vec<String> = std::iter::once(e.to_string())
                        .chain(e.chain().skip(1).map(|c| c.to_string()))
                        .collect();
                    tracing::error!(note = i, detail = %chain.join(" | "), "prove_single_note failed");
                    return Err(e);
                }
            },
            _ = &mut cancel_rx => bail!("proof generation cancelled by user"),
        };

        let note_elapsed = note_start.elapsed();
        tracing::info!(
            note = i,
            elapsed_secs = note_elapsed.as_secs_f64(),
            seal_len = note_proof.seal_hex.len() / 2,
            journal_len = note_proof.journal_hex.len() / 2,
            "note proved"
        );

        queue
            .update_progress(
                i as u32,
                &format!(
                    "Note {}/{} proved in {:.1}s",
                    i + 1,
                    note_count,
                    note_elapsed.as_secs_f64()
                ),
                Some(&ProgressExtra {
                    block_number: Some(block.number),
                    chain_id: Some(chain_id),
                    elapsed_secs: Some(pipeline_start.elapsed().as_secs_f64()),
                    note_elapsed_secs: Some(note_elapsed.as_secs_f64()),
                    stage: Some("note_complete".into()),
                    ..Default::default()
                }),
            )
            .await;

        note_results.push(NoteProofResult {
            note_index: i as u32,
            amount: amounts[i].to_string(),
            recipient: format!("0x{}", hex::encode(recipients[i])),
            nullifier: format!("0x{}", hex::encode(nullifier)),
            seal: note_proof.seal_hex,
            journal: note_proof.journal_hex,
            proof: note_proof.proof_hex,
            receipt_base64: note_proof.receipt_base64,
        });
    }

    // 4. Bundle results
    let bundled = BundledProof {
        version: "v2".to_string(),
        created: None,
        circuit_id: None,
        deposit_file: deposit_filename.to_string(),
        block_number: block.number.to_string(),
        block_hash: format!("0x{}", hex::encode(block.hash)),
        chain_id: chain_id.to_string(),
        notes: note_results,
    };

    tracing::info!(
        deposit = %deposit_filename,
        total_elapsed_secs = pipeline_start.elapsed().as_secs_f64(),
        notes_proved = bundled.notes.len(),
        "pipeline completed"
    );

    Ok(bundled)
}

/// Build a ClaimInput for a single note.
fn build_claim_input(
    block: &BlockData,
    chain_id: u64,
    note_index: u32,
    amount: u128,
    recipient: &[u8; 20],
    secret: &[u8; 32],
    note_count: u32,
    amounts: &[u128],
    recipient_hashes: &[[u8; 32]],
    proof_nodes: &[Vec<u8>],
) -> Result<ClaimInput> {
    let proof_depth = proof_nodes.len() as u32;

    tracing::debug!(
        note_index = note_index,
        proof_depth = proof_depth,
        block_number = block.number,
        "building ClaimInput"
    );

    if proof_depth == 0 {
        bail!("empty account proof");
    }

    // Trim proof nodes to their actual lengths (no padding needed)
    let mut trimmed_nodes = Vec::with_capacity(proof_nodes.len());
    let mut node_lengths = Vec::with_capacity(proof_nodes.len());
    for node in proof_nodes {
        if node.len() > MAX_NODE_BYTES {
            bail!(
                "proof node exceeds {} bytes (got {})",
                MAX_NODE_BYTES,
                node.len()
            );
        }
        node_lengths.push(node.len() as u32);
        trimmed_nodes.push(node.clone());
    }

    Ok(ClaimInput {
        block_number: block.number,
        block_hash: block.hash,
        chain_id,
        note_index,
        amount,
        recipient: *recipient,
        secret: *secret,
        note_count,
        amounts: amounts.to_vec(),
        recipient_hashes: recipient_hashes.to_vec(),
        block_header_rlp: block.header_rlp.clone(),
        proof_depth,
        proof_nodes: trimmed_nodes,
        proof_node_lengths: node_lengths,
    })
}

struct SingleNoteProof {
    seal_hex: String,
    journal_hex: String,
    proof_hex: String,
    receipt_base64: Option<String>,
}

/// Prove a single note. When the `prove` feature is enabled, calls the actual
/// RISC Zero prover. Otherwise, returns a placeholder.
///
/// Receipt kind is controlled by the `RECEIPT_KIND` environment variable:
/// - "groth16" (default in Docker) — produces on-chain-ready proofs
/// - "succinct" — faster, but needs separate compression for on-chain use
async fn prove_single_note(input: ClaimInput) -> Result<SingleNoteProof> {
    #[cfg(feature = "prove")]
    {
        use shadow_prover_lib::{configure_risc0_env, export_proof, prove_claim};

        // Spawn a dedicated thread off the tokio blocking pool.
        // The heavy recursive STARK work happens in Rayon workers which inherit
        // RUST_MIN_STACK (set to 256 MB in configure_risc0_env). This thread
        // only orchestrates, so 8 MB matches the Linux thread default.
        tracing::info!("spawning prover thread");
        let (tx, rx) = tokio::sync::oneshot::channel::<Result<SingleNoteProof>>();
        let note_index = input.note_index;
        std::thread::Builder::new()
            .name("shadow-prover".into())
            .stack_size(256 * 1024 * 1024)
            .spawn(move || {
                let outcome = (|| {
                    tracing::info!(note_index = note_index, "prover thread started");
                    configure_risc0_env();
                    let receipt_kind =
                        std::env::var("RECEIPT_KIND").unwrap_or_else(|_| "groth16".into());
                    tracing::info!(
                        note_index = note_index,
                        receipt_kind = %receipt_kind,
                        "RISC Zero env configured"
                    );
                    let prove_result = prove_claim(&input, &receipt_kind)?;
                    tracing::info!(
                        note_index = note_index,
                        elapsed_secs = prove_result.elapsed.as_secs_f64(),
                        "prove_claim completed; exporting proof"
                    );
                    let exported = export_proof(&prove_result.receipt)?;

                    let receipt_bytes =
                        shadow_prover_lib::serialize_receipt(&prove_result.receipt)?;
                    let receipt_b64 = base64_encode(&receipt_bytes);

                    tracing::debug!(
                        seal_len = exported.seal_hex.len() / 2,
                        journal_len = exported.journal_hex.len() / 2,
                        "proof exported"
                    );

                    let journal_bytes = hex::decode(
                        exported
                            .journal_hex
                            .strip_prefix("0x")
                            .unwrap_or(&exported.journal_hex),
                    )?;
                    let proof_calldata =
                        encode_proof_for_chain(&exported.seal_hex, &journal_bytes)?;

                    Ok::<_, anyhow::Error>(SingleNoteProof {
                        seal_hex: exported.seal_hex,
                        journal_hex: exported.journal_hex,
                        proof_hex: format!("0x{}", hex::encode(proof_calldata)),
                        receipt_base64: Some(receipt_b64),
                    })
                })();
                match &outcome {
                    Ok(_) => tracing::info!(note_index = note_index, "prover thread finished"),
                    Err(e) => {
                        let chain: Vec<String> = std::iter::once(e.to_string())
                            .chain(e.chain().skip(1).map(|c| c.to_string()))
                            .collect();
                        tracing::error!(
                            note_index = note_index,
                            detail = %chain.join(" | "),
                            "prover thread failed"
                        );
                    }
                }
                let _ = tx.send(outcome);
            })
            .context("failed to spawn prover thread")?;

        tracing::info!(note_index = note_index, "waiting for prover thread result");
        let result = rx.await.context("prover thread dropped sender")??;

        return Ok(result);
    }

    #[cfg(not(feature = "prove"))]
    {
        // Without the prove feature, we can still validate the input
        let _ = shadow_proof_core::evaluate_claim(&input)
            .map_err(|e| anyhow::anyhow!("claim validation failed: {}", e.as_str()))?;

        Ok(SingleNoteProof {
            seal_hex: String::new(),
            journal_hex: String::new(),
            proof_hex: String::new(),
            receipt_base64: None,
        })
    }
}

// ---------------------------------------------------------------------------
// Hex parsing helpers
// ---------------------------------------------------------------------------

fn parse_hex_bytes32(hex_str: &str) -> Result<[u8; 32]> {
    let stripped = hex_str
        .strip_prefix("0x")
        .or_else(|| hex_str.strip_prefix("0X"))
        .context("expected 0x prefix")?;
    let bytes = hex::decode(stripped)?;
    if bytes.len() != 32 {
        bail!("expected 32 bytes, got {}", bytes.len());
    }
    let mut out = [0u8; 32];
    out.copy_from_slice(&bytes);
    Ok(out)
}

fn parse_hex_address(hex_str: &str) -> Result<[u8; 20]> {
    let stripped = hex_str
        .strip_prefix("0x")
        .or_else(|| hex_str.strip_prefix("0X"))
        .context("expected 0x prefix")?;
    let bytes = hex::decode(stripped)?;
    if bytes.len() != 20 {
        bail!("expected 20 bytes, got {}", bytes.len());
    }
    let mut out = [0u8; 20];
    out.copy_from_slice(&bytes);
    Ok(out)
}

#[cfg(feature = "prove")]
fn base64_encode(data: &[u8]) -> String {
    const CHARSET: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::new();
    for chunk in data.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = if chunk.len() > 1 { chunk[1] as u32 } else { 0 };
        let b2 = if chunk.len() > 2 { chunk[2] as u32 } else { 0 };
        let triple = (b0 << 16) | (b1 << 8) | b2;
        out.push(CHARSET[((triple >> 18) & 0x3F) as usize] as char);
        out.push(CHARSET[((triple >> 12) & 0x3F) as usize] as char);
        if chunk.len() > 1 {
            out.push(CHARSET[((triple >> 6) & 0x3F) as usize] as char);
        } else {
            out.push('=');
        }
        if chunk.len() > 2 {
            out.push(CHARSET[(triple & 0x3F) as usize] as char);
        } else {
            out.push('=');
        }
    }
    out
}

/// Encode proof for on-chain `Risc0CircuitVerifier.decodeProof()`.
///
/// The contract decodes: `(bytes seal, bytes journal) = abi.decode(_proof, (bytes, bytes))`
/// SHA-256 of the journal is computed inside the contract; we pass the full journal bytes.
#[cfg(feature = "prove")]
fn encode_proof_for_chain(seal_hex: &str, journal_bytes: &[u8]) -> Result<Vec<u8>> {
    let seal = hex::decode(seal_hex.strip_prefix("0x").unwrap_or(seal_hex))?;

    let seal_padded_len = (seal.len() + 31) / 32 * 32;
    let journal_padded_len = (journal_bytes.len() + 31) / 32 * 32;

    // ABI encode: (bytes seal, bytes journal)
    // Head: offset_seal (32) | offset_journal (32)
    // Tail: seal_len (32) + seal_data (padded) + journal_len (32) + journal_data (padded)
    let mut encoded = Vec::new();

    // Offset of seal: 64 (past the two head slots)
    let mut seal_offset = [0u8; 32];
    seal_offset[28..32].copy_from_slice(&64u32.to_be_bytes());
    encoded.extend_from_slice(&seal_offset);

    // Offset of journal: 64 + 32 + seal_padded_len
    let journal_offset = 64u32 + 32 + seal_padded_len as u32;
    let mut j_offset = [0u8; 32];
    j_offset[28..32].copy_from_slice(&journal_offset.to_be_bytes());
    encoded.extend_from_slice(&j_offset);

    // Seal length + data
    let mut seal_len = [0u8; 32];
    seal_len[28..32].copy_from_slice(&(seal.len() as u32).to_be_bytes());
    encoded.extend_from_slice(&seal_len);
    encoded.extend_from_slice(&seal);
    encoded.extend(std::iter::repeat(0u8).take(seal_padded_len - seal.len()));

    // Journal length + data
    let mut journal_len = [0u8; 32];
    journal_len[28..32].copy_from_slice(&(journal_bytes.len() as u32).to_be_bytes());
    encoded.extend_from_slice(&journal_len);
    encoded.extend_from_slice(journal_bytes);
    encoded.extend(std::iter::repeat(0u8).take(journal_padded_len - journal_bytes.len()));

    Ok(encoded)
}
