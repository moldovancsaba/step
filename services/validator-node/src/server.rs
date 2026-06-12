//! HTTP surface: POST /v1/validate, GET /healthz, GET /metrics.

use crate::nonce::verify_nonce;
use crate::state::AppState;
use axum::extract::State;
use axum::http::StatusCode;
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::{Deserialize, Serialize};
use std::sync::atomic::Ordering;
use std::sync::Arc;
use step_validation_rules::sign::{
    claim_hash, eip712_vote_digest, format_address, parse_address, sign_digest, triangle_id_hash,
};
use step_validation_rules::{validate_claim, Claim, PreviousClaim, ValidationContext, Verdict};
use time::format_description::well_known::Rfc3339;
use time::OffsetDateTime;

#[derive(Debug, Deserialize)]
pub struct ValidateRequest {
    pub claim: Claim,
}

#[derive(Debug, Serialize)]
pub struct SignedVote {
    pub validator: String,
    /// 65-byte r||s||v hex signature over the EIP-712 vote digest — submittable
    /// directly to MiningClaimVerifier.
    pub signature: String,
    pub claim_hash: String,
    pub triangle_id_hash: String,
    pub miner: String,
    pub approve: bool,
}

#[derive(Debug, Serialize)]
pub struct ValidateResponse {
    pub verdict: Verdict,
    pub vote: SignedVote,
    pub validated_at: String,
}

pub fn router(state: Arc<AppState>) -> Router {
    Router::new()
        .route("/v1/validate", post(validate))
        .route("/healthz", get(healthz))
        .route("/metrics", get(metrics))
        .with_state(state)
}

async fn healthz() -> &'static str {
    "ok"
}

async fn metrics(State(state): State<Arc<AppState>>) -> String {
    state.metrics.render()
}

