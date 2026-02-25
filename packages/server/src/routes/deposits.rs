use std::sync::Arc;

use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    routing::{delete, get},
    Json, Router,
};
use serde::{Deserialize, Serialize};

use crate::{
    mining,
    state::AppState,
    workspace::scanner::{scan_workspace, DepositEntry},
};

/// `GET /api/deposits` — list all deposits with summary info.
async fn list_deposits(State(state): State<Arc<AppState>>) -> Json<Vec<DepositEntry>> {
    let index = scan_workspace(&state.workspace);
    Json(index.deposits)
}

/// `GET /api/deposits/:id` — full deposit details.
async fn get_deposit(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> Result<Json<DepositEntry>, StatusCode> {
    let index = scan_workspace(&state.workspace);
    index
        .deposits
        .into_iter()
        .find(|d| d.id == id)
        .map(Json)
        .ok_or(StatusCode::NOT_FOUND)
}

#[derive(Debug, Deserialize)]
struct DeleteQuery {
    #[serde(default)]
    include_proof: bool,
}

#[derive(Debug, Serialize)]
struct DeleteResponse {
    deleted: Vec<String>,
}

/// `DELETE /api/deposits/:id` — delete a deposit file and optionally its proof.
async fn delete_deposit(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    Query(query): Query<DeleteQuery>,
) -> Result<Json<DeleteResponse>, StatusCode> {
    let index = scan_workspace(&state.workspace);
    let entry = index
        .deposits
        .iter()
        .find(|d| d.id == id)
        .ok_or(StatusCode::NOT_FOUND)?;

    let mut deleted = Vec::new();

    // Delete the deposit file
    let deposit_path = state.workspace.join(&entry.filename);
    if deposit_path.is_file() {
        std::fs::remove_file(&deposit_path).map_err(|e| {
            tracing::error!(error = %e, file = %entry.filename, "failed to delete deposit file");
            StatusCode::INTERNAL_SERVER_ERROR
        })?;
        deleted.push(entry.filename.clone());
    }

    // Optionally delete the proof file
    if query.include_proof {
        if let Some(ref proof_name) = entry.proof_file {
            let proof_path = state.workspace.join(proof_name);
            if proof_path.is_file() {
                std::fs::remove_file(&proof_path).map_err(|e| {
                    tracing::error!(error = %e, file = %proof_name, "failed to delete proof file");
                    StatusCode::INTERNAL_SERVER_ERROR
                })?;
                deleted.push(proof_name.clone());
            }
        }
    }

    // Broadcast workspace change
    let _ = state.event_tx.send(
        serde_json::json!({"type": "workspace:changed"}).to_string(),
    );

    Ok(Json(DeleteResponse { deleted }))
}

/// `DELETE /api/deposits/:id/proof` — delete the proof file for a deposit.
async fn delete_proof(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> Result<Json<DeleteResponse>, StatusCode> {
    let index = scan_workspace(&state.workspace);
    let entry = index
        .deposits
        .iter()
        .find(|d| d.id == id)
        .ok_or(StatusCode::NOT_FOUND)?;

    let proof_name = entry
        .proof_file
        .as_ref()
        .ok_or(StatusCode::NOT_FOUND)?;

    let proof_path = state.workspace.join(proof_name);
    if !proof_path.is_file() {
        return Err(StatusCode::NOT_FOUND);
    }

    std::fs::remove_file(&proof_path).map_err(|e| {
        tracing::error!(error = %e, file = %proof_name, "failed to delete proof file");
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    // Broadcast workspace change
    let _ = state.event_tx.send(
        serde_json::json!({"type": "workspace:changed"}).to_string(),
    );

    Ok(Json(DeleteResponse {
        deleted: vec![proof_name.clone()],
    }))
}

// ---------------------------------------------------------------------------
// POST /api/deposits — mine a new deposit
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateDepositRequest {
    chain_id: String,
    notes: Vec<CreateDepositNote>,
    #[serde(default)]
    comment: Option<String>,
}

#[derive(Debug, Deserialize)]
struct CreateDepositNote {
    recipient: String,
    amount: String,
    #[serde(default)]
    label: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct CreateDepositResponse {
    filename: String,
    target_address: String,
    total_amount: String,
    iterations: u64,
}

/// `POST /api/deposits` — mine a new deposit (PoW) and save to workspace.
async fn create_deposit(
    State(state): State<Arc<AppState>>,
    Json(body): Json<CreateDepositRequest>,
) -> Result<Json<CreateDepositResponse>, (StatusCode, String)> {
    // Parse and validate chain ID
    let chain_id: u64 = body.chain_id.parse().map_err(|_| {
        (
            StatusCode::BAD_REQUEST,
            "invalid chainId: must be a decimal number".to_string(),
        )
    })?;

    // Parse and validate notes
    if body.notes.is_empty() || body.notes.len() > 5 {
        return Err((
            StatusCode::BAD_REQUEST,
            "notes must contain 1-5 entries".to_string(),
        ));
    }

    let mut mine_notes = Vec::with_capacity(body.notes.len());
    let mut total_amount: u128 = 0;

    for (i, note) in body.notes.iter().enumerate() {
        let recipient = mining::parse_hex_address(&note.recipient).map_err(|e| {
            (
                StatusCode::BAD_REQUEST,
                format!("invalid recipient in note {}: {}", i, e),
            )
        })?;

        let amount: u128 = note.amount.parse().map_err(|_| {
            (
                StatusCode::BAD_REQUEST,
                format!("invalid amount in note {}: {}", i, note.amount),
            )
        })?;

        if amount == 0 {
            return Err((
                StatusCode::BAD_REQUEST,
                format!("note {} amount must be non-zero", i),
            ));
        }

        total_amount = total_amount.checked_add(amount).ok_or_else(|| {
            (
                StatusCode::BAD_REQUEST,
                "total amount overflow".to_string(),
            )
        })?;

        if let Some(ref label) = note.label {
            if label.len() > 64 {
                return Err((
                    StatusCode::BAD_REQUEST,
                    format!("note {} label exceeds 64 characters", i),
                ));
            }
        }

        mine_notes.push(mining::MineNote {
            recipient,
            amount,
            label: note.label.clone(),
        });
    }

    let workspace = state.workspace.clone();
    let comment = body.comment.clone();

    // Run the PoW mining in a blocking thread (CPU-intensive)
    let result = tokio::task::spawn_blocking(move || {
        let req = mining::MineRequest {
            chain_id,
            notes: mine_notes,
        };

        let mine_result = mining::mine_deposit(&req)?;

        let filename = mining::write_deposit_file(
            &workspace,
            chain_id,
            &mine_result.secret,
            &mine_result.target_address,
            &req.notes,
            comment.as_deref(),
        )?;

        Ok::<_, anyhow::Error>((filename, mine_result))
    })
    .await
    .map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("mining task failed: {}", e),
        )
    })?
    .map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("mining failed: {}", e),
        )
    })?;

    let (filename, mine_result) = result;

    tracing::info!(
        filename = %filename,
        iterations = mine_result.iterations,
        target = %format!("0x{}", hex::encode(mine_result.target_address)),
        "deposit mined successfully"
    );

    // Broadcast workspace change via WebSocket
    let _ = state
        .event_tx
        .send(serde_json::json!({"type": "workspace:changed"}).to_string());

    Ok(Json(CreateDepositResponse {
        filename,
        target_address: format!("0x{}", hex::encode(mine_result.target_address)),
        total_amount: total_amount.to_string(),
        iterations: mine_result.iterations,
    }))
}

