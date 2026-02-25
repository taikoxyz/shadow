use std::sync::Arc;

use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    routing::{delete, get},
    Json, Router,
};
use serde::{Deserialize, Serialize};

use crate::{
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

pub fn router() -> Router<Arc<AppState>> {
    Router::new()
        .route("/deposits", get(list_deposits))
        .route("/deposits/{id}", get(get_deposit).delete(delete_deposit))
        .route("/deposits/{id}/proof", delete(delete_proof))
}
