//! Update + **failsafe rollback** state machine (#41).
//!
//! Drives: fetch+verify → functional canary → atomic activate → health-gate →
//! auto-rollback to last-good on any failure. It is generic over three effects
//! ([`Fetcher`], [`Canary`], [`Supervisor`]) so the safety logic is unit-tested
//! deterministically with mocks; the real adapters do HTTP/process work.
//!
//! Fail-closed: a fetch hash-mismatch or a failed canary NEVER activates. A new
//! version that fails the health gate is automatically reverted to last-good. A
//! repeated rollback loop trips a circuit-breaker that pins `current` and stops
//! auto-updating until an operator intervenes.

use crate::layout::Layout;
use crate::{format_semver, ReleaseRef};
use std::path::{Path, PathBuf};

/// Downloads the artifact and verifies its hashes against the on-chain release.
/// Returns the path to a staged release directory, or an error (fail-closed).
pub trait Fetcher {
    fn fetch_and_verify(&self, target: &ReleaseRef) -> Result<PathBuf, String>;
}

/// Runs the staged binary against a golden claim and returns whether it produced
/// the correct, signed verdict (functional canary — not just `/healthz`).
pub trait Canary {
    fn run(&self, staged_dir: &Path) -> Result<bool, String>;
}

/// Controls the running validator child.
pub trait Supervisor {
    fn restart(&self) -> Result<(), String>;
    fn healthy(&self) -> bool;
}

#[derive(Debug, PartialEq, Eq)]
pub enum Outcome {
    UpToDate,
    Activated { from: Option<u64>, to: u64 },
    RolledBack { from: u64, to: u64, reason: String },
    Aborted { reason: String },
    CircuitOpen { reason: String },
}

/// Max consecutive auto-rollbacks before the circuit-breaker pins `current`.
pub const ROLLBACK_CIRCUIT_LIMIT: u32 = 2;

/// Perform one update toward `target`. `health_attempts` is how many times the
/// health gate polls `supervisor.healthy()` after a restart; `tick` is invoked
/// between polls (a sleep in production, a no-op in tests).
pub fn perform_update<F, C, S>(
    layout: &Layout,
    target: &ReleaseRef,
    fetcher: &F,
    canary: &C,
    supervisor: &S,
    health_attempts: u32,
    mut tick: impl FnMut(),
) -> Outcome
where
    F: Fetcher,
    C: Canary,
    S: Supervisor,
{
    let current = layout.current();
    if current == Some(target.version) {
        return Outcome::UpToDate;
    }

    if layout.load_state().rollback_count >= ROLLBACK_CIRCUIT_LIMIT {
        return Outcome::CircuitOpen {
            reason: format!(
                "rollback circuit-breaker open ({} consecutive); auto-update paused, current pinned",
                layout.load_state().rollback_count
            ),
        };
    }

    // 1. fetch + verify against the on-chain hash (fail-closed on mismatch)
    let staged = match fetcher.fetch_and_verify(target) {
        Ok(p) => p,
        Err(e) => {
            return Outcome::Aborted {
                reason: format!("fetch/verify failed: {e}"),
            }
        }
    };
    if !layout.is_staged(target.version) {
        // adapters stage into the layout; if a custom fetcher returned an external
        // path, require it to already match the staged location.
        if staged != layout.release_dir(target.version) {
            return Outcome::Aborted {
                reason: "fetched artifact not staged into the release layout".into(),
            };
        }
    }

    // 2. functional canary
    match canary.run(&layout.release_dir(target.version)) {
        Ok(true) => {}
        Ok(false) => {
            return Outcome::Aborted {
                reason: format!("canary rejected {}", format_semver(target.version)),
            }
        }
        Err(e) => {
            return Outcome::Aborted {
                reason: format!("canary error: {e}"),
            }
        }
    }

    // 3. atomic activate + restart
    if let Err(e) = layout.set_current(target.version) {
        return Outcome::Aborted {
            reason: format!("activate failed: {e}"),
        };
    }
    if let Err(e) = supervisor.restart() {
        return rollback(
            layout,
            supervisor,
            current,
            target.version,
            format!("restart failed: {e}"),
        );
    }

    // 4. health gate
    for _ in 0..health_attempts.max(1) {
        if supervisor.healthy() {
            let _ = layout.mark_good(target.version);
            return Outcome::Activated {
                from: current,
                to: target.version,
            };
        }
        tick();
    }

    rollback(
        layout,
        supervisor,
        current,
        target.version,
        format!(
            "{} unhealthy within the watch window",
            format_semver(target.version)
        ),
    )
}

