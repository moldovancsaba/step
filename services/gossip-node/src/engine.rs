//! Gossip orchestration (#54) — the pure decision core the libp2p swarm drives.
//!
//! Given a raw inbound gossip message, the engine decides what the node should do
//! WITHOUT touching the network: dedup replays, validate-and-vote on fresh claims,
//! verify+aggregate votes, and emit a submit-bundle the moment a weighted quorum
//! exists. The swarm layer turns the returned `Action`s into publishes / chain
//! submissions. Keeping this pure makes the consensus-adjacent logic fully
//! unit-testable offline (no peers, no chain).

use crate::aggregate::{Bundle, VoteAggregator};
use crate::messages::{ClaimMsg, Gossip, VoteMsg};
use crate::replay::SeenSet;
use std::collections::HashMap;
use step_validation_rules::sign::Address;

/// What the node should do in response to an inbound message.
#[derive(Clone, Debug, PartialEq)]
pub enum Action {
    /// Publish this message to the mesh (e.g. our own vote on a fresh claim).
    Publish(Gossip),
    /// A weighted quorum of approvals exists — submit this bundle to the chain.
    Submit(Bundle),
}

pub struct Engine {
    chain_id: u64,
    verifying_contract: Address,
    quorum_threshold: u128,
    seen: SeenSet,
    agg: VoteAggregator,
    claims: HashMap<String, serde_json::Value>,
}

impl Engine {
    pub fn new(
        chain_id: u64,
        verifying_contract: Address,
        quorum_threshold: u128,
        seen_capacity: usize,
    ) -> Self {
        Self {
            chain_id,
            verifying_contract,
            quorum_threshold,
            seen: SeenSet::new(seen_capacity),
            agg: VoteAggregator::new(),
            claims: HashMap::new(),
        }
    }

    /// Handle one inbound gossip message.
    ///
    /// - `weight_of` returns the on-chain active weight of a validator address.
    /// - `vote_on_claim` runs the node's local validation and returns the node's
    ///   own signed vote on a claim (or `None` if it declines / can't validate).
    ///
    /// Returns the actions the swarm should perform (publish our vote, submit a
    /// bundle). Duplicates, malformed messages, and unverifiable votes yield no
    /// actions.
    pub fn on_gossip(
        &mut self,
        raw: &[u8],
        weight_of: impl Fn(&Address) -> u128,
        vote_on_claim: impl FnOnce(&ClaimMsg) -> Option<VoteMsg>,
    ) -> Vec<Action> {
        let Some(msg) = Gossip::decode(raw) else {
            return vec![]; // malformed
        };
        if !self.seen.observe(&msg.id()) {
            return vec![]; // replay / duplicate flood
        }
        match msg {
            Gossip::Claim(claim) => {
                self.remember_claim(&claim);
                match vote_on_claim(&claim) {
                    Some(my_vote) => self.vote_actions(my_vote, &weight_of),
                    None => vec![],
                }
            }
            Gossip::Vote(vote) => self.ingest_vote(vote, &weight_of),
        }
    }

    /// Remember the full claim payload so a later vote quorum can be submitted
    /// without a central gateway lookup.
    pub fn remember_claim(&mut self, claim: &ClaimMsg) {
        self.claims
            .insert(claim.claim_hash.to_lowercase(), claim.claim.clone());
    }

    /// Decode an inbound message and mark it seen; returns it only if it is fresh
    /// (not a replay). Used by the async swarm loop, which must run validation I/O
    /// between decode and handling.
    pub fn decode_fresh(&mut self, raw: &[u8]) -> Option<Gossip> {
        let msg = Gossip::decode(raw)?;
        self.seen.observe(&msg.id()).then_some(msg)
    }

    /// Actions for OUR freshly-produced vote on a claim: publish it to the mesh,
    /// and fold it into our own aggregator (so a node carrying the last needed
    /// weight can finalise immediately).
    pub fn vote_actions(
        &mut self,
        my_vote: VoteMsg,
        weight_of: impl Fn(&Address) -> u128,
    ) -> Vec<Action> {
        let mut actions = vec![Action::Publish(Gossip::Vote(my_vote.clone()))];
        actions.extend(self.ingest_vote(my_vote, &weight_of));
        actions
    }

