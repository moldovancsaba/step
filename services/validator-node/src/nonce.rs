//! Gateway-issued nonce verification (ADR-017).
//!
//! Alpha nonce format (printable ASCII, dot-separated, ≤128 chars per schema):
//! `payload.tag_hex` where payload = `wallet_hex:expiry_unix:random_hex`
//! and `tag = keccak256(secret_bytes || payload_bytes)[..16]`.
//!
//! The shared secret between gateway and pilot validators is an explicitly
//! documented alpha centralisation point (SYS §12.1 progressive
//! decentralisation); MVP replaces it with validator-issued threshold
//! challenges. This is a keyed-keccak tag, not RFC-2104 HMAC — sufficient for
//! the alpha trust model where the secret holder set == the foundation.

use step_validation_rules::sign::{keccak256, Address};

pub struct NonceVerdict {
    pub fresh: bool,
    /// keccak of the whole nonce string: the single-use registry key.
    pub nonce_key: [u8; 32],
}

/// Reference implementation of nonce issuance. Production issuance lives in
/// the TypeScript gateway (services/gateway-api); this function is the
/// format's executable specification and is exercised by the node tests.
#[cfg_attr(not(test), allow(dead_code))]
pub fn make_nonce(secret: &str, wallet: &Address, expiry_unix: i64, random_hex: &str) -> String {
    let payload = format!("{}:{}:{}", hex::encode(wallet), expiry_unix, random_hex);
    let mut keyed = Vec::with_capacity(secret.len() + payload.len());
    keyed.extend_from_slice(secret.as_bytes());
    keyed.extend_from_slice(payload.as_bytes());
    let tag = keccak256(&keyed);
    format!("{}.{}", payload, hex::encode(&tag[..16]))
}

pub fn verify_nonce(secret: &str, nonce: &str, wallet: &Address, now_unix: i64) -> NonceVerdict {
    let nonce_key = keccak256(nonce.as_bytes());
    let reject = NonceVerdict {
        fresh: false,
        nonce_key,
    };

    let Some((payload, tag_hex)) = nonce.rsplit_once('.') else {
        return reject;
    };

    // Tag check (constant-length compare; timing is not a concern for
    // single-use random nonces, documented).
    let mut keyed = Vec::with_capacity(secret.len() + payload.len());
    keyed.extend_from_slice(secret.as_bytes());
    keyed.extend_from_slice(payload.as_bytes());
    let expected = keccak256(&keyed);
    if hex::encode(&expected[..16]) != tag_hex {
        return reject;
    }

    // Payload: wallet binding + expiry.
    let parts: Vec<&str> = payload.split(':').collect();
    if parts.len() != 3 {
        return reject;
    }
    if parts[0] != hex::encode(wallet) {
        return reject;
    }
    let Ok(expiry) = parts[1].parse::<i64>() else {
        return reject;
    };
    if now_unix > expiry {
        return reject;
    }

    NonceVerdict {
        fresh: true,
        nonce_key,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SECRET: &str = "test-secret";

    fn wallet() -> Address {
        [0xAB; 20]
    }

    #[test]
    fn valid_nonce_verifies() {
        let n = make_nonce(SECRET, &wallet(), 2_000_000_000, "deadbeef");
        assert!(verify_nonce(SECRET, &n, &wallet(), 1_999_999_999).fresh);
    }

    #[test]
    fn expired_nonce_rejected() {
        let n = make_nonce(SECRET, &wallet(), 1_000, "deadbeef");
        assert!(!verify_nonce(SECRET, &n, &wallet(), 2_000).fresh);
    }

    #[test]
    fn wrong_wallet_rejected() {
        let n = make_nonce(SECRET, &wallet(), 2_000_000_000, "deadbeef");
        let other: Address = [0xCD; 20];
        assert!(!verify_nonce(SECRET, &n, &other, 1_000).fresh);
    }

    #[test]
    fn tampered_or_wrong_secret_rejected() {
        let n = make_nonce(SECRET, &wallet(), 2_000_000_000, "deadbeef");
        assert!(!verify_nonce("other-secret", &n, &wallet(), 1_000).fresh);
        let mut tampered = n.clone();
        tampered.replace_range(0..2, "ff");
        assert!(!verify_nonce(SECRET, &tampered, &wallet(), 1_000).fresh);
        assert!(!verify_nonce(SECRET, "garbage", &wallet(), 1_000).fresh);
    }
}