fn rollback<S: Supervisor>(
    layout: &Layout,
    supervisor: &S,
    prev: Option<u64>,
    failed: u64,
    reason: String,
) -> Outcome {
    let target = layout.last_good().or(prev);
    match target {
        Some(good) if layout.is_staged(good) => {
            let _ = layout.rollback_to(good);
            let _ = supervisor.restart();
            Outcome::RolledBack {
                from: failed,
                to: good,
                reason,
            }
        }
        _ => Outcome::CircuitOpen {
            reason: format!("{reason}; no staged last-good to roll back to — node held"),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::Cell;

    fn rel(v: u64) -> ReleaseRef {
        ReleaseRef {
            version: v,
            binary: [v as u8; 32],
            params: [2; 32],
            config: [3; 32],
            package: [4; 32],
            manifest: [5; 32],
            chunk_root: [6; 32],
            package_size: 7,
        }
    }

    /// Fetcher that stages a fake artifact into the layout (or fails closed).
    struct StagingFetcher {
        root: PathBuf,
        fail: bool,
    }
    impl Fetcher for StagingFetcher {
        fn fetch_and_verify(&self, target: &ReleaseRef) -> Result<PathBuf, String> {
            if self.fail {
                return Err("hash mismatch".into());
            }
            let dir = self.root.join("releases").join(target.version.to_string());
            std::fs::create_dir_all(&dir).unwrap();
            std::fs::write(
                dir.join("step-validator-node"),
                format!("bin-{}", target.version),
            )
            .unwrap();
            Ok(dir)
        }
    }

    struct CanaryMock {
        pass: bool,
    }
    impl Canary for CanaryMock {
        fn run(&self, _d: &Path) -> Result<bool, String> {
            Ok(self.pass)
        }
    }

    /// Reports unhealthy until `healthy_after` calls have elapsed; never healthy
    /// when `healthy_after` is `None`.
    struct SupervisorMock {
        healthy_after: Option<u32>,
        calls: Cell<u32>,
    }
    impl Supervisor for SupervisorMock {
        fn restart(&self) -> Result<(), String> {
            Ok(())
        }
        fn healthy(&self) -> bool {
            let c = self.calls.get();
            self.calls.set(c + 1);
            matches!(self.healthy_after, Some(after) if c >= after)
        }
    }

    fn sup(healthy_after: Option<u32>) -> SupervisorMock {
        SupervisorMock {
            healthy_after,
            calls: Cell::new(0),
        }
    }

    fn seed_good(l: &Layout, v: u64) {
        let dir = l.release_dir(v);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("step-validator-node"), format!("bin-{v}")).unwrap();
        l.mark_good(v).unwrap();
    }

    fn run(
        l: &Layout,
        root: &Path,
        to: u64,
        fail: bool,
        canary: bool,
        healthy_after: Option<u32>,
    ) -> Outcome {
        perform_update(
            l,
            &rel(to),
            &StagingFetcher {
                root: root.to_path_buf(),
                fail,
            },
            &CanaryMock { pass: canary },
            &sup(healthy_after),
            3,
            || {},
        )
    }

    #[test]
    fn happy_path_activates() {
        let tmp = tempfile::tempdir().unwrap();
        let l = Layout::new(tmp.path()).unwrap();
        let o = run(&l, tmp.path(), 200, false, true, Some(0));
        assert_eq!(
            o,
            Outcome::Activated {
                from: None,
                to: 200
            }
        );
        assert_eq!(l.current(), Some(200));
        assert_eq!(l.last_good(), Some(200));
    }

    #[test]
    fn hash_mismatch_aborts_without_activation() {
        let tmp = tempfile::tempdir().unwrap();
        let l = Layout::new(tmp.path()).unwrap();
        seed_good(&l, 100);
        let o = run(&l, tmp.path(), 200, true, true, Some(0));
        assert!(matches!(o, Outcome::Aborted { .. }));
        assert_eq!(l.current(), Some(100)); // unchanged
    }

    #[test]
    fn canary_failure_aborts() {
        let tmp = tempfile::tempdir().unwrap();
        let l = Layout::new(tmp.path()).unwrap();
        seed_good(&l, 100);
        let o = run(&l, tmp.path(), 200, false, false, Some(0));
        assert!(matches!(o, Outcome::Aborted { .. }));
        assert_eq!(l.current(), Some(100));
    }

    #[test]
    fn unhealthy_new_version_auto_rolls_back() {
        let tmp = tempfile::tempdir().unwrap();
        let l = Layout::new(tmp.path()).unwrap();
        seed_good(&l, 100);
        let o = run(&l, tmp.path(), 200, false, true, None); // never healthy
        assert!(matches!(
            o,
            Outcome::RolledBack {
                from: 200,
                to: 100,
                ..
            }
        ));
        assert_eq!(l.current(), Some(100));
        assert_eq!(l.load_state().rollback_count, 1);
    }

    #[test]
    fn circuit_breaker_opens_after_repeated_rollback() {
        let tmp = tempfile::tempdir().unwrap();
        let l = Layout::new(tmp.path()).unwrap();
        seed_good(&l, 100);
        let mut s = l.load_state();
        s.rollback_count = ROLLBACK_CIRCUIT_LIMIT;
        l.save_state(&s).unwrap();
        let o = run(&l, tmp.path(), 200, false, true, Some(0));
        assert!(matches!(o, Outcome::CircuitOpen { .. }));
        assert_eq!(l.current(), Some(100)); // pinned
    }

    #[test]
    fn up_to_date_is_noop() {
        let tmp = tempfile::tempdir().unwrap();
        let l = Layout::new(tmp.path()).unwrap();
        seed_good(&l, 200);
        let o = run(&l, tmp.path(), 200, false, true, Some(0));
        assert_eq!(o, Outcome::UpToDate);
    }
}