    /// Verify a vote, aggregate it, and emit a Submit action if it completes a
    /// weighted quorum. Verification recovers the signer from the EIP-712 digest;
    /// an unverifiable or spoofed vote is dropped.
    pub fn ingest_vote(
        &mut self,
        vote: VoteMsg,
        weight_of: &impl Fn(&Address) -> u128,
    ) -> Vec<Action> {
        if vote
            .verify(self.chain_id, &self.verifying_contract)
            .is_none()
        {
            return vec![]; // bad signature / spoofed validator
        }
        let claim_hash = vote.claim_hash.clone();
        self.agg.insert(vote);
        match self
            .agg
            .try_bundle(&claim_hash, self.quorum_threshold, weight_of)
        {
            Some(mut bundle) => {
                let Some(claim) = self.claims.get(&claim_hash.to_lowercase()).cloned() else {
                    // We have votes but not the original claim yet. Keep the
                    // votes; when the claim arrives, vote_actions() will try
                    // bundling again with the payload available.
                    return vec![];
                };
                bundle.claim = claim;
                self.agg.forget(&claim_hash);
                self.claims.remove(&claim_hash.to_lowercase());
                vec![Action::Submit(bundle)]
            }
            None => vec![],
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::messages::Gossip;
    use k256::ecdsa::SigningKey;
    use step_validation_rules::sign::{
        eip712_vote_digest, format_address, parse_address, sign_digest, signer_address,
    };

    const CHAIN: u64 = 31337;
    const CH: [u8; 32] = [0xab; 32];
    const TRI: [u8; 32] = [0xcd; 32];

    fn contract() -> Address {
        parse_address("0x610178dA211FEF7D417bC0e6FeD39F05609AD788").unwrap()
    }
    fn miner() -> Address {
        parse_address("0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266").unwrap()
    }

    fn vote_from(key: &SigningKey, approve: bool) -> VoteMsg {
        let c = contract();
        let digest = eip712_vote_digest(CHAIN, &c, &CH, &TRI, &miner(), approve);
        VoteMsg {
            validator: format_address(&signer_address(key)),
            signature: format!("0x{}", hex::encode(sign_digest(&digest, key))),
            claim_hash: format!("0x{}", hex::encode(CH)),
            triangle_id_hash: format!("0x{}", hex::encode(TRI)),
            miner: format_address(&miner()),
            approve,
        }
    }

    fn engine(threshold: u128) -> Engine {
        Engine::new(CHAIN, contract(), threshold, 256)
    }

    #[test]
    fn duplicate_message_is_dropped() {
        let mut e = engine(1000);
        let k = SigningKey::from_slice(&[7; 32]).unwrap();
        let raw = Gossip::Vote(vote_from(&k, true)).encode();
        assert_eq!(e.on_gossip(&raw, |_| 50, |_| None).len(), 0); // ingested, no quorum
        assert_eq!(e.on_gossip(&raw, |_| 50, |_| None).len(), 0); // duplicate, dropped
    }

    #[test]
    fn malformed_message_yields_no_action() {
        let mut e = engine(1);
        assert!(e.on_gossip(b"garbage", |_| 50, |_| None).is_empty());
    }

    #[test]
    fn spoofed_vote_is_not_aggregated() {
        let mut e = engine(1);
        let k = SigningKey::from_slice(&[7; 32]).unwrap();
        let mut v = vote_from(&k, true);
        v.approve = false; // breaks the signature vs digest
        let raw = Gossip::Vote(v).encode();
        assert!(e.on_gossip(&raw, |_| 50, |_| None).is_empty());
    }

    #[test]
    fn votes_accrue_until_quorum_then_submit() {
        let mut e = engine(100);
        let k1 = SigningKey::from_slice(&[7; 32]).unwrap();
        let k2 = SigningKey::from_slice(&[9; 32]).unwrap();
        let r1 = e.on_gossip(
            &Gossip::Vote(vote_from(&k1, true)).encode(),
            |_| 50,
            |_| None,
        );
        assert!(r1.is_empty()); // 50 < 100
        let r2 = e.on_gossip(
            &Gossip::Vote(vote_from(&k2, true)).encode(),
            |_| 50,
            |_| None,
        );
        assert_eq!(r2.len(), 1);
        match &r2[0] {
            Action::Submit(b) => {
                assert_eq!(b.total_weight, 100);
                assert_eq!(b.approvals.len(), 2);
            }
            _ => panic!("expected Submit"),
        }
    }

    #[test]
    fn fresh_claim_publishes_our_vote() {
        let mut e = engine(1_000_000); // high threshold ⇒ no submit from one vote
        let k = SigningKey::from_slice(&[7; 32]).unwrap();
        let claim = ClaimMsg {
            claim_hash: format!("0x{}", hex::encode(CH)),
            claim: serde_json::json!({"x": 1}),
        };
        let raw = Gossip::Claim(claim).encode();
        let actions = e.on_gossip(&raw, |_| 50, |_| Some(vote_from(&k, true)));
        assert_eq!(actions.len(), 1);
        match &actions[0] {
            Action::Publish(Gossip::Vote(v)) => {
                assert_eq!(v.validator, format_address(&signer_address(&k)))
            }
            _ => panic!("expected Publish(Vote)"),
        }
    }

    #[test]
    fn claim_we_decline_produces_nothing() {
        let mut e = engine(1);
        let claim = ClaimMsg {
            claim_hash: format!("0x{}", hex::encode(CH)),
            claim: serde_json::json!({}),
        };
        let raw = Gossip::Claim(claim).encode();
        assert!(e.on_gossip(&raw, |_| 50, |_| None).is_empty());
    }

    #[test]
    fn a_single_node_holding_full_weight_finalises_its_own_claim() {
        // node validates the claim, votes, and that vote alone meets quorum.
        let mut e = engine(50);
        let k = SigningKey::from_slice(&[7; 32]).unwrap();
        let claim = ClaimMsg {
            claim_hash: format!("0x{}", hex::encode(CH)),
            claim: serde_json::json!({}),
        };
        let actions = e.on_gossip(
            &Gossip::Claim(claim).encode(),
            |_| 50,
            |_| Some(vote_from(&k, true)),
        );
        // publish our vote AND submit the finalising bundle
        assert!(actions.iter().any(|a| matches!(a, Action::Publish(_))));
        assert!(actions.iter().any(|a| matches!(a, Action::Submit(_))));
    }
}
