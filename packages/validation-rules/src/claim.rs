//! Claim object (`step.proof.location.v1`) and its canonical signed message.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum IntegrityMode {
    /// Real App Attest + DeviceCheck evidence attached (ADR-015).
    Attested,
    /// Simulator/local development; accepted only when the node is configured
    /// with `allow_dev_claims=true` — never on pilot validators.
    DevUnattested,
    Failed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MerchantProof {
    pub kind: String, // "qr" in alpha
    pub payload: String,
}

/// Mirrors packages/schemas/step.proof.location.v1.json.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Claim {
    pub schema_version: String,
    pub wallet_address: String,
    pub triangle_id: String,
    pub mesh_level: u8,
    pub latitude: f64,
    pub longitude: f64,
    pub horizontal_accuracy_m: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub altitude_m: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub vertical_accuracy_m: Option<f64>,
    pub timestamp_utc: String,
    pub nonce: String,
    pub integrity_mode: IntegrityMode,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub app_attestation: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub device_integrity: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub previous_claim_hash: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub campaign_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub merchant_proof: Option<MerchantProof>,
    pub signature: String,
}

impl Claim {
    /// Canonical signed message (STEP-CLAIM-V1). Fixed decimal formatting
    /// removes float-serialisation ambiguity from the signed bytes; the same
    /// format is implemented in the iOS app and the gateway.
    ///
    /// ```text
    /// STEP-CLAIM-V1
    /// wallet=<lowercase 0x address>
    /// triangle=<triangle id string>
    /// level=<int>
    /// lat=<%.7f>
    /// lon=<%.7f>
    /// acc=<%.2f>
    /// ts=<RFC3339 UTC>
    /// nonce=<string>
    /// integrity=<attested|dev-unattested|failed>
    /// campaign=<id or "-">
    /// prev=<hash or "-">
    /// ```
    pub fn canonical_message(&self) -> String {
        let integrity = match self.integrity_mode {
            IntegrityMode::Attested => "attested",
            IntegrityMode::DevUnattested => "dev-unattested",
            IntegrityMode::Failed => "failed",
        };
        format!(
            "STEP-CLAIM-V1\nwallet={}\ntriangle={}\nlevel={}\nlat={:.7}\nlon={:.7}\nacc={:.2}\nts={}\nnonce={}\nintegrity={}\ncampaign={}\nprev={}\n",
            self.wallet_address.to_lowercase(),
            self.triangle_id,
            self.mesh_level,
            self.latitude,
            self.longitude,
            self.horizontal_accuracy_m,
            self.timestamp_utc,
            self.nonce,
            integrity,
            self.campaign_id.as_deref().unwrap_or("-"),
            self.previous_claim_hash.as_deref().unwrap_or("-"),
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    pub(crate) fn sample_claim() -> Claim {
        Claim {
            schema_version: "step.proof.location.v1".into(),
            wallet_address: "0xF39Fd6e51aad88F6F4ce6aB8827279cffFb92266".into(),
            triangle_id: "STEP-21-F00-12203302320201032103".into(),
            mesh_level: 21,
            latitude: 47.4979,
            longitude: 19.0402,
            horizontal_accuracy_m: 8.2,
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
            signature: "0x".into(),
        }
    }

    #[test]
    fn canonical_message_is_stable() {
        let msg = sample_claim().canonical_message();
        assert!(
            msg.starts_with("STEP-CLAIM-V1\nwallet=0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266\n")
        );
        assert!(msg.contains("\nlat=47.4979000\n"));
        assert!(msg.contains("\nlon=19.0402000\n"));
        assert!(msg.contains("\nacc=8.20\n"));
        assert!(msg.contains("\ncampaign=-\n"));
        assert!(msg.ends_with("prev=-\n"));
        // Same input → same bytes, always.
        assert_eq!(msg, sample_claim().canonical_message());
    }
}
