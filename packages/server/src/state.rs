use std::{path::PathBuf, sync::Arc};

use tokio::sync::broadcast;

use crate::{chain::ChainClient, prover::ProofQueue};

/// Shared application state.
pub struct AppState {
    /// Absolute path to the workspace directory.
    pub workspace: PathBuf,
    /// Ethereum JSON-RPC URL (optional).
    pub rpc_url: Option<String>,
    /// Chain ID fetched from RPC at startup (optional).
    pub chain_id: Option<u64>,
    /// Directory containing built UI static files.
    pub ui_dir: PathBuf,
    /// Broadcast channel for server-sent events (WebSocket).
    pub event_tx: broadcast::Sender<String>,
    /// Proof generation queue.
    pub proof_queue: Arc<ProofQueue>,
    /// On-chain query client (requires RPC URL).
    pub chain_client: Option<ChainClient>,
    /// Shadow contract address (optional, for on-chain queries).
    pub shadow_address: Option<String>,
}
