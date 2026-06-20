//! Signed fleet heartbeats (#56): the agent periodically signs a compact status
//! report with its node key and POSTs it to the hub's `/v1/fleet/heartbeat`. This
//! gives supervision a hub-independent, anti-spoof signal: the hub verifies the
//! signature against the node's REGISTERED on-chain address, so only the node
//! itself can report its own state.
//!
//! The signed message is a canonical JSON object whose field order and contents
//! must match the verifier (`services/fleet-api/src/heartbeat.ts`) byte-for-byte,
//! since EIP-191 `personal_sign` covers the exact UTF-8 bytes.

use serde::Serialize;
use step_validation_rules::sign::{address_from_key_bytes, personal_sign_with_key_bytes};

/// The canonical signed payload. Field order here IS the signing order; it must
/// equal the TS `heartbeatMessage` key order (node, version, health, integrity,
/// ts, then degraded only when present).
#[derive(Serialize)]
struct Canonical<'a> {
    node: String,
    version: &'a str,
    health: &'a str,
    integrity: &'a str,
    ts: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    degraded: Option<&'a str>,
}

/// The wire body POSTed to the hub: the canonical fields plus the signature.
#[derive(Serialize)]
pub struct SignedHeartbeat {
    pub node: String,
    pub version: String,
    pub health: String,
    pub integrity: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub degraded: Option<String>,
    pub ts: String,
    pub sig: String,
}

/// Build the canonical signing message (must match the verifier exactly).
fn canonical_message(
    node_lower: &str,
    version: &str,
    health: &str,
    integrity: &str,
    ts: &str,
    degraded: Option<&str>,
) -> String {
    // Empty degraded is treated as absent (matches the TS verifier).
    let degraded = degraded.filter(|d| !d.is_empty());
    serde_json::to_string(&Canonical {
        node: node_lower.to_string(),
        version,
        health,
        integrity,
        ts,
        degraded,
    })
    .expect("canonical heartbeat serializes")
}

/// Build a signed heartbeat from the node's raw key bytes. Returns `None` if the
/// key is invalid. The `node` field is derived FROM the key (the signer address),
/// so it always matches the signature — the hub cross-checks it against the
/// registered set.
pub fn build_signed(
    key_bytes: &[u8],
    version: &str,
    health: &str,
    integrity: &str,
    ts: &str,
    degraded: Option<&str>,
) -> Option<SignedHeartbeat> {
    let addr = address_from_key_bytes(key_bytes)?;
    let node = format!("0x{}", hex::encode(addr));
    let msg = canonical_message(&node, version, health, integrity, ts, degraded);
    let sig = personal_sign_with_key_bytes(key_bytes, msg.as_bytes())?;
    Some(SignedHeartbeat {
        node,
        version: version.to_string(),
        health: health.to_string(),
        integrity: integrity.to_string(),
        degraded: degraded.filter(|d| !d.is_empty()).map(str::to_string),
        ts: ts.to_string(),
        sig: format!("0x{}", hex::encode(sig)),
    })
}

/// POST a heartbeat to the hub. Best-effort: a delivery failure is non-fatal (the
/// node keeps running); the hub will surface the node as `dark` if heartbeats stop.
pub fn post(
    client: &reqwest::blocking::Client,
    base_url: &str,
    hb: &SignedHeartbeat,
) -> Result<(), String> {
    let url = format!("{}/v1/fleet/heartbeat", base_url.trim_end_matches('/'));
    let resp = client
        .post(&url)
        .json(hb)
        .send()
        .map_err(|e| e.to_string())?;
    if resp.status().is_success() {
        Ok(())
    } else {
        Err(format!("hub rejected heartbeat: HTTP {}", resp.status()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use step_validation_rules::sign::{personal_digest, recover_address};

    // public anvil account #0 key — a well-known test vector, not a secret. // gitleaks:allow
    const PK: [u8; 32] = [
        0xac, 0x09, 0x74, 0xbe, 0xc3, 0x9a, 0x17, 0xe3, 0x6b, 0xa4, 0xa6, 0xb4, 0xd2, 0x38, 0xff,
        0x94, 0x4b, 0xac, 0xb4, 0x78, 0xcb, 0xed, 0x5e, 0xfc, 0xae, 0x78, 0x4d, 0x7b, 0xf4, 0xf2,
        0xff, 0x80,
    ];

    #[test]
    fn node_field_is_derived_from_the_key() {
        let hb = build_signed(&PK, "1.0.0", "up", "ok", "t", None).unwrap();
        let expect = format!("0x{}", hex::encode(address_from_key_bytes(&PK).unwrap()));
        assert_eq!(hb.node, expect);
    }

    #[test]
    fn signature_recovers_to_the_node_over_the_canonical_message() {
        let hb = build_signed(&PK, "1.0.0", "up", "ok", "2026-06-20T00:00:00.000Z", None).unwrap();
        let msg = canonical_message(
            &hb.node,
            "1.0.0",
            "up",
            "ok",
            "2026-06-20T00:00:00.000Z",
            None,
        );
        let sig = hex::decode(hb.sig.strip_prefix("0x").unwrap()).unwrap();
        let recovered = recover_address(&personal_digest(msg.as_bytes()), &sig).unwrap();
        assert_eq!(format!("0x{}", hex::encode(recovered)), hb.node);
    }

    #[test]
    fn empty_degraded_is_omitted_from_the_message_and_body() {
        let with_none = canonical_message("0xaa", "1", "up", "ok", "t", None);
        let with_empty = canonical_message("0xaa", "1", "up", "ok", "t", Some(""));
        assert_eq!(with_none, with_empty);
        assert!(!with_none.contains("degraded"));
        let hb = build_signed(&PK, "1", "up", "ok", "t", Some("")).unwrap();
        assert!(hb.degraded.is_none());
    }

    #[test]
    fn present_degraded_changes_the_signed_message() {
        let plain = canonical_message("0xaa", "1", "up", "ok", "t", None);
        let degraded = canonical_message("0xaa", "1", "up", "ok", "t", Some("hub down"));
        assert_ne!(plain, degraded);
        assert!(degraded.contains("hub down"));
    }

    #[test]
    fn canonical_field_order_matches_the_verifier() {
        // node, version, health, integrity, ts[, degraded] — must match the TS side.
        let m = canonical_message("0xaa", "1.0.0", "up", "ok", "t", Some("d"));
        assert_eq!(
            m,
            r#"{"node":"0xaa","version":"1.0.0","health":"up","integrity":"ok","ts":"t","degraded":"d"}"#
        );
    }

    #[test]
    fn invalid_key_yields_none() {
        assert!(build_signed(&[0u8; 5], "1", "up", "ok", "t", None).is_none());
    }
}
