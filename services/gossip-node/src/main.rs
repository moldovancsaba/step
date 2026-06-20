//! `step-gossip-node` (#54): runs the validator gossip mesh. Identity is the
//! validator key; on a claim it asks the co-located validator to validate+sign,
//! gossips the vote, aggregates peers' votes, and — at weighted quorum — submits
//! the bundle. No central gateway in the claim→finalise path.

use std::sync::Arc;

use step_gossip::agreement::{agree, Agreement};
use step_gossip::config::GossipConfig;
use step_gossip::swarm;
use step_validation_rules::sign::{keccak256, Address};

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()),
        )
        .json()
        .init();

    let cfg = GossipConfig::from_env().unwrap_or_else(|e| {
        eprintln!("configuration error: {e}");
        std::process::exit(2);
    });

    // On-chain reads cross-check several independent endpoints (#50): no single
    // chain node is trusted for a weight that affects quorum. STEP_RPC_URLS is a
    // comma-list; the legacy single STEP_RPC_URL still works.
    let rpc_urls: Vec<String> = std::env::var("STEP_RPC_URLS")
        .or_else(|_| std::env::var("STEP_RPC_URL"))
        .unwrap_or_else(|_| "http://127.0.0.1:8545".into())
        .split(',')
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect();
    // Default agreement threshold: a majority of the configured endpoints.
    let min_agree = std::env::var("STEP_RPC_MIN_AGREE")
        .ok()
        .and_then(|v| v.parse::<usize>().ok())
        .unwrap_or_else(|| rpc_urls.len() / 2 + 1);
    let registry = std::env::var("VALIDATOR_REGISTRY").unwrap_or_else(|_| {
        resolve_registry().unwrap_or_else(|| {
            eprintln!("set VALIDATOR_REGISTRY or STEP_DEPLOYMENTS_FILE");
            std::process::exit(2);
        })
    });
    let submit_url = std::env::var("STEP_SUBMIT_URL").ok();
    let client = Arc::new(
        reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(10))
            .build()
            .expect("http client"),
    );

    // weight_of: ValidatorRegistry.activeWeight(addr), cross-checked across all
    // configured endpoints (#50). An un-agreed weight resolves to 0 — conservatively
    // excluding that vote from quorum rather than trusting a lone endpoint.
    let weight_client = client.clone();
    let weight_rpcs = Arc::new(rpc_urls.clone());
    let weight_registry = registry.clone();
    let weight_of = move |addr: Address| {
        let client = weight_client.clone();
        let rpcs = weight_rpcs.clone();
        let registry = weight_registry.clone();
        async move { active_weight_agreed(&client, &rpcs, &registry, &addr, min_agree).await }
    };

    // submit: hand the finalised bundle to the chain. If STEP_SUBMIT_URL is set,
    // POST it there (a thin chain-submission shim); otherwise log it (a node that
    // only gossips). The quorum DECISION is fully peer-to-peer either way.
    let submit_client = client.clone();
    let submit = move |bundle: step_gossip::aggregate::Bundle| {
        let client = submit_client.clone();
        let url = submit_url.clone();
        async move {
            match url {
                Some(u) => {
                    let body = serde_json::json!({
                        "claim_hash": bundle.claim_hash,
                        "total_weight": bundle.total_weight.to_string(),
                        "approvals": bundle.approvals,
                    });
                    match client.post(&u).json(&body).send().await {
                        Ok(r) if r.status().is_success() => {
                            tracing::info!(claim = %bundle.claim_hash, "bundle submitted")
                        }
                        Ok(r) => tracing::warn!(status = %r.status(), "submit rejected"),
                        Err(e) => tracing::warn!("submit failed: {e}"),
                    }
                }
                None => tracing::info!(
                    claim = %bundle.claim_hash,
                    weight = bundle.total_weight,
                    "quorum bundle ready (no STEP_SUBMIT_URL; not submitting)"
                ),
            }
        }
    };

    if let Err(e) = swarm::run(cfg, submit, weight_of).await {
        eprintln!("gossip node error: {e}");
        std::process::exit(1);
    }
}

/// Read `activeWeight(addr)` from every endpoint and accept only a value a quorum
/// agrees on (#50). Returns 0 when there is no agreement (conservative: a vote
/// whose weight can't be agreed does not count). Logs a dissenting endpoint.
async fn active_weight_agreed(
    client: &reqwest::Client,
    rpcs: &[String],
    registry: &str,
    addr: &Address,
    min_agree: usize,
) -> u128 {
    let mut responses = Vec::with_capacity(rpcs.len());
    for rpc in rpcs {
        responses.push(active_weight(client, rpc, registry, addr).await);
    }
    match agree(&responses, min_agree) {
        Agreement::Agreed(w) => w,
        Agreement::AgreedWithDissent { value, dissent } => {
            tracing::warn!(
                validator = %step_validation_rules::sign::format_address(addr),
                dissent,
                "chain endpoints disagree on activeWeight — possible divergent/malicious node"
            );
            value
        }
        Agreement::NoQuorum => {
            tracing::warn!(
                validator = %step_validation_rules::sign::format_address(addr),
                "no quorum among chain endpoints for activeWeight — excluding vote"
            );
            0
        }
    }
}

/// Read `ValidatorRegistry.activeWeight(addr)` (returns uint256; weights fit in
/// u128). `None` on any RPC/parse error.
async fn active_weight(
    client: &reqwest::Client,
    rpc: &str,
    registry: &str,
    addr: &Address,
) -> Option<u128> {
    let mut data = Vec::with_capacity(4 + 32);
    data.extend_from_slice(&keccak256(b"activeWeight(address)")[..4]);
    data.extend_from_slice(&[0u8; 12]);
    data.extend_from_slice(addr); // left-padded address
    let body = serde_json::json!({
        "jsonrpc": "2.0", "id": 1, "method": "eth_call",
        "params": [{ "to": registry, "data": format!("0x{}", hex::encode(&data)) }, "latest"]
    });
    let resp = client.post(rpc).json(&body).send().await.ok()?;
    let v: serde_json::Value = resp.json().await.ok()?;
    let result = v.get("result")?.as_str()?;
    let bytes = hex::decode(result.strip_prefix("0x").unwrap_or(result)).ok()?;
    if bytes.len() < 32 {
        return None;
    }
    // low 16 bytes of the 32-byte word → u128 (weights never exceed u128)
    let mut w = [0u8; 16];
    w.copy_from_slice(&bytes[16..32]);
    Some(u128::from_be_bytes(w))
}

/// Resolve ValidatorRegistry from the shared deployments file, if present.
fn resolve_registry() -> Option<String> {
    let path = std::env::var("STEP_DEPLOYMENTS_FILE").ok()?;
    let raw = std::fs::read_to_string(path).ok()?;
    let v: serde_json::Value = serde_json::from_str(&raw).ok()?;
    v.get("ValidatorRegistry")?.as_str().map(str::to_string)
}
