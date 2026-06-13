//! The deterministic claim validation pipeline (POP-003 / DEV §8.2).
//!
//! Every check that can fail records a `RejectReason`; a claim is approvable
//! only if NO reasons were recorded (HARD §6.4: all conditions ANDed). Order
//! is fixed and cheap-first; all checks run so rejections carry the complete
//! reason set for the evidence bundle and merchant reporting.

use crate::claim::{Claim, IntegrityMode};
use crate::fraud::{score_claim, FraudScore, PreviousClaim};
use crate::sign::{personal_digest, recover_address};
use serde::{Deserialize, Serialize};
use step_mesh_engine::{boundary_policy, BoundaryVerdict};
use time::format_description::well_known::Rfc3339;
use time::OffsetDateTime;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RejectReason {
    SchemaVersionUnsupported,
    FieldOutOfRange,
    TimestampUnparseable,
    TimestampOutsideWindow,
    NonceMalformed,
    NonceRejected, // node-level single-use / TTL verdict fed in via context
    IntegrityModeRejected,
    AttestationMissing,
    SignatureInvalid,
    SignerMismatch,
    TriangleMismatch,
    LevelNotMineable,
    AccuracyTooLow,
    FraudScoreTooHigh,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ValidationParams {
    /// Mirrors config/protocol-params.alpha.json `proof.*` and `mesh.*` groups.
    pub claim_timestamp_window_s: i64,
    pub max_accuracy_radius_m: f64,
    pub max_accuracy_fraction_of_side: f64,
    pub max_plausible_speed_mps: f64,
    pub fraud_score_reject_threshold: f64,
    pub mineable_levels: Vec<u8>,
    pub allow_dev_claims: bool,
}

/// Node-supplied facts the pure rules cannot know themselves.
#[derive(Debug, Clone)]
pub struct ValidationContext {
    /// Wall-clock now, RFC3339 (passed in for determinism/testability).
    pub now_utc: String,
    /// Node verdict on nonce freshness/single-use (ADR-017 gateway nonces).
    pub nonce_fresh: bool,
    /// Last accepted claim of this wallet, if any.
    pub previous: Option<PreviousClaim>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Verdict {
    pub approve: bool,
    pub reject_reasons: Vec<RejectReason>,
    pub fraud: FraudScore,
    /// Resolved boundary classification (informational for evidence bundle).
    pub boundary: String,
}

fn parse_ts(s: &str) -> Option<OffsetDateTime> {
    OffsetDateTime::parse(s, &Rfc3339).ok()
}

pub fn validate_claim(
    claim: &Claim,
    params: &ValidationParams,
    ctx: &ValidationContext,
) -> Verdict {
    let mut reasons: Vec<RejectReason> = Vec::new();

    // 1. Schema version.
    if claim.schema_version != "step.proof.location.v1" {
        reasons.push(RejectReason::SchemaVersionUnsupported);
    }

    // 2. Field bounds.
    if !(-90.0..=90.0).contains(&claim.latitude)
        || !(-180.0..=180.0).contains(&claim.longitude)
        || !claim.latitude.is_finite()
        || !claim.longitude.is_finite()
        || !claim.horizontal_accuracy_m.is_finite()
        || claim.horizontal_accuracy_m <= 0.0
        || claim.horizontal_accuracy_m > 10_000.0
    {
        reasons.push(RejectReason::FieldOutOfRange);
    }

    // 3. Timestamp window (POP-005 freshness).
    match (parse_ts(&claim.timestamp_utc), parse_ts(&ctx.now_utc)) {
        (Some(ts), Some(now)) => {
            let dt = (now - ts).whole_seconds().abs();
            if dt > params.claim_timestamp_window_s {
                reasons.push(RejectReason::TimestampOutsideWindow);
            }
        }
        _ => reasons.push(RejectReason::TimestampUnparseable),
    }

    // 4. Nonce: format + node freshness verdict (single-use, TTL).
    if claim.nonce.len() < 16 || claim.nonce.len() > 128 {
        reasons.push(RejectReason::NonceMalformed);
    }
    if !ctx.nonce_fresh {
        reasons.push(RejectReason::NonceRejected);
    }

    // 5. Integrity mode policy (ADR-015: no silent upgrades, ever).
    let attested = match claim.integrity_mode {
        IntegrityMode::Attested => {
            if claim.app_attestation.is_none() || claim.device_integrity.is_none() {
                reasons.push(RejectReason::AttestationMissing);
            }
            true
        }
        IntegrityMode::DevUnattested => {
            if !params.allow_dev_claims {
                reasons.push(RejectReason::IntegrityModeRejected);
            }
            false
        }
        IntegrityMode::Failed => {
            reasons.push(RejectReason::IntegrityModeRejected);
            false
        }
    };

    // 6. Miner signature over the canonical message (EIP-191 personal sign).
    let msg = claim.canonical_message();
    let digest = personal_digest(msg.as_bytes());
    match (
        crate::sign::parse_address(&claim.wallet_address),
        claim
            .signature
            .strip_prefix("0x")
            .and_then(|h| hex::decode(h).ok()),
    ) {
        (Some(wallet), Some(sig)) => match recover_address(&digest, &sig) {
            Ok(recovered) if recovered == wallet => {}
            Ok(_) => reasons.push(RejectReason::SignerMismatch),
            Err(_) => reasons.push(RejectReason::SignatureInvalid),
        },
        _ => reasons.push(RejectReason::SignatureInvalid),
    }

    // 7. Mineable level (natural claims; sponsored campaigns pin triangles).
    if claim.campaign_id.is_none() && !params.mineable_levels.contains(&claim.mesh_level) {
        reasons.push(RejectReason::LevelNotMineable);
    }

    // 8. Geometry: independent containment recomputation (the heart of the
    //    protocol — validators NEVER trust the client's triangle claim).
    let mut boundary = "unresolved".to_string();
    match boundary_policy(
        claim.latitude,
        claim.longitude,
        claim.horizontal_accuracy_m,
        claim.mesh_level,
        params.max_accuracy_fraction_of_side,
    ) {
        Ok(decision) => {
            if decision.triangle.to_string() != claim.triangle_id {
                reasons.push(RejectReason::TriangleMismatch);
            }
            boundary = match decision.verdict {
                BoundaryVerdict::Inside => "inside".into(),
                BoundaryVerdict::BoundaryAmbiguous => "boundary_ambiguous".into(),
                BoundaryVerdict::RejectAccuracy => {
                    reasons.push(RejectReason::AccuracyTooLow);
                    "reject_accuracy".into()
                }
            };
        }
        Err(_) => reasons.push(RejectReason::FieldOutOfRange),
    }

    // 9. Hard accuracy ceiling for the proof tier.
    if claim.horizontal_accuracy_m > params.max_accuracy_radius_m
        && !reasons.contains(&RejectReason::AccuracyTooLow)
    {
        reasons.push(RejectReason::AccuracyTooLow);
    }

    // 10. Fraud scoring (speed/teleport/accuracy-anomaly/unattested).
    let fraud = score_claim(
        claim.latitude,
        claim.longitude,
        &claim.timestamp_utc,
        claim.horizontal_accuracy_m,
        attested,
        ctx.previous.as_ref(),
        params.max_plausible_speed_mps,
    );
    if fraud.score >= params.fraud_score_reject_threshold {
        reasons.push(RejectReason::FraudScoreTooHigh);
    }

    Verdict {
        approve: reasons.is_empty(),
        reject_reasons: reasons,
        fraud,
        boundary,
    }
}
