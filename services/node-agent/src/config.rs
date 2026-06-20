//! Agent configuration from the environment (set by the system-service unit, #44).

use std::path::PathBuf;
use std::time::Duration;

#[derive(Clone, Debug)]
pub struct AgentConfig {
    /// Agent root holding releases/, current, state.json.
    pub root: PathBuf,
    /// Chain JSON-RPC endpoints in failover order (so no single host/chain node is
    /// a SPOF, #50). STEP_RPC_URLS (comma) or the legacy single STEP_RPC_URL.
    pub rpc_urls: Vec<String>,
    /// ReleaseRegistry contract address (0x…).
    pub release_registry: String,
    /// This node's validator address (0x…) — its on-chain identity.
    pub node_address: String,
    /// keccak256(platform-string) as 0x32-bytes (e.g. of "darwin-arm64"),
    /// precomputed by the release pipeline / installer.
    pub platform_id: String,
    /// Human platform label for status/logs.
    pub platform: String,
    /// Agent status server port.
    pub agent_port: u16,
    /// Port the supervised validator listens on (VALIDATOR_PORT, default 9101).
    pub validator_port: u16,
    /// Hub artifact base URLs, in failover order (artifacts fetched here, each
    /// independently verified vs the on-chain hash). ARTIFACT_BASE_URLS (comma) or
    /// the legacy single ARTIFACT_BASE_URL.
    pub artifact_base_urls: Vec<String>,
    /// How often to poll the chain for the target version.
    pub poll_interval: Duration,
    /// How often to re-measure integrity.
    pub integrity_interval: Duration,
    /// Health-gate poll attempts after an update restart.
    pub watch_attempts: u32,
    /// Hub fleet-api base URL for signed heartbeats (#56). `None` disables
    /// heartbeats (the node still runs; the hub just can't see live signal).
    pub fleet_url: Option<String>,
    /// How often to emit a signed heartbeat to the hub.
    pub heartbeat_interval: Duration,
}

fn req(key: &str) -> Result<String, String> {
    std::env::var(key).map_err(|_| format!("missing env {key}"))
}
fn secs(key: &str, default: u64) -> Duration {
    Duration::from_secs(
        std::env::var(key)
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(default),
    )
}

impl AgentConfig {
    pub fn from_env() -> Result<Self, String> {
        Ok(Self {
            root: PathBuf::from(req("AGENT_ROOT")?),
            rpc_urls: {
                let raw = std::env::var("STEP_RPC_URLS")
                    .or_else(|_| std::env::var("STEP_RPC_URL"))
                    .map_err(|_| "missing env STEP_RPC_URLS (or STEP_RPC_URL)")?;
                let urls: Vec<String> = raw
                    .split(',')
                    .map(|s| s.trim().to_string())
                    .filter(|s| !s.is_empty())
                    .collect();
                if urls.is_empty() {
                    return Err("STEP_RPC_URLS is empty".into());
                }
                urls
            },
            release_registry: req("RELEASE_REGISTRY")?,
            node_address: req("NODE_ADDRESS")?,
            platform_id: req("PLATFORM_ID")?,
            platform: std::env::var("PLATFORM").unwrap_or_else(|_| "unspecified".into()),
            agent_port: std::env::var("AGENT_PORT")
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(9200),
            validator_port: std::env::var("VALIDATOR_PORT")
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(9101),
            artifact_base_urls: std::env::var("ARTIFACT_BASE_URLS")
                .or_else(|_| std::env::var("ARTIFACT_BASE_URL"))
                .unwrap_or_default()
                .split(',')
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
                .collect(),
            poll_interval: secs("AGENT_POLL_INTERVAL", 60),
            integrity_interval: secs("AGENT_INTEGRITY_INTERVAL", 600),
            watch_attempts: std::env::var("AGENT_WATCH_ATTEMPTS")
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(20),
            fleet_url: std::env::var("FLEET_URL")
                .ok()
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty()),
            heartbeat_interval: secs("AGENT_HEARTBEAT_INTERVAL", 30),
        })
    }
}
