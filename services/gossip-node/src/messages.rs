//! Authenticated gossip messages (#54).
//!
//! Two message kinds flow on the mesh, mirroring today's gateway path so no new
//! vote format is introduced:
//!   - `ClaimMsg` — a mining claim to validate (anyone can inject one).
//!   - `VoteMsg`  — a validator's signed EIP-712 vote on a claim hash.
//!
//! A `VoteMsg` is authenticated by recovering the signer from the SAME EIP-712
//! digest the on-chain `MiningClaimVerifier` uses; the recovered address must
//! equal the claimed `validator`. So a peer cannot forge a vote for a validator
//! it does not control, and the chain re-verifies everything on submission.

use serde::{Deserialize, Serialize};
use step_validation_rules::sign::{
    campaign_id_word, eip712_vote_digest, format_address, parse_address, recover_address, Address,
};

/// A signed validator vote, wire-compatible with the gateway's `SignedVote`
/// (same hex string fields), so a gossiped quorum bundle submits unchanged.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct VoteMsg {
    /// validator address (0x…20 bytes) — the claimed signer
    pub validator: String,
    /// 65-byte r||s||v signature over the EIP-712 vote digest (0x…)
    pub signature: String,
    /// keccak of the canonical claim message (0x…32 bytes)
    pub claim_hash: String,
    /// on-chain triangle identity (0x…32 bytes)
    pub triangle_id_hash: String,
    /// miner wallet (0x…20 bytes)
    pub miner: String,
    /// approve / reject
    pub approve: bool,
    /// bytes32 campaign id bound into the vote digest (#115): 0x0…0 for a natural
    /// claim, the campaign id for a sponsored one. `#[serde(default)]` tolerates
    /// votes from peers on the old wire format (they only ever voted natural).
    #[serde(default)]
    pub campaign_id_hash: String,
}

impl VoteMsg {
    /// Stable per-message id for dedup/replay: one vote per (validator, claim).
    pub fn id(&self) -> String {
        format!(
            "vote:{}:{}",
            self.validator.to_lowercase(),
            self.claim_hash.to_lowercase()
        )
    }

    /// Recover the signer from the EIP-712 digest and confirm it equals the
    /// claimed `validator`. Returns the lowercased validator address on success,
    /// `None` on any malformed field or mismatch (anti-spoof).
    pub fn verify(&self, chain_id: u64, verifying_contract: &Address) -> Option<Address> {
        let claimed = parse_address(&self.validator)?;
        let claim_hash = parse_b32(&self.claim_hash)?;
        let triangle = parse_b32(&self.triangle_id_hash)?;
        let miner = parse_address(&self.miner)?;
        let sig = parse_hex(&self.signature)?;
        if sig.len() != 65 {
            return None;
        }
        // #115: reconstruct the campaign-bound digest (empty/old field → 0).
        let campaign = campaign_id_word(Some(&self.campaign_id_hash));
        let digest = eip712_vote_digest(
            chain_id,
            verifying_contract,
            &claim_hash,
            &triangle,
            &miner,
            self.approve,
            &campaign,
        );
        let recovered = recover_address(&digest, &sig).ok()?;
        (recovered == claimed).then_some(recovered)
    }

    /// Canonical lowercased validator address, if parseable.
    pub fn validator_address(&self) -> Option<Address> {
        parse_address(&self.validator)
    }
}

/// A claim to validate, gossiped to the mesh. The claim payload is opaque JSON
/// here (the validator's own rules decode + check it); gossip only needs its
/// identity hash for dedup and to key votes.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct ClaimMsg {
    /// keccak of the canonical claim message (0x…32 bytes) — the claim identity
    pub claim_hash: String,
    /// the full claim as JSON (validated locally by each node)
    pub claim: serde_json::Value,
}

impl ClaimMsg {
    pub fn id(&self) -> String {
        format!("claim:{}", self.claim_hash.to_lowercase())
    }
}

/// The envelope actually published on a topic (so one decoder handles a topic).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "t", rename_all = "snake_case")]
pub enum Gossip {
    Claim(ClaimMsg),
    Vote(VoteMsg),
}

impl Gossip {
    pub fn encode(&self) -> Vec<u8> {
        serde_json::to_vec(self).expect("gossip message serializes")
    }
    pub fn decode(bytes: &[u8]) -> Option<Self> {
        serde_json::from_slice(bytes).ok()
    }
    pub fn id(&self) -> String {
        match self {
            Gossip::Claim(c) => c.id(),
            Gossip::Vote(v) => v.id(),
        }
    }
}

