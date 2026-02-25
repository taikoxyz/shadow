mod deposits;
mod health;

use std::sync::Arc;

use axum::Router;

use crate::state::AppState;

/// Build the `/api` sub-router with all API routes.
pub fn api_router(state: Arc<AppState>) -> Router {
    Router::new()
        .merge(health::router())
        .merge(deposits::router())
        .with_state(state)
}
