use std::path::PathBuf;

use tokio::sync::broadcast;

/// Shared application state.
pub struct AppState {
    /// Absolute path to the workspace directory.
    pub workspace: PathBuf,
    /// Ethereum JSON-RPC URL (optional).
    pub rpc_url: Option<String>,
    /// Directory containing built UI static files.
    pub ui_dir: PathBuf,
    /// Broadcast channel for server-sent events (WebSocket).
    pub event_tx: broadcast::Sender<String>,
}
