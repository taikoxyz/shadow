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

    // Fetch chain ID from RPC at startup
    let chain_id = if let Some(ref rpc_url) = cli.rpc_url {
        let http = reqwest::Client::new();
        match prover::rpc::eth_chain_id(&http, rpc_url).await {
            Ok(id) => {
                tracing::info!(chain_id = id, "chain ID from RPC");
                Some(id)
            }
            Err(e) => {
                tracing::warn!(error = %e, "failed to fetch chain ID from RPC");
                None
            }
        }
    } else {
        None
    };

    let state = Arc::new(AppState {
        workspace,
        rpc_url: cli.rpc_url,
        chain_id,
        ui_dir: cli.ui_dir,
        event_tx,
        proof_queue,
        chain_client,
        shadow_address: cli.shadow_address,
    });

    // ---------------------------------------------------------------------------
    // Circuit ID verification
    // Compare the local compiled-in imageId against the on-chain verifier.
    // Only available when the `prove` feature is enabled.
    // ---------------------------------------------------------------------------
    #[cfg(feature = "prove")]
    {
        if let (Some(ref chain), Some(ref shadow_addr)) =
            (&state.chain_client, &state.shadow_address)
        {
            tracing::info!("resolving circuit verifier from Shadow contract...");
            match chain.read_circuit_verifier_address(shadow_addr).await {
                Ok(verifier_addr) => {
                    tracing::info!(verifier = %verifier_addr, "resolved Risc0CircuitVerifier");
                    match chain.read_circuit_id(&verifier_addr).await {
                        Ok(onchain_raw) => {
                            let onchain_id = onchain_raw.to_lowercase();
                            let local_id = shadow_prover_lib::circuit_id_hex().to_lowercase();
                            if onchain_id != local_id {
                                tracing::warn!(
                                    onchain = %onchain_id,
                                    local   = %local_id,
                                    "circuit ID mismatch — proofs from this binary will NOT pass \
                                     the deployed on-chain verifier. You can still prove locally, \
                                     but must redeploy/upgrade the verifier before submitting."
                                );
                            } else {
                                tracing::info!(circuit_id = %local_id, "circuit ID matches on-chain verifier ✓");
                            }
                        }
                        Err(e) => {
                            tracing::warn!("could not read circuit ID from verifier: {:#}", e)
                        }
                    }
                }
                Err(e) => tracing::warn!("could not resolve circuit verifier from Shadow: {:#}", e),
            }
        } else if state.shadow_address.is_none() {
            tracing::warn!("SHADOW_ADDRESS not configured — circuit ID check skipped.");
        }
    }

    let app = build_router(state);

    let addr = SocketAddr::from(([0, 0, 0, 0], cli.port));
    tracing::info!(%addr, "server listening");

    let listener = tokio::net::TcpListener::bind(addr)
        .await
        .with_context(|| format!("failed to bind to {}", addr))?;

    axum::serve(listener, app).await.context("server error")?;

    Ok(())
}

fn build_router(state: Arc<AppState>) -> Router {
    let api = routes::api_router(state.clone());

    let mut app = Router::new()
        .nest("/api", api)
        .merge(routes::ws::router().with_state(state.clone()));

    // Serve static UI files if directory exists
    if state.ui_dir.is_dir() {
        let serve_dir = tower_http::services::ServeDir::new(&state.ui_dir).fallback(
            tower_http::services::ServeFile::new(state.ui_dir.join("index.html")),
        );
        app = app.fallback_service(serve_dir);
    }

    // CORS for local development
    let cors = CorsLayer::very_permissive();

    app.layer(cors)
}