async fn validate(
    State(state): State<Arc<AppState>>,
    Json(req): Json<ValidateRequest>,
) -> Result<Json<ValidateResponse>, (StatusCode, String)> {
    state.metrics.claims_total.fetch_add(1, Ordering::Relaxed);
    let claim = req.claim;

    let wallet = parse_address(&claim.wallet_address)
        .ok_or((StatusCode::BAD_REQUEST, "bad wallet address".to_string()))?;

    let now = OffsetDateTime::now_utc();
    let now_unix = now.unix_timestamp();
    let now_utc = now.format(&Rfc3339).expect("rfc3339 format");

    // Rate limit before any expensive work (HARD §17.1 emulator-farm defence).
    if !state.check_rate(&wallet, now_unix) {
        state
            .metrics
            .rate_limited_total
            .fetch_add(1, Ordering::Relaxed);
        return Err((
            StatusCode::TOO_MANY_REQUESTS,
            "wallet rate limit".to_string(),
        ));
    }

    // Nonce: gateway tag + expiry + single-use (POP-005).
    let nv = verify_nonce(
        &state.config.gateway_nonce_secret,
        &claim.nonce,
        &wallet,
        now_unix,
    );
    let nonce_fresh = if nv.fresh {
        let mut seen = state.seen_nonces.lock().expect("nonce lock");
        seen.retain(|_, exp| *exp > now_unix - 600); // purge stale entries
        match seen.entry(nv.nonce_key) {
            std::collections::hash_map::Entry::Occupied(_) => {
                state
                    .metrics
                    .nonce_replay_total
                    .fetch_add(1, Ordering::Relaxed);
                false
            }
            std::collections::hash_map::Entry::Vacant(slot) => {
                slot.insert(now_unix + 600);
                true
            }
        }
    } else {
        false
    };

    let previous: Option<PreviousClaim> = {
        let last = state.last_approved.lock().expect("history lock");
        last.get(&wallet).cloned()
    };

    let ctx = ValidationContext {
        now_utc: now_utc.clone(),
        nonce_fresh,
        previous,
    };
    let verdict = validate_claim(&claim, &state.params, &ctx);
    let approve = verdict.approve;

    // Sign the vote either way: rejections are signed evidence too (SYS §12.5).
    let msg = claim.canonical_message();
    let ch = claim_hash(&msg);
    let th = triangle_id_hash(&claim.triangle_id);
    let digest = eip712_vote_digest(
        state.config.chain_id,
        &state.verifier_contract,
        &ch,
        &th,
        &wallet,
        approve,
    );
    let sig = sign_digest(&digest, &state.signing_key);

    if approve {
        state.metrics.approved_total.fetch_add(1, Ordering::Relaxed);
        let mut last = state.last_approved.lock().expect("history lock");
        last.insert(
            wallet,
            PreviousClaim {
                latitude: claim.latitude,
                longitude: claim.longitude,
                timestamp_utc: claim.timestamp_utc.clone(),
            },
        );
        tracing::info!(claim = %hex::encode(ch), triangle = %claim.triangle_id, "approved");
    } else {
        state.metrics.rejected_total.fetch_add(1, Ordering::Relaxed);
        tracing::info!(
            claim = %hex::encode(ch),
            reasons = ?verdict.reject_reasons,
            "rejected"
        );
    }

    Ok(Json(ValidateResponse {
        verdict,
        vote: SignedVote {
            validator: format_address(&state.validator_address),
            signature: format!("0x{}", hex::encode(sig)),
            claim_hash: format!("0x{}", hex::encode(ch)),
            triangle_id_hash: format!("0x{}", hex::encode(th)),
            miner: claim.wallet_address.to_lowercase(),
            approve,
        },
        validated_at: now_utc,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::nonce::make_nonce;
    use crate::state::NodeConfig;
    use http_body_util::BodyExt;
    use k256::ecdsa::SigningKey;
    use step_mesh_engine::lat_lon_to_triangle;
    use step_validation_rules::sign::{personal_digest, signer_address};
    use step_validation_rules::IntegrityMode;
    use tower::ServiceExt;

    const SECRET: &str = "node-test-secret";

    fn test_state() -> Arc<AppState> {
        let config = NodeConfig {
            port: 0,
            chain_id: 31337,
            verifier_contract: "0x610178dA211FEF7D417bC0e6FeD39F05609AD788".into(),
            validator_private_key: hex::encode([0x11; 32]),
            gateway_nonce_secret: SECRET.into(),
            allow_dev_claims: true,
            params_file: concat!(
                env!("CARGO_MANIFEST_DIR"),
                "/../../config/protocol-params.alpha.json"
            )
            .into(),
            wallet_rate_limit_per_hour: 5,
        };
        let key = SigningKey::from_slice(&[0x11; 32]).unwrap();
        Arc::new(AppState::new(config, key))
    }

    fn build_claim(now: OffsetDateTime) -> (Claim, SigningKey) {
        let key = SigningKey::from_slice(&[0x42; 32]).unwrap();
        let wallet_addr = signer_address(&key);
        let wallet = format_address(&wallet_addr);
        let (lat, lon, level) = (47.4979, 19.0402, 21u8);
        let mut claim = Claim {
            schema_version: "step.proof.location.v1".into(),
            wallet_address: wallet,
            triangle_id: lat_lon_to_triangle(lat, lon, level).unwrap().to_string(),
            mesh_level: level,
            latitude: lat,
            longitude: lon,
            horizontal_accuracy_m: 5.0,
            altitude_m: None,
            vertical_accuracy_m: None,
            timestamp_utc: now.format(&Rfc3339).unwrap(),
            nonce: make_nonce(SECRET, &wallet_addr, now.unix_timestamp() + 120, "cafe0123"),
            integrity_mode: IntegrityMode::DevUnattested,
            app_attestation: None,
            device_integrity: None,
            previous_claim_hash: None,
            campaign_id: None,
            merchant_proof: None,
            signature: String::new(),
        };
        let digest = personal_digest(claim.canonical_message().as_bytes());
        claim.signature = format!("0x{}", hex::encode(sign_digest(&digest, &key)));
        (claim, key)
    }

    async fn post_claim(app: Router, claim: &Claim) -> (StatusCode, serde_json::Value) {
        let body = serde_json::json!({ "claim": claim }).to_string();
        let resp = app
            .oneshot(
                axum::http::Request::builder()
                    .method("POST")
                    .uri("/v1/validate")
                    .header("content-type", "application/json")
                    .body(axum::body::Body::from(body))
                    .unwrap(),
            )
            .await
            .unwrap();
        let status = resp.status();
        let bytes = resp.into_body().collect().await.unwrap().to_bytes();
        let json: serde_json::Value =
            serde_json::from_slice(&bytes).unwrap_or(serde_json::json!({}));
        (status, json)
    }

    #[tokio::test]
    async fn approves_valid_claim_with_recoverable_vote() {
        let state = test_state();
        let app = router(state.clone());
        let (claim, _) = build_claim(OffsetDateTime::now_utc());
        let (status, json) = post_claim(app, &claim).await;
        assert_eq!(status, StatusCode::OK, "body: {json}");
        assert_eq!(json["verdict"]["approve"], true, "body: {json}");

        // The returned vote must recover to this node's validator address.
        let sig = hex::decode(
            json["vote"]["signature"]
                .as_str()
                .unwrap()
                .trim_start_matches("0x"),
        )
        .unwrap();
        let ch: [u8; 32] = hex::decode(
            json["vote"]["claim_hash"]
                .as_str()
                .unwrap()
                .trim_start_matches("0x"),
        )
        .unwrap()
        .try_into()
        .unwrap();
        let th: [u8; 32] = hex::decode(
            json["vote"]["triangle_id_hash"]
                .as_str()
                .unwrap()
                .trim_start_matches("0x"),
        )
        .unwrap()
        .try_into()
        .unwrap();
        let miner = parse_address(json["vote"]["miner"].as_str().unwrap()).unwrap();
        let digest = eip712_vote_digest(
            31337,
            &parse_address("0x610178dA211FEF7D417bC0e6FeD39F05609AD788").unwrap(),
            &ch,
            &th,
            &miner,
            true,
        );
        let recovered = step_validation_rules::sign::recover_address(&digest, &sig).unwrap();
        assert_eq!(recovered, state.validator_address);
    }

    #[tokio::test]
    async fn nonce_single_use_is_enforced() {
        let state = test_state();
        let (claim, _) = build_claim(OffsetDateTime::now_utc());

        let (s1, j1) = post_claim(router(state.clone()), &claim).await;
        assert_eq!(s1, StatusCode::OK);
        assert_eq!(j1["verdict"]["approve"], true);

        // Identical claim again: same nonce → rejected as replay.
        let (s2, j2) = post_claim(router(state.clone()), &claim).await;
        assert_eq!(s2, StatusCode::OK);
        assert_eq!(j2["verdict"]["approve"], false);
        assert!(j2["verdict"]["reject_reasons"]
            .as_array()
            .unwrap()
            .iter()
            .any(|r| r == "nonce_rejected"));
    }

    #[tokio::test]
    async fn wallet_rate_limit_enforced() {
        let state = test_state(); // limit 5/h
        let now = OffsetDateTime::now_utc();
        for i in 0..5 {
            let (mut claim, key) = build_claim(now);
            claim.nonce = make_nonce(
                SECRET,
                &signer_address(&key),
                now.unix_timestamp() + 120,
                &format!("aa{i:02}"),
            );
            let digest = personal_digest(claim.canonical_message().as_bytes());
            claim.signature = format!("0x{}", hex::encode(sign_digest(&digest, &key)));
            let (s, _) = post_claim(router(state.clone()), &claim).await;
            assert_eq!(s, StatusCode::OK, "claim {i} within limit");
        }
        let (claim, _) = build_claim(now);
        let (s, _) = post_claim(router(state.clone()), &claim).await;
        assert_eq!(
            s,
            StatusCode::TOO_MANY_REQUESTS,
            "sixth claim must be limited"
        );
    }

    #[tokio::test]
    async fn malformed_body_is_bad_request() {
        let state = test_state();
        let resp = router(state)
            .oneshot(
                axum::http::Request::builder()
                    .method("POST")
                    .uri("/v1/validate")
                    .header("content-type", "application/json")
                    .body(axum::body::Body::from("{\"claim\":{\"nope\":1}}"))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::UNPROCESSABLE_ENTITY);
    }

    #[tokio::test]
    async fn metrics_and_health_endpoints() {
        let state = test_state();
        let app = router(state);
        let resp = app
            .clone()
            .oneshot(
                axum::http::Request::builder()
                    .uri("/healthz")
                    .body(axum::body::Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::OK);
        let resp = app
            .oneshot(
                axum::http::Request::builder()
                    .uri("/metrics")
                    .body(axum::body::Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        let bytes = resp.into_body().collect().await.unwrap().to_bytes();
        assert!(String::from_utf8_lossy(&bytes).contains("step_validator_claims_total"));
    }
}