pub(crate) fn parse_b32(s: &str) -> Option<[u8; 32]> {
    let b = parse_hex(s)?;
    b.try_into().ok()
}

pub(crate) fn parse_hex(s: &str) -> Option<Vec<u8>> {
    hex::decode(s.strip_prefix("0x").unwrap_or(s)).ok()
}

/// Lowercased 0x-address for display/keys.
pub fn addr_hex(a: &Address) -> String {
    format_address(a)
}

#[cfg(test)]
mod tests {
    use super::*;
    use step_validation_rules::sign::{sign_digest, signer_address};

    fn signed_vote(
        key: &k256::ecdsa::SigningKey,
        chain_id: u64,
        contract: &Address,
        claim_hash: [u8; 32],
        triangle: [u8; 32],
        miner: Address,
        approve: bool,
    ) -> VoteMsg {
        let campaign = [0u8; 32]; // natural vote
        let digest = eip712_vote_digest(
            chain_id,
            contract,
            &claim_hash,
            &triangle,
            &miner,
            approve,
            &campaign,
        );
        let sig = sign_digest(&digest, key);
        VoteMsg {
            validator: format_address(&signer_address(key)),
            signature: format!("0x{}", hex::encode(sig)),
            claim_hash: format!("0x{}", hex::encode(claim_hash)),
            triangle_id_hash: format!("0x{}", hex::encode(triangle)),
            miner: format_address(&miner),
            approve,
            campaign_id_hash: format!("0x{}", hex::encode(campaign)),
        }
    }

    use k256::ecdsa::SigningKey;

    const CHAIN: u64 = 31337;

    fn fixtures() -> (SigningKey, Address, [u8; 32], [u8; 32], Address) {
        let key = SigningKey::from_slice(&[0x42; 32]).unwrap();
        let contract = parse_address("0x610178dA211FEF7D417bC0e6FeD39F05609AD788").unwrap();
        let claim_hash = [0xab; 32];
        let triangle = [0xcd; 32];
        let miner = parse_address("0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266").unwrap();
        (key, contract, claim_hash, triangle, miner)
    }

    #[test]
    fn valid_vote_recovers_to_its_validator() {
        let (key, contract, ch, tri, miner) = fixtures();
        let v = signed_vote(&key, CHAIN, &contract, ch, tri, miner, true);
        assert_eq!(v.verify(CHAIN, &contract), Some(signer_address(&key)));
    }

    #[test]
    fn tampered_approve_fails_verification() {
        let (key, contract, ch, tri, miner) = fixtures();
        let mut v = signed_vote(&key, CHAIN, &contract, ch, tri, miner, true);
        v.approve = false; // signature no longer matches the digest
        assert!(v.verify(CHAIN, &contract).is_none());
    }

    #[test]
    fn spoofed_validator_field_fails() {
        let (key, contract, ch, tri, miner) = fixtures();
        let mut v = signed_vote(&key, CHAIN, &contract, ch, tri, miner, true);
        v.validator = "0x000000000000000000000000000000000000dead".into();
        assert!(v.verify(CHAIN, &contract).is_none());
    }

    #[test]
    fn wrong_chain_id_fails() {
        let (key, contract, ch, tri, miner) = fixtures();
        let v = signed_vote(&key, CHAIN, &contract, ch, tri, miner, true);
        assert!(v.verify(CHAIN + 1, &contract).is_none());
    }

    #[test]
    fn vote_id_is_per_validator_per_claim() {
        let (key, contract, ch, tri, miner) = fixtures();
        let v = signed_vote(&key, CHAIN, &contract, ch, tri, miner, true);
        assert_eq!(
            v.id(),
            format!("vote:{}:{}", v.validator.to_lowercase(), v.claim_hash)
        );
    }

    #[test]
    fn gossip_round_trips_through_encode_decode() {
        let (key, contract, ch, tri, miner) = fixtures();
        let v = signed_vote(&key, CHAIN, &contract, ch, tri, miner, true);
        let g = Gossip::Vote(v.clone());
        let back = Gossip::decode(&g.encode()).unwrap();
        match back {
            Gossip::Vote(v2) => assert_eq!(v2, v),
            _ => panic!("wrong variant"),
        }
    }

    #[test]
    fn malformed_bytes_decode_to_none() {
        assert!(Gossip::decode(b"not json").is_none());
    }
}
