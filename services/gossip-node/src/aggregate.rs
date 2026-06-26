//! Peer-side weighted-quorum assembly (#54).
//!
//! Any node collects gossiped votes per claim and, using the on-chain validator
//! weights, decides when a weighted quorum of APPROVALS exists — then emits a
//! bundle ready to submit to the shared chain. This is the gateway's
//! `aggregateQuorum` logic moved into every node, so finalisation needs no
//! central coordinator. Pure and fully unit-tested; weights are injected (read
//! from `ValidatorRegistry.activeWeight` by the caller), keeping this
//! deterministic and offline-testable.

use crate::messages::VoteMsg;
use std::collections::HashMap;
use step_validation_rules::sign::{parse_address, Address};

/// Accumulates verified votes keyed by claim hash. Only signature-verified votes
/// should be inserted (see `VoteMsg::verify`).
#[derive(Default)]
pub struct VoteAggregator {
    /// claim_hash(lower) → (validator(lower) → vote). Last vote per validator wins.
    by_claim: HashMap<String, HashMap<String, VoteMsg>>,
}

/// A quorum bundle ready for on-chain submission.
#[derive(Clone, Debug, PartialEq)]
pub struct Bundle {
    pub claim_hash: String,
    /// Full claim payload. Required for finalisation because the contract call
    /// needs the triangle id / level and evidence storage needs the original
    /// proof object; votes alone are not enough.
    pub claim: serde_json::Value,
    pub total_weight: u128,
    /// Approving votes sorted by validator address ascending — the exact order
    /// `MiningClaimVerifier` expects (cheap on-chain dedup).
    pub approvals: Vec<VoteMsg>,
}

impl VoteAggregator {
    pub fn new() -> Self {
        Self::default()
    }

    /// Insert a vote (idempotent per validator+claim; a later vote replaces an
    /// earlier one from the same validator). Returns true if this changed state.
    pub fn insert(&mut self, vote: VoteMsg) -> bool {
        let ch = vote.claim_hash.to_lowercase();
        let val = vote.validator.to_lowercase();
        let slot = self.by_claim.entry(ch).or_default();
        match slot.get(&val) {
            Some(existing) if existing == &vote => false,
            _ => {
                slot.insert(val, vote);
                true
            }
        }
    }

    /// Number of distinct validators that have voted on a claim (any direction).
    pub fn voter_count(&self, claim_hash: &str) -> usize {
        self.by_claim
            .get(&claim_hash.to_lowercase())
            .map(HashMap::len)
            .unwrap_or(0)
    }

    /// Try to assemble an approving weighted-quorum bundle for `claim_hash`.
    /// `weight_of` returns the on-chain active weight for a validator (0 ⇒ not in
    /// quorum, e.g. tamper-suspended). Returns `None` until the summed weight of
    /// approvals reaches `threshold`.
    pub fn try_bundle(
        &self,
        claim_hash: &str,
        threshold: u128,
        weight_of: impl Fn(&Address) -> u128,
    ) -> Option<Bundle> {
        let ch = claim_hash.to_lowercase();
        let votes = self.by_claim.get(&ch)?;

        // Keep only approvals from validators that still carry weight.
        let mut approvals: Vec<(Address, VoteMsg)> = votes
            .values()
            .filter(|v| v.approve)
            .filter_map(|v| parse_address(&v.validator).map(|a| (a, v.clone())))
            .filter(|(a, _)| weight_of(a) > 0)
            .collect();

        // Deterministic on-chain order: validator address ascending.
        approvals.sort_by_key(|(a, _)| *a);

        let total: u128 = approvals.iter().map(|(a, _)| weight_of(a)).sum();
        if total < threshold {
            return None;
        }
        Some(Bundle {
            claim_hash: ch,
            claim: serde_json::Value::Null,
            total_weight: total,
            approvals: approvals.into_iter().map(|(_, v)| v).collect(),
        })
    }

    /// Drop all state for a finalised claim (after a successful submit) so memory
    /// stays bounded by the in-flight claim set.
    pub fn forget(&mut self, claim_hash: &str) {
        self.by_claim.remove(&claim_hash.to_lowercase());
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn vote(validator: &str, claim: &str, approve: bool) -> VoteMsg {
        VoteMsg {
            validator: validator.into(),
            signature: "0x00".into(),
            claim_hash: claim.into(),
            triangle_id_hash: "0xcd".into(),
            miner: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266".into(),
            approve,
        }
    }

    // three validators with addresses that sort a < b < c
    const A: &str = "0x1111111111111111111111111111111111111111";
    const B: &str = "0x2222222222222222222222222222222222222222";
    const C: &str = "0x3333333333333333333333333333333333333333";
    const CH: &str = "0xabababababababababababababababababababababababababababababababab01";

    fn flat(_: &Address) -> u128 {
        50
    }

    #[test]
    fn no_bundle_below_threshold() {
        let mut agg = VoteAggregator::new();
        agg.insert(vote(A, CH, true));
        assert!(agg.try_bundle(CH, 100, flat).is_none()); // 50 < 100
    }

    #[test]
    fn bundle_when_weighted_quorum_reached() {
        let mut agg = VoteAggregator::new();
        agg.insert(vote(A, CH, true));
        agg.insert(vote(B, CH, true));
        let b = agg.try_bundle(CH, 100, flat).expect("quorum");
        assert_eq!(b.total_weight, 100);
        assert_eq!(b.approvals.len(), 2);
    }

    #[test]
    fn approvals_are_sorted_by_validator_ascending() {
        let mut agg = VoteAggregator::new();
        agg.insert(vote(C, CH, true));
        agg.insert(vote(A, CH, true));
        agg.insert(vote(B, CH, true));
        let b = agg.try_bundle(CH, 0, flat).unwrap();
        let order: Vec<String> = b
            .approvals
            .iter()
            .map(|v| v.validator.to_lowercase())
            .collect();
        assert_eq!(
            order,
            vec![A.to_lowercase(), B.to_lowercase(), C.to_lowercase()]
        );
    }

    #[test]
    fn rejections_do_not_count() {
        let mut agg = VoteAggregator::new();
        agg.insert(vote(A, CH, true));
        agg.insert(vote(B, CH, false)); // reject
        assert!(agg.try_bundle(CH, 100, flat).is_none()); // only 50 approving
    }

    #[test]
    fn zero_weight_validator_excluded() {
        let mut agg = VoteAggregator::new();
        agg.insert(vote(A, CH, true));
        agg.insert(vote(B, CH, true));
        // B is suspended (weight 0)
        let wf = |a: &Address| {
            if *a == parse_address(B).unwrap() {
                0
            } else {
                50
            }
        };
        assert!(agg.try_bundle(CH, 100, wf).is_none()); // only A's 50 counts
    }

    #[test]
    fn duplicate_validator_collapses_last_wins() {
        let mut agg = VoteAggregator::new();
        assert!(agg.insert(vote(A, CH, true)));
        assert!(!agg.insert(vote(A, CH, true))); // identical ⇒ no change
        assert!(agg.insert(vote(A, CH, false))); // flip ⇒ changed
        assert_eq!(agg.voter_count(CH), 1);
        assert!(agg.try_bundle(CH, 1, flat).is_none()); // now a rejection
    }

    #[test]
    fn forget_clears_claim_state() {
        let mut agg = VoteAggregator::new();
        agg.insert(vote(A, CH, true));
        agg.forget(CH);
        assert_eq!(agg.voter_count(CH), 0);
    }
}
