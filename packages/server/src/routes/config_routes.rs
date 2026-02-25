use std::sync::Arc;

use axum::{
    extract::{Path, State},
    http::StatusCode,
    routing::{get, post},
    Json, Router,
};
use serde::Serialize;

use crate::{
    state::AppState,
    workspace::scanner::scan_workspace,
};

/// `GET /api/config` — returns server configuration and chain info.
async fn get_config(State(state): State<Arc<AppState>>) -> Json<ConfigResponse> {
    let mut config = ConfigResponse {
        version: env!("CARGO_PKG_VERSION").to_string(),
        workspace: state.workspace.display().to_string(),
        rpc_url: state.rpc_url.clone(),
        circuit_id: None,
        shadow_address: state.shadow_address.clone(),
        verifier_address: state.verifier_address.clone(),
    };

    // Try to read circuit ID from on-chain verifier
    if let (Some(ref chain_client), Some(ref verifier)) =
        (&state.chain_client, &state.verifier_address)
    {
        match chain_client.read_circuit_id(verifier).await {
            Ok(cid) => config.circuit_id = Some(cid),
            Err(e) => tracing::warn!(error = %e, "failed to read circuit ID from verifier"),
        }
    }

    Json(config)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ConfigResponse {
    version: String,
    workspace: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    rpc_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    circuit_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    shadow_address: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    verifier_address: Option<String>,
}

/// `GET /api/deposits/:id/notes/:noteIndex/status` — get cached claim status for a note.
async fn note_status(
    State(state): State<Arc<AppState>>,
    Path((id, note_index)): Path<(String, u32)>,
) -> Result<Json<NoteStatusResponse>, StatusCode> {
    let index = scan_workspace(&state.workspace);
    let deposit = index
        .deposits
        .iter()
        .find(|d| d.id == id)
        .ok_or(StatusCode::NOT_FOUND)?;

    let note = deposit
        .notes
        .iter()
        .find(|n| n.index == note_index)
        .ok_or(StatusCode::NOT_FOUND)?;

    let claim_status = check_claim_status(&state, &note.nullifier).await;

    Ok(Json(NoteStatusResponse {
        deposit_id: id,
        note_index,
        nullifier: note.nullifier.clone(),
        claim_status,
    }))
}

/// `POST /api/deposits/:id/notes/:noteIndex/refresh` — force refresh nullifier status.
async fn refresh_note_status(
    State(state): State<Arc<AppState>>,
    Path((id, note_index)): Path<(String, u32)>,
) -> Result<Json<NoteStatusResponse>, StatusCode> {
    let index = scan_workspace(&state.workspace);
    let deposit = index
        .deposits
        .iter()
        .find(|d| d.id == id)
        .ok_or(StatusCode::NOT_FOUND)?;

    let note = deposit
        .notes
        .iter()
        .find(|n| n.index == note_index)
        .ok_or(StatusCode::NOT_FOUND)?;

    let claim_status = refresh_claim_status(&state, &note.nullifier).await;

    Ok(Json(NoteStatusResponse {
        deposit_id: id,
        note_index,
        nullifier: note.nullifier.clone(),
        claim_status,
    }))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct NoteStatusResponse {
    deposit_id: String,
    note_index: u32,
    nullifier: String,
    claim_status: String,
}

async fn check_claim_status(state: &AppState, nullifier: &str) -> String {
    let (chain_client, shadow_address) =
        match (&state.chain_client, &state.shadow_address) {
            (Some(c), Some(a)) => (c, a),
            _ => return "unknown".to_string(),
        };

    match chain_client.is_consumed(shadow_address, nullifier).await {
        Ok(true) => "claimed".to_string(),
        Ok(false) => "unclaimed".to_string(),
        Err(e) => {
            tracing::warn!(error = %e, nullifier = %nullifier, "failed to check claim status");
            "unknown".to_string()
        }
    }
}

async fn refresh_claim_status(state: &AppState, nullifier: &str) -> String {
    let (chain_client, shadow_address) =
        match (&state.chain_client, &state.shadow_address) {
            (Some(c), Some(a)) => (c, a),
            _ => return "unknown".to_string(),
        };

    match chain_client
        .refresh_nullifier_status(shadow_address, nullifier)
        .await
    {
        Ok(true) => "claimed".to_string(),
        Ok(false) => "unclaimed".to_string(),
        Err(e) => {
            tracing::warn!(error = %e, nullifier = %nullifier, "failed to refresh claim status");
            "unknown".to_string()
        }
    }
}

pub fn router() -> Router<Arc<AppState>> {
    Router::new()
        .route("/config", get(get_config))
        .route(
            "/deposits/{id}/notes/{noteIndex}/status",
            get(note_status),
        )
        .route(
            "/deposits/{id}/notes/{noteIndex}/refresh",
            post(refresh_note_status),
        )
}
