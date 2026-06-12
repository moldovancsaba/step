//! Prometheus text-exposition metrics (DEV §9.1) — dependency-free counters.

use std::sync::atomic::{AtomicU64, Ordering};

#[derive(Default)]
pub struct Metrics {
    pub claims_total: AtomicU64,
    pub approved_total: AtomicU64,
    pub rejected_total: AtomicU64,
    pub rate_limited_total: AtomicU64,
    pub nonce_replay_total: AtomicU64,
}

impl Metrics {
    pub fn render(&self) -> String {
        let g = |c: &AtomicU64| c.load(Ordering::Relaxed);
        format!(
            "# HELP step_validator_claims_total Claims received\n\
             # TYPE step_validator_claims_total counter\n\
             step_validator_claims_total {}\n\
             # HELP step_validator_approved_total Claims approved\n\
             # TYPE step_validator_approved_total counter\n\
             step_validator_approved_total {}\n\
             # HELP step_validator_rejected_total Claims rejected\n\
             # TYPE step_validator_rejected_total counter\n\
             step_validator_rejected_total {}\n\
             # HELP step_validator_rate_limited_total Claims dropped by wallet rate limit\n\
             # TYPE step_validator_rate_limited_total counter\n\
             step_validator_rate_limited_total {}\n\
             # HELP step_validator_nonce_replay_total Nonce reuse attempts\n\
             # TYPE step_validator_nonce_replay_total counter\n\
             step_validator_nonce_replay_total {}\n",
            g(&self.claims_total),
            g(&self.approved_total),
            g(&self.rejected_total),
            g(&self.rate_limited_total),
            g(&self.nonce_replay_total),
        )
    }
}
