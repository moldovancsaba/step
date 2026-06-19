//! Continuous self-integrity (#42).
//!
//! On start and on a timer the agent re-measures the running release and compares
//! it to the on-chain authorized hashes. A mismatch (manual modification) is a
//! tamper event: the node quarantines (stops voting) and the finding is reported
//! to the hub, which submits it on-chain (auto-suspending the node from quorum).
//! Fail-closed: if the authorized hashes can't be read, treat as suspect.

use crate::{Measurement, ReleaseRef};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Verdict {
    /// Measured artifacts match the authorized release.
    Ok,
    /// An artifact diverged — tamper. Carries the diverging field.
    Tampered { field: &'static str },
    /// Could not establish the authorized baseline (e.g. chain unreadable).
    /// Fail-closed: the caller must NOT treat this as healthy.
    Indeterminate { reason: String },
}

/// Compare a measurement against the authorized release for the running version.
/// `expected` is `None` when the baseline could not be read (fail-closed).
pub fn evaluate(measured: &Measurement, expected: Option<&ReleaseRef>) -> Verdict {
    match expected {
        None => Verdict::Indeterminate {
            reason: "authorized release hashes unavailable (chain unreadable)".into(),
        },
        Some(r) => match measured.first_mismatch(r) {
            None => Verdict::Ok,
            Some(field) => Verdict::Tampered { field },
        },
    }
}

impl Verdict {
    pub fn is_ok(&self) -> bool {
        matches!(self, Verdict::Ok)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rel() -> ReleaseRef {
        ReleaseRef {
            version: 1,
            binary: [1; 32],
            params: [2; 32],
            config: [3; 32],
        }
    }

    #[test]
    fn clean_measurement_is_ok() {
        let m = Measurement {
            binary: [1; 32],
            params: [2; 32],
            config: [3; 32],
        };
        assert_eq!(evaluate(&m, Some(&rel())), Verdict::Ok);
    }

    #[test]
    fn modified_binary_is_tampered() {
        let m = Measurement {
            binary: [9; 32],
            params: [2; 32],
            config: [3; 32],
        };
        assert_eq!(
            evaluate(&m, Some(&rel())),
            Verdict::Tampered { field: "binary" }
        );
    }

    #[test]
    fn modified_params_is_tampered() {
        let m = Measurement {
            binary: [1; 32],
            params: [9; 32],
            config: [3; 32],
        };
        assert_eq!(
            evaluate(&m, Some(&rel())),
            Verdict::Tampered { field: "params" }
        );
    }

    #[test]
    fn missing_baseline_is_indeterminate_not_ok() {
        let m = Measurement {
            binary: [1; 32],
            params: [2; 32],
            config: [3; 32],
        };
        let v = evaluate(&m, None);
        assert!(matches!(v, Verdict::Indeterminate { .. }));
        assert!(!v.is_ok()); // fail-closed: never treated as healthy
    }
}