// ---------------------------------------------------------------------------
// GET /api/deposits/:id/notes/:noteIndex/claim-tx — prepare claim calldata
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ClaimTxResponse {
    /// Shadow proxy contract address.
    to: String,
    /// ABI-encoded calldata for `claim(bytes,PublicInput)`.
    data: String,
    /// Chain ID (hex).
    chain_id: String,
}

/// `GET /api/deposits/:id/notes/:noteIndex/claim-tx` — build claim tx calldata.
///
/// Returns the `to` address and `data` field for a MetaMask `eth_sendTransaction`.
async fn get_claim_tx(
    State(state): State<Arc<AppState>>,
    Path((id, note_index)): Path<(String, u32)>,
) -> Result<Json<ClaimTxResponse>, (StatusCode, String)> {
    let shadow_address = state
        .shadow_address
        .as_ref()
        .ok_or((
            StatusCode::BAD_REQUEST,
            "SHADOW_ADDRESS not configured".to_string(),
        ))?
        .clone();

    let index = scan_workspace(&state.workspace);
    let deposit = index
        .deposits
        .iter()
        .find(|d| d.id == id)
        .ok_or((StatusCode::NOT_FOUND, format!("deposit {} not found", id)))?;

    let proof_file = deposit.proof_file.as_ref().ok_or((
        StatusCode::BAD_REQUEST,
        "deposit has no proof file".to_string(),
    ))?;

    // Read and parse the proof file
    let proof_path = state.workspace.join(proof_file);
    let proof_raw = std::fs::read(&proof_path).map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("failed to read proof file: {}", e),
        )
    })?;

    let bundled: crate::prover::pipeline::BundledProof =
        serde_json::from_slice(&proof_raw).map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("failed to parse proof file: {}", e),
            )
        })?;

    let note_proof = bundled
        .notes
        .iter()
        .find(|n| n.note_index == note_index)
        .ok_or((
            StatusCode::NOT_FOUND,
            format!("note {} not found in proof file", note_index),
        ))?;

    if note_proof.proof.is_empty() {
        return Err((
            StatusCode::BAD_REQUEST,
            "proof was generated without the prove feature; no on-chain proof available"
                .to_string(),
        ));
    }

    // Build the claim calldata
    let proof_bytes = hex::decode(
        note_proof.proof.strip_prefix("0x").unwrap_or(&note_proof.proof),
    )
    .map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("invalid proof hex: {}", e),
        )
    })?;

    let block_number: u64 = bundled.block_number.parse().map_err(|_| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            "invalid block number".to_string(),
        )
    })?;
    let chain_id: u64 = bundled.chain_id.parse().map_err(|_| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            "invalid chain ID".to_string(),
        )
    })?;
    let amount: u128 = note_proof.amount.parse().map_err(|_| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            "invalid amount".to_string(),
        )
    })?;
    let recipient = hex::decode(
        note_proof
            .recipient
            .strip_prefix("0x")
            .unwrap_or(&note_proof.recipient),
    )
    .map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("invalid recipient: {}", e),
        )
    })?;
    let nullifier = hex::decode(
        note_proof
            .nullifier
            .strip_prefix("0x")
            .unwrap_or(&note_proof.nullifier),
    )
    .map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("invalid nullifier: {}", e),
        )
    })?;

    let calldata = encode_claim_calldata(
        &proof_bytes,
        block_number,
        chain_id,
        amount,
        &recipient,
        &nullifier,
    );

    Ok(Json(ClaimTxResponse {
        to: shadow_address,
        data: format!("0x{}", hex::encode(calldata)),
        chain_id: format!("0x{:x}", chain_id),
    }))
}

