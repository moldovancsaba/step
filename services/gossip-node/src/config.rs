//! Gossip-node configuration from the environment.

use step_validation_rules::sign::{parse_address, Address};

#[derive(Clone, Debug)]
pub struct GossipConfig {
    /// secp256k1 validator key (0x…32 bytes) — the gossip peer identity AND the
    /// vote-signing key, so peer identity is cryptographically the validator.
    pub validator_key: [u8; 32],
    /// EIP-712 chain id (must match the verifier contract's domain).
    pub chain_id: u64,
    /// MiningClaimVerifier address (the EIP-712 verifying contract).
    pub verifying_contract: Address,
    /// Weighted-quorum threshold (sum of approving validators' active weight).
    pub quorum_threshold: u128,
    /// Local validator HTTP base (the node POSTs claims here to validate+sign).
    pub validator_url: String,
    /// libp2p listen multiaddr (e.g. /ip4/0.0.0.0/tcp/0).
    pub listen: String,
    /// Explicit bootstrap peers (cross-location). mDNS covers the LAN; these are
    /// self-hosted addresses — no third-party signaling server.
    pub bootstrap: Vec<String>,
    /// Relays this node RESERVES a circuit on (multiaddrs ending in /p2p/<PeerId>).
    /// Reserving makes a NAT'd node dialable from anywhere as
    /// `<relay>/p2p-circuit/p2p/<self>` — then dcutr upgrades to a direct link.
    /// Without this, relay_client + dcutr are inert and home nodes stay
    /// unreachable. Designated public relays (GOSSIP_RELAY_SERVER=1) serve these.
    pub relays: Vec<String>,
    /// Bounded seen-set capacity for replay protection.
    pub seen_capacity: usize,
    /// #67: run the circuit-relay SERVER (relay for NAT'd peers). Default OFF —
    /// only designated public relays enable it; every node is still a relay-client
    /// + dcutr. When on, the limits below bound abuse.
    pub relay_server: bool,
    pub relay_max_reservations: usize,
    pub relay_max_circuits: usize,
}

fn req(k: &str) -> Result<String, String> {
    std::env::var(k).map_err(|_| format!("missing env {k}"))
}

impl GossipConfig {
    pub fn from_env() -> Result<Self, String> {
        let key_hex = req("VALIDATOR_PRIVATE_KEY")?;
        let key_bytes = hex::decode(key_hex.strip_prefix("0x").unwrap_or(&key_hex))
            .map_err(|_| "VALIDATOR_PRIVATE_KEY not hex")?;
        let validator_key: [u8; 32] = key_bytes
            .try_into()
            .map_err(|_| "VALIDATOR_PRIVATE_KEY must be 32 bytes")?;
        let contract = req("VERIFIER_CONTRACT_ADDRESS")?;
        Ok(Self {
            validator_key,
            chain_id: req("STEP_CHAIN_ID")?
                .parse()
                .map_err(|_| "bad STEP_CHAIN_ID")?,
            verifying_contract: parse_address(&contract).ok_or("bad VERIFIER_CONTRACT_ADDRESS")?,
            quorum_threshold: req("STEP_QUORUM_THRESHOLD")?
                .parse()
                .map_err(|_| "bad STEP_QUORUM_THRESHOLD")?,
            validator_url: std::env::var("VALIDATOR_URL")
                .unwrap_or_else(|_| "http://127.0.0.1:9100".into()),
            listen: std::env::var("GOSSIP_LISTEN").unwrap_or_else(|_| "/ip4/0.0.0.0/tcp/0".into()),
            bootstrap: std::env::var("GOSSIP_BOOTSTRAP")
                .unwrap_or_default()
                .split(',')
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
                .collect(),
            relays: std::env::var("GOSSIP_RELAYS")
                .unwrap_or_default()
                .split(',')
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
                .collect(),
            seen_capacity: std::env::var("GOSSIP_SEEN_CAPACITY")
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(8192),
            relay_server: std::env::var("GOSSIP_RELAY_SERVER").as_deref() == Ok("1"),
            relay_max_reservations: std::env::var("GOSSIP_RELAY_MAX_RESERVATIONS")
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(128),
            relay_max_circuits: std::env::var("GOSSIP_RELAY_MAX_CIRCUITS")
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(16),
        })
    }
}
