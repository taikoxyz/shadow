//! Proof generation job queue.
//!
//! Single-slot queue: only one proof job runs at a time. All notes in a deposit
//! are proved sequentially within one job.

use std::sync::Arc;

use serde::Serialize;
use tokio::sync::{broadcast, watch, Mutex};

/// Current state of a proof job.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum JobStatus {
    Queued,
    Running,
    Completed,
    Failed,
    Cancelled,
}

/// A proof generation job.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProofJob {
    pub deposit_id: String,
    pub status: JobStatus,
    pub current_note: u32,
    pub total_notes: u32,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

impl ProofJob {
    pub fn new(deposit_id: &str, total_notes: u32) -> Self {
        Self {
            deposit_id: deposit_id.to_string(),
            status: JobStatus::Queued,
            current_note: 0,
            total_notes,
            message: "Queued for proving".to_string(),
            error: None,
        }
    }
}

/// The proof queue manages a single proof job at a time.
pub struct ProofQueue {
    /// Current job state (None if idle).
    current: Mutex<Option<ProofJob>>,
    /// Watch channel to observe job state changes.
    job_tx: watch::Sender<Option<ProofJob>>,
    /// Broadcast channel for WebSocket events.
    event_tx: broadcast::Sender<String>,
    /// Cancel signal: send () to cancel the current job.
    cancel_tx: Mutex<Option<tokio::sync::oneshot::Sender<()>>>,
}

impl ProofQueue {
    pub fn new(event_tx: broadcast::Sender<String>) -> Arc<Self> {
        let (job_tx, _) = watch::channel(None);
        Arc::new(Self {
            current: Mutex::new(None),
            job_tx,
            event_tx,
            cancel_tx: Mutex::new(None),
        })
    }

    /// Get the current job status.
    pub async fn status(&self) -> Option<ProofJob> {
        self.current.lock().await.clone()
    }

    /// Try to enqueue a new proof job. Returns Err if a job is already running.
    pub async fn enqueue(&self, deposit_id: &str, total_notes: u32) -> Result<(), String> {
        let mut current = self.current.lock().await;
        if let Some(ref job) = *current {
            match job.status {
                JobStatus::Running | JobStatus::Queued => {
                    return Err(format!(
                        "a proof job is already {} for deposit {}",
                        if job.status == JobStatus::Running {
                            "running"
                        } else {
                            "queued"
                        },
                        job.deposit_id
                    ));
                }
                _ => {}
            }
        }

        let job = ProofJob::new(deposit_id, total_notes);
        *current = Some(job.clone());
        let _ = self.job_tx.send(Some(job));

        self.broadcast_event(serde_json::json!({
            "type": "proof:started",
            "depositId": deposit_id
        }));

        Ok(())
    }

    /// Update job progress (called by the pipeline during proving).
    pub async fn update_progress(&self, current_note: u32, message: &str) {
        let mut current = self.current.lock().await;
        if let Some(ref mut job) = *current {
            job.status = JobStatus::Running;
            job.current_note = current_note;
            job.message = message.to_string();
            let snapshot = job.clone();
            let _ = self.job_tx.send(Some(snapshot.clone()));

            self.broadcast_event(serde_json::json!({
                "type": "proof:note_progress",
                "depositId": snapshot.deposit_id,
                "noteIndex": current_note,
                "totalNotes": snapshot.total_notes,
                "message": message
            }));
        }
    }

    /// Mark the current job as completed.
    pub async fn complete(&self, proof_file: &str) {
        let mut current = self.current.lock().await;
        if let Some(ref mut job) = *current {
            let deposit_id = job.deposit_id.clone();
            job.status = JobStatus::Completed;
            job.message = format!("Proof generated: {}", proof_file);
            let snapshot = job.clone();
            let _ = self.job_tx.send(Some(snapshot));

            self.broadcast_event(serde_json::json!({
                "type": "proof:completed",
                "depositId": deposit_id,
                "proofFile": proof_file
            }));
        }
    }

    /// Mark the current job as failed.
    pub async fn fail(&self, note_index: u32, error: &str) {
        let mut current = self.current.lock().await;
        if let Some(ref mut job) = *current {
            let deposit_id = job.deposit_id.clone();
            job.status = JobStatus::Failed;
            job.error = Some(error.to_string());
            job.message = format!("Failed at note {}: {}", note_index, error);
            let snapshot = job.clone();
            let _ = self.job_tx.send(Some(snapshot));

            self.broadcast_event(serde_json::json!({
                "type": "proof:failed",
                "depositId": deposit_id,
                "noteIndex": note_index,
                "error": error
            }));
        }
    }

    /// Cancel the current job (best-effort).
    pub async fn cancel(&self) -> bool {
        let mut cancel_tx = self.cancel_tx.lock().await;
        if let Some(tx) = cancel_tx.take() {
            let _ = tx.send(());
            let mut current = self.current.lock().await;
            if let Some(ref mut job) = *current {
                job.status = JobStatus::Cancelled;
                job.message = "Cancelled by user".to_string();
                let snapshot = job.clone();
                let _ = self.job_tx.send(Some(snapshot));
            }
            true
        } else {
            false
        }
    }

    /// Clear the current job unconditionally (used to dismiss failed/completed jobs).
    pub async fn clear(&self) {
        let mut current = self.current.lock().await;
        *current = None;
        let _ = self.job_tx.send(None);
    }

    /// Set the cancel sender for the current job (called by pipeline before starting).
    pub async fn set_cancel_tx(&self, tx: tokio::sync::oneshot::Sender<()>) {
        let mut cancel = self.cancel_tx.lock().await;
        *cancel = Some(tx);
    }

    fn broadcast_event(&self, event: serde_json::Value) {
        let _ = self.event_tx.send(event.to_string());
    }
}