/// ABI-encode `claim(bytes _proof, (uint64,uint256,uint256,address,bytes32) _input)`.
fn encode_claim_calldata(
    proof_bytes: &[u8],
    block_number: u64,
    chain_id: u64,
    amount: u128,
    recipient: &[u8],
    nullifier: &[u8],
) -> Vec<u8> {
    // Function selector: claim(bytes,(uint64,uint256,uint256,address,bytes32))
    // keccak256("claim(bytes,(uint64,uint256,uint256,address,bytes32))")
    use tiny_keccak::{Hasher, Keccak};
    let mut keccak = Keccak::v256();
    keccak.update(b"claim(bytes,(uint64,uint256,uint256,address,bytes32))");
    let mut selector = [0u8; 32];
    keccak.finalize(&mut selector);

    let mut calldata = Vec::new();
    // Function selector (4 bytes)
    calldata.extend_from_slice(&selector[..4]);

    // Head section (2 slots): offset of _proof (dynamic) + start of _input (tuple)
    // _proof offset: points past head section. Head has 2 params, but _input is a static
    // tuple of 5 x 32-byte words = 160 bytes. So _proof offset = 32 + 160 = 192.
    // Wait, ABI encoding for (bytes, tuple): the bytes is dynamic, tuple is static.
    // Layout: [offset_proof (32)] [blockNumber (32)] [chainId (32)] [amount (32)] [recipient (32)] [nullifier (32)] [proof_len (32)] [proof_data (padded)]
    // But that's not standard ABI. Standard ABI for (bytes, (uint64,uint256,uint256,address,bytes32)):
    // Slot 0: offset to bytes data = 32 * 7 = 224? No...
    //
    // Actually for function(bytes, Tuple), where Tuple is a static tuple:
    // The function signature has 2 params. Param 1 (bytes) is dynamic → stored as offset.
    // Param 2 (tuple of static types) is static → inline 5 words.
    // Head: [offset_param1 (32)] [param2.field1 (32)] [param2.field2 (32)] ... [param2.field5 (32)]
    // = 6 x 32 = 192 bytes head
    // Tail: [length (32)] [data (padded)]
    //
    // So offset_param1 = 192 (6 * 32 = start of tail section)

    // Offset for _proof dynamic bytes: 6 * 32 = 192
    let mut offset_bytes = [0u8; 32];
    offset_bytes[28..32].copy_from_slice(&192u32.to_be_bytes());
    calldata.extend_from_slice(&offset_bytes);

    // _input.blockNumber (uint64, left-padded to 32 bytes)
    let mut bn = [0u8; 32];
    bn[24..32].copy_from_slice(&block_number.to_be_bytes());
    calldata.extend_from_slice(&bn);

    // _input.chainId (uint256)
    let mut cid = [0u8; 32];
    cid[24..32].copy_from_slice(&chain_id.to_be_bytes());
    calldata.extend_from_slice(&cid);

    // _input.amount (uint256)
    let mut amt = [0u8; 32];
    amt[16..32].copy_from_slice(&amount.to_be_bytes());
    calldata.extend_from_slice(&amt);

    // _input.recipient (address, left-padded to 32 bytes)
    let mut rcpt = [0u8; 32];
    if recipient.len() == 20 {
        rcpt[12..32].copy_from_slice(recipient);
    }
    calldata.extend_from_slice(&rcpt);

    // _input.nullifier (bytes32)
    let mut nul = [0u8; 32];
    if nullifier.len() == 32 {
        nul.copy_from_slice(nullifier);
    }
    calldata.extend_from_slice(&nul);

    // Proof bytes dynamic data
    let mut proof_len = [0u8; 32];
    proof_len[28..32].copy_from_slice(&(proof_bytes.len() as u32).to_be_bytes());
    calldata.extend_from_slice(&proof_len);

    calldata.extend_from_slice(proof_bytes);
    let proof_padded_len = (proof_bytes.len() + 31) / 32 * 32;
    let padding = proof_padded_len - proof_bytes.len();
    calldata.extend(std::iter::repeat(0u8).take(padding));

    calldata
}

pub fn router() -> Router<Arc<AppState>> {
    Router::new()
        .route("/deposits", get(list_deposits).post(create_deposit))
        .route("/deposits/{id}", get(get_deposit).delete(delete_deposit))
        .route("/deposits/{id}/proof", delete(delete_proof))
        .route(
            "/deposits/{id}/notes/{note_index}/claim-tx",
            get(get_claim_tx),
        )
}
