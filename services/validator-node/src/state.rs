//! Node configuration and mutable state (nonce single-use set, per-wallet
//! claim history for movement plausibility, rate limiting).

use k256::ecdsa::SigningKey;
use serde::Deserialize;
use std::collections::HashMap;
use std::sync::Mutex;
use step_validation_rules::sign::{signer_address, Address};
use step_validation_rules::{PreviousClaim, ValidationParams};

#[derive(Debug, Clone, Deserialize)]
pub struct NodeConfig {
    pub port: u16,
    pub chain_id: u64,
    pub verifier_contract: String,
    pub validator_private_key: String,
    pub gateway_nonce_secret: String,
    pub allow_dev_claims: bool,
    pub params_file: String,
    /// Max approved claims per wallet per hour (rate limit, HARD §17 security).
    pub wallet_rate_limit_per_hour: u32,
}

impl NodeConfig {
    pub fn from_env() -> Result<Self, String> {
        fn req(k: &str) -> Result<String, String> {
            std::env::var(k).map_err(|_| format!("missing env {k}"))
        }
        // Verifier address: explicit env wins; otherwise read it from the shared
        // deployments file (container deployments mount it as a volume, matching
        // how the TS services consume STEP_DEPLOYMENTS_FILE).
        let verifier_contract = match std::env::var("VERIFIER_CONTRACT_ADDRESS") {
            Ok(addr) => addr,
            Err(_) => {
                let path = std::env::var("STEP_DEPLOYMENTS_FILE").map_err(|_| {
                    "set VERIFIER_CONTRACT_ADDRESS or STEP_DEPLOYMENTS_FILE".to_string()
                })?;
                let raw =
                    std::fs::read_to_string(&path).map_err(|e| format!("read {path}: {e}"))?;
                let v: serde_json::Value =
                    serde_json::from_str(&raw).map_err(|e| format!("parse {path}: {e}"))?;
                v.get("MiningClaimVerifier")
                    .and_then(|x| x.as_str())
                    .ok_or(format!("MiningClaimVerifier missing in {path}"))?
                    .to_string()
            }
        };
        Ok(NodeConfig {
            port: std::env::var("VALIDATOR_PORT")
                .unwrap_or_else(|_| "9100".into())
                .parse()
                .map_err(|_| "bad VALIDATOR_PORT")?,
            chain_id: req("STEP_CHAIN_ID")?
                .parse()
                .map_err(|_| "bad STEP_CHAIN_ID")?,
            verifier_contract,
            validator_private_key: req("VALIDATOR_PRIVATE_KEY")?,
            gateway_nonce_secret: req("GATEWAY_NONCE_SECRET")?,
            allow_dev_claims: std::env::var("VALIDATOR_ALLOW_DEV_CLAIMS")
                .map(|v| v == "true")
                .unwrap_or(false),
            params_file: std::env::var("STEP_PROTOCOL_PARAMS")
                .unwrap_or_else(|_| "config/protocol-params.alpha.json".into()),
            wallet_rate_limit_per_hour: std::env::var("VALIDATOR_WALLET_RATE_LIMIT")
                .unwrap_or_else(|_| "30".into())
                .parse()
                .map_err(|_| "bad VALIDATOR_WALLET_RATE_LIMIT")?,
        })
    }
}

/// Loads ValidationParams from the protocol parameter registry JSON
/// (config/protocol-params.alpha.json) — parameters are never hardcoded
/// (ENG-001).
pub fn load_params(path: &str, allow_dev_claims: bool) -> Result<ValidationParams, String> {
    let raw = std::fs::read_to_string(path).map_err(|e| format!("read {path}: {e}"))?;
    let v: serde_json::Value =
        serde_json::from_str(&raw).map_err(|e| format!("parse {path}: {e}"))?;
    let g = |group: &str, key: &str| -> Result<serde_json::Value, String> {
        v.get(group)
            .and_then(|x| x.get(key))
            .and_then(|x| x.get("value"))
            .cloned()
            .ok_or(format!("missing {group}.{key}.value in {path}"))
    };
    Ok(ValidationParams {
        claim_timestamp_window_s: g("proof", "claim_timestamp_window_seconds")?
            .as_i64()
            .ok_or("bad window")?,
        max_accuracy_radius_m: g("proof", "max_accuracy_radius_m_l1")?
            .as_f64()
            .ok_or("bad accuracy")?,
        max_accuracy_fraction_of_side: g("mesh", "max_accuracy_fraction_of_side")?
            .as_f64()
            .ok_or("bad fraction")?,
        max_plausible_speed_mps: g("proof", "max_plausible_speed_mps")?
            .as_f64()
            .ok_or("bad speed")?,
        fraud_score_reject_threshold: g("proof", "fraud_score_reject_threshold")?
            .as_f64()
            .ok_or("bad threshold")?,
        allow_dev_claims,
    })
}

pub struct AppState {
    pub config: NodeConfig,
    pub params: ValidationParams,
    pub signing_key: SigningKey,
    pub validator_address: Address,
    pub verifier_contract: Address,
    /// nonce hash → expiry unix seconds (single-use enforcement, POP-005).
    pub seen_nonces: Mutex<HashMap<[u8; 32], i64>>,
    /// wallet → last approved claim (movement plausibility input).
    pub last_approved: Mutex<HashMap<Address, PreviousClaim>>,
    /// wallet → (window start unix, approvals in window).
    pub rate: Mutex<HashMap<Address, (i64, u32)>>,
    pub metrics: crate::metrics::Metrics,
}

impl AppState {
    pub fn new(config: NodeConfig, signing_key: SigningKey) -> Self {
        let params =
            load_params(&config.params_file, config.allow_dev_claims).unwrap_or_else(|e| {
                eprintln!("parameter registry error: {e}");
                std::process::exit(2);
            });
        let verifier_contract = step_validation_rules::sign::parse_address(
            &config.verifier_contract,
        )
        .unwrap_or_else(|| {
            eprintln!("bad VERIFIER_CONTRACT_ADDRESS");
            std::process::exit(2);
        });
        let validator_address = signer_address(&signing_key);
        AppState {
            config,
            params,
            signing_key,
            validator_address,
            verifier_contract,
            seen_nonces: Mutex::new(HashMap::new()),
            last_approved: Mutex::new(HashMap::new()),
            rate: Mutex::new(HashMap::new()),
            metrics: crate::metrics::Metrics::default(),
        }
    }

    /// Sliding-hour rate limit per wallet. Returns false when exhausted.
    pub fn check_rate(&self, wallet: &Address, now_unix: i64) -> bool {
        let mut rate = self.rate.lock().expect("rate lock");
        let entry = rate.entry(*wallet).or_insert((now_unix, 0));
        if now_unix - entry.0 >= 3600 {
            *entry = (now_unix, 0);
        }
        if entry.1 >= self.config.wallet_rate_limit_per_hour {
            return false;
        }
        entry.1 += 1;
        true
    }
}
