use std::sync::Arc;

use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    routing::{delete, get, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};

use crate::{
    prover::{pipeline, queue::ProofJob},
    state::AppState,
    workspace::scanner::scan_workspace,
};

#[derive(Debug, Deserialize)]
struct ProveQuery {
    #[serde(default)]
    force: bool,
}

/// `POST /api/deposits/:id/prove` — queue proof generation for a deposit.
async fn start_proof(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    Query(query): Query<ProveQuery>,
) -> Result<Json<ProofJob>, (StatusCode, String)> {
    let rpc_url = state
        .rpc_url
        .as_ref()
        .ok_or((
            StatusCode::BAD_REQUEST,
            "RPC URL not configured; start server with --rpc-url".to_string(),
        ))?
        .clone();

    // Find the deposit
    let index = scan_workspace(&state.workspace);
    let deposit = index
        .deposits
        .iter()
        .find(|d| d.id == id)
        .ok_or((StatusCode::NOT_FOUND, format!("deposit {} not found", id)))?;

    // If force=true, rename the existing proof file to .bkup immediately
    // so the deposit appears as "unproved" during regeneration.
    if query.force {
        if let Some(ref proof_name) = deposit.proof_file {
            let proof_path = state.workspace.join(proof_name);
            if proof_path.is_file() {
                let bkup_path = proof_path.with_extension("bkup");
                if let Err(e) = std::fs::rename(&proof_path, &bkup_path) {
                    tracing::warn!(error = %e, file = %proof_name, "failed to rename proof to .bkup");
                } else {
                    tracing::info!(file = %proof_name, "renamed proof to .bkup for regeneration");
                }
            }
        }
    }

    let note_count = deposit.note_count as u32;
    let deposit_filename = deposit.filename.clone();
    let deposit_id = deposit.id.clone();
    // Capture existing proof filename before spawn (will be renamed to .bkup on success)
    let existing_proof = deposit.proof_file.clone();

    // Enqueue
    state
        .proof_queue
        .enqueue(&deposit_id, note_count)
        .await
        .map_err(|e| (StatusCode::CONFLICT, e))?;

    // Spawn the proof pipeline
    let queue = state.proof_queue.clone();
    let workspace = state.workspace.clone();
    let (cancel_tx, cancel_rx) = tokio::sync::oneshot::channel();
    queue.set_cancel_tx(cancel_tx).await;

    let event_tx = state.event_tx.clone();

    tokio::spawn(async move {
        let prove_start = std::time::Instant::now();
        match pipeline::run_pipeline(&workspace, &deposit_filename, &rpc_url, queue.clone(), cancel_rx)
            .await
        {
            Ok(bundled) => {
                // Rename any existing proof file to .bkup before writing the new one
                if let Some(ref old_proof) = existing_proof {
                    let old_path = workspace.join(old_proof);
                    if old_path.is_file() {
                        let bkup_path = old_path.with_extension("bkup");
                        if let Err(e) = std::fs::rename(&old_path, &bkup_path) {
                            tracing::warn!(error = %e, file = %old_proof, "failed to rename old proof to .bkup");
                        } else {
                            tracing::info!(file = %old_proof, "renamed old proof to .bkup");
                        }
                    }
                }

                // Write proof file
                let deposit_stem = deposit_filename
                    .strip_suffix(".json")
                    .unwrap_or(&deposit_filename);
                let proof_ts = timestamp_now();
                let proof_filename = format!("{}.proof-{}.json", deposit_stem, proof_ts);
                let proof_path = workspace.join(&proof_filename);

                match serde_json::to_vec_pretty(&bundled) {
                    Ok(json_bytes) => {
                        if let Err(e) = std::fs::write(&proof_path, json_bytes) {
                            tracing::error!(error = %e, "failed to write proof file");
                            queue.fail(0, &format!("failed to write proof file: {:#}", e)).await;
                            return;
                        }
                        tracing::info!(file = %proof_filename, "proof file written");
                        queue.complete(&proof_filename, Some(prove_start.elapsed().as_secs_f64())).await;

                        let _ = event_tx.send(
                            serde_json::json!({"type": "workspace:changed"}).to_string(),
                        );
                    }
                    Err(e) => {
                        tracing::error!(error = %e, "failed to serialize proof");
                        queue.fail(0, &format!("serialization error: {:#}", e)).await;
                    }
                }
            }
            Err(e) => {
                // Use {:#} to include the full anyhow cause chain (e.g. RISC Zero panic message)
                let detail = format!("{:#}", e);
                tracing::error!(error = %detail, deposit = %deposit_id, "proof pipeline failed");
                queue.fail(0, &detail).await;
            }
        }
    });

    let job = state.proof_queue.status().await.unwrap();
    Ok(Json(job))
}

/// `GET /api/queue` — get queue status.
async fn queue_status(
    State(state): State<Arc<AppState>>,
) -> Json<Option<ProofJob>> {
    Json(state.proof_queue.status().await)
}

/// `DELETE /api/queue/current` — cancel or clear the current proof job.
async fn cancel_job(
    State(state): State<Arc<AppState>>,
) -> Json<CancelResponse> {
    if state.proof_queue.cancel().await {
        Json(CancelResponse {
            cancelled: true,
            message: "cancellation signal sent".to_string(),
        })
    } else {
        // Job is failed/completed — clear it so it stops being returned by /api/queue
        state.proof_queue.clear().await;
        Json(CancelResponse {
            cancelled: true,
            message: "job cleared".to_string(),
        })
    }
}

#[derive(Serialize)]
struct CancelResponse {
    cancelled: bool,
    message: String,
}

pub fn router() -> Router<Arc<AppState>> {
    Router::new()
        .route("/deposits/{id}/prove", post(start_proof))
        .route("/queue", get(queue_status))
        .route("/queue/current", delete(cancel_job))
}

fn timestamp_now() -> String {
    use std::time::SystemTime;
    let secs = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();

    // Manual UTC formatting: YYYYMMDDTHHMMSS
    let days = secs / 86400;
    let tod = secs % 86400;
    let (y, m, d) = civil_from_days(days as i64);
    format!(
        "{:04}{:02}{:02}T{:02}{:02}{:02}",
        y,
        m,
        d,
        tod / 3600,
        (tod % 3600) / 60,
        tod % 60
    )
}

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
