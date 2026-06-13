// Temporary vector generator: emits the cross-language conformance vector JSON.
use k256::ecdsa::SigningKey;
use step_validation_rules::*;

fn main() {
    let key = SigningKey::from_slice(&[0x42; 32]).unwrap();
    let wallet_addr = sign::signer_address(&key);
    let wallet = sign::format_address(&wallet_addr);
    let triangle = step_mesh_engine::lat_lon_to_triangle(47.4979, 19.0402, 21)
        .unwrap()
        .to_string();
    let nonce = "f39f000000000000000000000000000000000000:2000000000:cafe0123";
    // keyed tag with secret "vector-secret"
    let mut keyed = Vec::new();
    keyed.extend_from_slice(b"vector-secret");
    keyed.extend_from_slice(nonce.as_bytes());
    let tag = sign::keccak256(&keyed);
    let full_nonce = format!("{}.{}", nonce, hex::encode(&tag[..16]));

    let mut claim = Claim {
        schema_version: "step.proof.location.v1".into(),
        wallet_address: wallet.clone(),
        triangle_id: triangle.clone(),
        mesh_level: 21,
        latitude: 47.4979,
        longitude: 19.0402,
        horizontal_accuracy_m: 5.0,
        altitude_m: None,
        vertical_accuracy_m: None,
        timestamp_utc: "2026-06-12T10:00:00Z".into(),
        nonce: full_nonce.clone(),
        integrity_mode: IntegrityMode::DevUnattested,
        app_attestation: None,
        device_integrity: None,
        previous_claim_hash: None,
        campaign_id: None,
        merchant_proof: None,
        signature: String::new(),
    };
    let msg = claim.canonical_message();
    let digest = sign::personal_digest(msg.as_bytes());
    let sig = sign::sign_digest(&digest, &key);
    claim.signature = format!("0x{}", hex::encode(sig));
    let ch = sign::claim_hash(&msg);
    let th = sign::triangle_id_hash(&triangle);
    let contract = sign::parse_address("0x610178dA211FEF7D417bC0e6FeD39F05609AD788").unwrap();
    let vote_digest = sign::eip712_vote_digest(31337, &contract, &ch, &th, &wallet_addr, true);

    println!(
        "{}",
        serde_json::json!({
            "miner_private_key": "0x4242424242424242424242424242424242424242424242424242424242424242",
            "wallet": wallet,
            "triangle_id": triangle,
            "nonce_secret": "vector-secret",
            "nonce": full_nonce,
            "canonical_message": msg,
            "claim_hash": format!("0x{}", hex::encode(ch)),
            "triangle_id_hash": format!("0x{}", hex::encode(th)),
            "miner_signature": claim.signature,
            "vote_digest_chain31337_contract_0x610178dA211FEF7D417bC0e6FeD39F05609AD788": format!("0x{}", hex::encode(vote_digest)),
            "claim_json": claim,
        })
    );
}
