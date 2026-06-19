//! STEP trust-center node-agent (#40-#43).
//!
//! Supervises the validator on a trust center: polls the on-chain ReleaseRegistry
//! for its authorized target version, downloads+verifies the artifact against the
//! chain hash, runs a functional canary, activates atomically, and **rolls back to
//! the last-known-good version on any failure**. It also continuously re-measures
//! the running code and quarantines itself on tampering.
//!
//! The safety-critical core (layout, update/rollback state machine, integrity) is
//! transport-agnostic and unit-tested with mocks; real chain/HTTP adapters wire it.

pub mod chain;
pub mod config;
pub mod hashes;
pub mod integrity;
pub mod layout;
pub mod supervisor;
pub mod update;

/// sha256 digest.
pub type Hash = [u8; 32];

/// An authorized release as read from ReleaseRegistry (the trust anchor).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ReleaseRef {
    pub version: u64, // packed semver (major<<32)|(minor<<16)|patch
    pub binary: Hash,
    pub params: Hash,
    pub config: Hash,
}

/// Hashes measured from the files a node is actually running.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Measurement {
    pub binary: Hash,
    pub params: Hash,
    pub config: Hash,
}

impl Measurement {
    /// True iff every measured artifact matches the authorized release.
    pub fn matches(&self, r: &ReleaseRef) -> bool {
        self.binary == r.binary && self.params == r.params && self.config == r.config
    }

    /// The first artifact that diverges from the authorized release, if any.
    pub fn first_mismatch(&self, r: &ReleaseRef) -> Option<&'static str> {
        if self.binary != r.binary {
            Some("binary")
        } else if self.params != r.params {
            Some("params")
        } else if self.config != r.config {
            Some("config")
        } else {
            None
        }
    }
}

/// Render a packed-semver `u64` as `major.minor.patch`.
pub fn format_semver(v: u64) -> String {
    let major = (v >> 32) & 0xffff_ffff;
    let minor = (v >> 16) & 0xffff;
    let patch = v & 0xffff;
    format!("{major}.{minor}.{patch}")
}

/// Parse `major.minor.patch` into packed semver.
pub fn parse_semver(s: &str) -> Option<u64> {
    let mut it = s.split('.');
    let major: u64 = it.next()?.parse().ok()?;
    let minor: u64 = it.next()?.parse().ok()?;
    let patch: u64 = it.next()?.parse().ok()?;
    if it.next().is_some() || minor > 0xffff || patch > 0xffff || major > 0xffff_ffff {
        return None;
    }
    Some((major << 32) | (minor << 16) | patch)
}

#[cfg(test)]
mod semver_tests {
    use super::*;

    #[test]
    fn semver_roundtrip() {
        let v = (1u64 << 32) | (2 << 16) | 3;
        assert_eq!(format_semver(v), "1.2.3");
        assert_eq!(parse_semver("1.2.3"), Some(v));
    }

    #[test]
    fn semver_rejects_garbage() {
        assert_eq!(parse_semver("1.2"), None);
        assert_eq!(parse_semver("1.2.3.4"), None);
        assert_eq!(parse_semver("x.y.z"), None);
    }

    #[test]
    fn measurement_match_and_mismatch() {
        let r = ReleaseRef {
            version: 1,
            binary: [1; 32],
            params: [2; 32],
            config: [3; 32],
        };
        let ok = Measurement {
            binary: [1; 32],
            params: [2; 32],
            config: [3; 32],
        };
        assert!(ok.matches(&r));
        assert_eq!(ok.first_mismatch(&r), None);
        let bad = Measurement {
            binary: [9; 32],
            params: [2; 32],
            config: [3; 32],
        };
        assert!(!bad.matches(&r));
        assert_eq!(bad.first_mismatch(&r), Some("binary"));
    }
}
