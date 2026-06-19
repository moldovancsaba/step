//! Agent configuration from the environment (set by the system-service unit, #44).

use std::path::PathBuf;
use std::time::Duration;

#[derive(Clone, Debug)]
pub struct AgentConfig {
    /// Agent root holding releases/, current, state.json.
    pub root: PathBuf,
    /// Chain JSON-RPC endpoint (reachable over the tailnet).
    pub rpc_url: String,
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
    /// Hub artifact base URL (artifacts fetched here, verified vs chain).
    pub artifact_base_url: Option<String>,
    /// How often to poll the chain for the target version.
    pub poll_interval: Duration,
    /// How often to re-measure integrity.
    pub integrity_interval: Duration,
    /// Health-gate poll attempts after an update restart.
    pub watch_attempts: u32,
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
            rpc_url: req("STEP_RPC_URL")?,
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
            artifact_base_url: std::env::var("ARTIFACT_BASE_URL").ok(),
            poll_interval: secs("AGENT_POLL_INTERVAL", 60),
            integrity_interval: secs("AGENT_INTEGRITY_INTERVAL", 600),
            watch_attempts: std::env::var("AGENT_WATCH_ATTEMPTS")
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(20),
        })
    }
}
