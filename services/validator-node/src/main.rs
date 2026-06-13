//! STEP validator node (alpha topology, ADR-005).
//!
//! Receives claims over HTTP from the gateway, runs the deterministic
//! validation pipeline (`step-validation-rules`), and returns an EIP-712
//! signed vote. Quorum aggregation and on-chain submission happen in the
//! gateway/relayer (DEV §9.3: "submit accepted claim to chain or relayer").
//! The libp2p gossip transport is the documented MVP upgrade path; message
//! shapes here are transport-independent.
//!
//! Privacy: this process logs claim hashes and verdicts — never coordinates
//! (DEV §23.1 "No raw GPS in logs").

mod metrics;
mod nonce;
mod server;
mod state;

use k256::ecdsa::SigningKey;
use state::{AppState, NodeConfig};
use std::sync::Arc;

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()),
        )
        .json()
        .init();

    let config = NodeConfig::from_env().unwrap_or_else(|e| {
        eprintln!("configuration error: {e}");
        std::process::exit(2);
    });
    let port = config.port;
    let key_bytes = hex::decode(config.validator_private_key.trim_start_matches("0x"))
        .expect("VALIDATOR_PRIVATE_KEY must be hex");
    let signing_key =
        SigningKey::from_slice(&key_bytes).expect("VALIDATOR_PRIVATE_KEY must be 32 bytes");

    let state = Arc::new(AppState::new(config, signing_key));
    tracing::info!(
        validator = %step_validation_rules::sign::format_address(&state.validator_address),
        mesh = step_mesh_engine::MESH_SPEC_VERSION,
        "validator node starting"
    );

    let app = server::router(state);
    let listener = tokio::net::TcpListener::bind(("0.0.0.0", port))
        .await
        .expect("bind validator port");
    axum::serve(listener, app)
        .with_graceful_shutdown(async {
            let _ = tokio::signal::ctrl_c().await;
        })
        .await
        .expect("server error");
}
