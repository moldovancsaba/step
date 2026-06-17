//! Full-pipeline validation tests: every POP-003 acceptance condition has at
//! least one test proving rejection when it fails (test plan §1.3).

use k256::ecdsa::SigningKey;
use step_mesh_engine::lat_lon_to_triangle;
use step_validation_rules::*;

const LAT: f64 = 47.4979;
const LON: f64 = 19.0402;
const LEVEL: u8 = 21;

fn miner_key() -> SigningKey {
    SigningKey::from_slice(&[0x42; 32]).unwrap()
}

fn params() -> ValidationParams {
    ValidationParams {
        claim_timestamp_window_s: 300,
        max_accuracy_radius_m: 25.0,
        max_accuracy_fraction_of_side: 1.0,
        max_plausible_speed_mps: 69.4,
        fraud_score_reject_threshold: 0.7,
        allow_dev_claims: true,
    }
}

fn ctx() -> ValidationContext {
    ValidationContext {
        now_utc: "2026-06-12T10:00:30Z".into(),
        nonce_fresh: true,
        previous: None,
    }
}

/// Build a fully signed, geometrically correct claim.
fn signed_claim() -> Claim {
    let key = miner_key();
    let wallet = sign::format_address(&sign::signer_address(&key));
    let triangle = lat_lon_to_triangle(LAT, LON, LEVEL).unwrap().to_string();
    let mut claim = Claim {
        schema_version: "step.proof.location.v1".into(),
        wallet_address: wallet,
        triangle_id: triangle,
        mesh_level: LEVEL,
        latitude: LAT,
        longitude: LON,
        horizontal_accuracy_m: 4.0,
        altitude_m: None,
        vertical_accuracy_m: None,
        timestamp_utc: "2026-06-12T10:00:00Z".into(),
        nonce: "dGVzdC1ub25jZS0xMjM0NTY3OA".into(),
        integrity_mode: IntegrityMode::DevUnattested,
        app_attestation: None,
        device_integrity: None,
        previous_claim_hash: None,
        campaign_id: None,
        merchant_proof: None,
        signature: String::new(),
    };
    let digest = sign::personal_digest(claim.canonical_message().as_bytes());
    let sig = sign::sign_digest(&digest, &key);
    claim.signature = format!("0x{}", hex::encode(sig));
    claim
}

#[test]
fn valid_claim_is_approved() {
    let v = validate_claim(&signed_claim(), &params(), &ctx());
    assert!(v.approve, "expected approval, got {:?}", v.reject_reasons);
    assert_eq!(
        v.fraud.score, 0.4,
        "dev-unattested carries soft signal only"
    );
    // At the selected level (21 in this fixture), a realistic GPS accuracy
    // circle often overlaps an edge: BoundaryAmbiguous is the NORMAL state and
    // does not block approval.
    assert!(v.boundary == "inside" || v.boundary == "boundary_ambiguous");
}

#[test]
fn tampered_field_breaks_signature() {
    let mut c = signed_claim();
    c.horizontal_accuracy_m = 3.0; // any signed-field change invalidates
    let v = validate_claim(&c, &params(), &ctx());
    assert!(!v.approve);
    assert!(
        v.reject_reasons.contains(&RejectReason::SignerMismatch)
            || v.reject_reasons.contains(&RejectReason::SignatureInvalid)
    );
}

#[test]
fn wrong_wallet_rejected() {
    let mut c = signed_claim();
    c.wallet_address = "0x000000000000000000000000000000000000dEaD".into();
    let v = validate_claim(&c, &params(), &ctx());
    assert!(v.reject_reasons.contains(&RejectReason::SignerMismatch));
}

#[test]
fn wrong_triangle_rejected_by_independent_geometry() {
    let mut c = signed_claim();
    // Claim a triangle the miner is NOT inside (re-sign so only geometry fails).
    c.triangle_id = lat_lon_to_triangle(51.5074, -0.1278, LEVEL)
        .unwrap()
        .to_string();
    let key = miner_key();
    let digest = sign::personal_digest(c.canonical_message().as_bytes());
    c.signature = format!("0x{}", hex::encode(sign::sign_digest(&digest, &key)));
    let v = validate_claim(&c, &params(), &ctx());
    assert!(v.reject_reasons.contains(&RejectReason::TriangleMismatch));
}

#[test]
fn stale_timestamp_rejected() {
    let mut c = signed_claim();
    c.timestamp_utc = "2026-06-12T08:00:00Z".into();
    let key = miner_key();
    let digest = sign::personal_digest(c.canonical_message().as_bytes());
    c.signature = format!("0x{}", hex::encode(sign::sign_digest(&digest, &key)));
    let v = validate_claim(&c, &params(), &ctx());
    assert!(v
        .reject_reasons
        .contains(&RejectReason::TimestampOutsideWindow));
}

#[test]
fn replayed_nonce_rejected() {
    let mut context = ctx();
    context.nonce_fresh = false;
    let v = validate_claim(&signed_claim(), &params(), &context);
    assert!(v.reject_reasons.contains(&RejectReason::NonceRejected));
}

#[test]
fn dev_claims_rejected_on_pilot_validators() {
    let mut p = params();
    p.allow_dev_claims = false; // ADR-015 pilot configuration
    let v = validate_claim(&signed_claim(), &p, &ctx());
    assert!(v
        .reject_reasons
        .contains(&RejectReason::IntegrityModeRejected));
}

#[test]
fn attested_mode_requires_tokens() {
    let mut c = signed_claim();
    c.integrity_mode = IntegrityMode::Attested; // but no tokens attached
    let key = miner_key();
    let digest = sign::personal_digest(c.canonical_message().as_bytes());
    c.signature = format!("0x{}", hex::encode(sign::sign_digest(&digest, &key)));
    let v = validate_claim(&c, &params(), &ctx());
    assert!(v.reject_reasons.contains(&RejectReason::AttestationMissing));
}

#[test]
fn bad_accuracy_rejected() {
    let mut c = signed_claim();
    c.horizontal_accuracy_m = 50.0; // above 25 m ceiling AND above triangle size
    let key = miner_key();
    let digest = sign::personal_digest(c.canonical_message().as_bytes());
    c.signature = format!("0x{}", hex::encode(sign::sign_digest(&digest, &key)));
    let v = validate_claim(&c, &params(), &ctx());
    assert!(v.reject_reasons.contains(&RejectReason::AccuracyTooLow));
}

#[test]
fn teleporting_miner_rejected() {
    let mut context = ctx();
    context.previous = Some(PreviousClaim {
        latitude: 51.5074, // London one minute ago; claim is from Budapest
        longitude: -0.1278,
        timestamp_utc: "2026-06-12T09:59:00Z".into(),
    });
    let v = validate_claim(&signed_claim(), &params(), &context);
    assert!(v.reject_reasons.contains(&RejectReason::FraudScoreTooHigh));
    assert!(v
        .fraud
        .signals
        .iter()
        .any(|s| s.signal == "speed_violation"));
}

#[test]
fn claim_hash_and_triangle_hash_are_stable() {
    let c = signed_claim();
    let h1 = sign::claim_hash(&c.canonical_message());
    let h2 = sign::claim_hash(&c.canonical_message());
    assert_eq!(h1, h2);
    let th = sign::triangle_id_hash(&c.triangle_id);
    assert_eq!(th, sign::keccak256(c.triangle_id.as_bytes()));
}
