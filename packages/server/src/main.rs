use std::{net::SocketAddr, path::PathBuf, sync::Arc};

use anyhow::{Context, Result};
use axum::Router;
use clap::Parser;
use tokio::sync::broadcast;
use tower_http::cors::CorsLayer;

mod chain;
mod mining;
mod prover;
mod routes;
mod state;
mod workspace;

use chain::ChainClient;
use prover::ProofQueue;
use state::AppState;

#[derive(Debug, Parser)]
#[command(name = "shadow-server")]
#[command(about = "Shadow Protocol local backend server")]
struct Cli {
    /// Workspace directory (where deposit and proof files live).
    #[arg(long, default_value = ".")]
    workspace: PathBuf,

    /// Port to listen on.
    #[arg(long, default_value = "3000")]
    port: u16,

    /// Ethereum JSON-RPC URL for on-chain queries and proof generation.
    #[arg(long, env = "RPC_URL")]
    rpc_url: Option<String>,

    /// Shadow contract address for on-chain nullifier queries.
    #[arg(long, env = "SHADOW_ADDRESS")]
    shadow_address: Option<String>,

    /// Risc0CircuitVerifier contract address for reading the circuit ID.
    #[arg(long, env = "VERIFIER_ADDRESS")]
    verifier_address: Option<String>,

    /// Directory containing the built UI static files.
    #[arg(long, default_value = "/app/ui")]
    ui_dir: PathBuf,
}

#[tokio::main]
async fn main() -> Result<()> {
    // Initialize tracing
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "shadow_server=info,tower_http=info".into()),
        )
        .init();

    let cli = Cli::parse();

    // Resolve workspace to absolute path
    let workspace = cli
        .workspace
        .canonicalize()
        .with_context(|| format!("workspace not found: {}", cli.workspace.display()))?;

    tracing::info!(workspace = %workspace.display(), "starting shadow-server");
    tracing::info!(port = cli.port, "listening on port");
    if let Some(ref rpc) = cli.rpc_url {
        tracing::info!(rpc_url = %rpc, "RPC endpoint configured");
    }

    // Broadcast channel for WebSocket events (proof progress, workspace changes)
    let (event_tx, _) = broadcast::channel::<String>(64);

    // Proof generation queue
    let proof_queue = ProofQueue::new(event_tx.clone());

    // On-chain client (optional, requires RPC URL)
    let chain_client = cli
        .rpc_url
        .as_ref()
        .map(|url| ChainClient::new(url.clone()));

    let state = Arc::new(AppState {
        workspace,
        rpc_url: cli.rpc_url,
        ui_dir: cli.ui_dir,
        event_tx,
        proof_queue,
        chain_client,
        shadow_address: cli.shadow_address,
        verifier_address: cli.verifier_address,
    });

    let app = build_router(state);

    let addr = SocketAddr::from(([0, 0, 0, 0], cli.port));
    tracing::info!(%addr, "server listening");

    let listener = tokio::net::TcpListener::bind(addr)
        .await
        .with_context(|| format!("failed to bind to {}", addr))?;

    axum::serve(listener, app)
        .await
        .context("server error")?;

    Ok(())
}

fn build_router(state: Arc<AppState>) -> Router {
    let api = routes::api_router(state.clone());

    let mut app = Router::new()
        .nest("/api", api)
        .merge(routes::ws::router().with_state(state.clone()));

    // Serve static UI files if directory exists
    if state.ui_dir.is_dir() {
        let serve_dir = tower_http::services::ServeDir::new(&state.ui_dir)
            .fallback(tower_http::services::ServeFile::new(
                state.ui_dir.join("index.html"),
            ));
        app = app.fallback_service(serve_dir);
    }

    // CORS for local development
    let cors = CorsLayer::very_permissive();

    app.layer(cors)
}
