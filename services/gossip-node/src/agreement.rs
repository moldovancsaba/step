//! Trust-minimised multi-endpoint reads (#50).
//!
//! A single chain RPC endpoint is a single point of trust: a faulty or malicious
//! node can lie about state (e.g. a validator's weight) and skew quorum. Toward a
//! shared/replicated ledger, a node reads the SAME call from several independent
//! endpoints and only accepts a value that a quorum of them agree on. A lone
//! divergent endpoint is outvoted and flagged, not trusted.
//!
//! This is the read-side trust-minimisation slice; the full replicated-ledger
//! migration (multiple consensus nodes replacing the single devchain) is tracked
//! separately. Pure and unit-tested.

use std::collections::HashMap;

/// Outcome of agreeing N endpoint responses.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Agreement<T> {
    /// `min_agree` endpoints returned the same value.
    Agreed(T),
    /// No value reached `min_agree` (endpoints disagree or too many failed).
    NoQuorum,
    /// At least one responding endpoint disagreed with the agreed value — the
    /// caller should log/alert this as a possibly-divergent or malicious node.
    AgreedWithDissent { value: T, dissent: usize },
}

/// Agree a set of endpoint responses. `responses` are `Some(value)` for endpoints
/// that answered and `None` for those that failed/timed out. A value is accepted
/// only if at least `min_agree` endpoints returned it. When accepted, any
/// responding endpoint holding a DIFFERENT value is counted as dissent (a signal
/// that endpoint may be lying or lagging).
pub fn agree<T: Clone + Eq + std::hash::Hash>(
    responses: &[Option<T>],
    min_agree: usize,
) -> Agreement<T> {
    let min_agree = min_agree.max(1);
    let mut counts: HashMap<&T, usize> = HashMap::new();
    let mut responded = 0usize;
    for r in responses.iter().flatten() {
        *counts.entry(r).or_insert(0) += 1;
        responded += 1;
    }
    // Pick the most-agreed value (ties broken deterministically by value order is
    // unnecessary here — any value meeting the threshold is authoritative).
    let best = counts.iter().max_by_key(|(_, &c)| c);
    match best {
        Some((&value, &count)) if count >= min_agree => {
            let dissent = responded - count;
            if dissent > 0 {
                Agreement::AgreedWithDissent {
                    value: value.clone(),
                    dissent,
                }
            } else {
                Agreement::Agreed(value.clone())
            }
        }
        _ => Agreement::NoQuorum,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unanimous_is_agreed() {
        let r = vec![Some(50u128), Some(50), Some(50)];
        assert_eq!(agree(&r, 2), Agreement::Agreed(50));
    }

    #[test]
    fn majority_with_one_liar_flags_dissent() {
        let r = vec![Some(50u128), Some(50), Some(9999)];
        assert_eq!(
            agree(&r, 2),
            Agreement::AgreedWithDissent {
                value: 50,
                dissent: 1
            }
        );
    }

    #[test]
    fn no_quorum_when_split() {
        let r = vec![Some(1u128), Some(2), Some(3)];
        assert_eq!(agree(&r, 2), Agreement::NoQuorum);
    }

    #[test]
    fn failed_endpoints_do_not_count() {
        let r = vec![Some(50u128), None, None];
        assert_eq!(agree(&r, 2), Agreement::NoQuorum); // only 1 responded
    }

    #[test]
    fn agreement_survives_some_failures() {
        let r = vec![Some(50u128), Some(50), None];
        assert_eq!(agree(&r, 2), Agreement::Agreed(50));
    }

    #[test]
    fn empty_is_no_quorum() {
        let r: Vec<Option<u128>> = vec![];
        assert_eq!(agree(&r, 1), Agreement::NoQuorum);
    }
}
