//! Blue/green release layout with **power-loss-safe atomic activation** (#40).
//!
//! ```text
//! <root>/releases/<version>/{step-validator-node, protocol-params.json, config.json}
//! <root>/current -> releases/<version>   (atomic symlink swap: create temp + rename)
//! <root>/state.json                      ({current, last_good, rollback_count})
//! ```
//! `set_current` writes a fresh symlink to a temp name then `rename`s it over
//! `current` — `rename(2)` is atomic, so a crash leaves `current` pointing at
//! either the old or the new release, never a partial state.

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

#[derive(Debug, Default, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct State {
    pub current: Option<u64>,
    pub last_good: Option<u64>,
    #[serde(default)]
    pub rollback_count: u32,
}

pub struct Layout {
    root: PathBuf,
}

impl Layout {
    pub fn new(root: impl Into<PathBuf>) -> std::io::Result<Self> {
        let root = root.into();
        std::fs::create_dir_all(root.join("releases"))?;
        Ok(Self { root })
    }

    pub fn releases_dir(&self) -> PathBuf {
        self.root.join("releases")
    }
    pub fn release_dir(&self, version: u64) -> PathBuf {
        self.releases_dir().join(version.to_string())
    }
    pub fn current_link(&self) -> PathBuf {
        self.root.join("current")
    }
    fn state_path(&self) -> PathBuf {
        self.root.join("state.json")
    }

    pub fn is_staged(&self, version: u64) -> bool {
        self.release_dir(version)
            .join("step-validator-node")
            .exists()
    }

    pub fn load_state(&self) -> State {
        std::fs::read(self.state_path())
            .ok()
            .and_then(|b| serde_json::from_slice(&b).ok())
            .unwrap_or_default()
    }

    pub fn save_state(&self, s: &State) -> std::io::Result<()> {
        // write-then-rename so state.json is never half-written
        let tmp = self.state_path().with_extension("json.tmp");
        std::fs::write(&tmp, serde_json::to_vec_pretty(s).expect("serialize state"))?;
        std::fs::rename(&tmp, self.state_path())
    }

    /// The version `current` points at (from state), if any.
    pub fn current(&self) -> Option<u64> {
        self.load_state().current
    }
    pub fn last_good(&self) -> Option<u64> {
        self.load_state().last_good
    }

    /// Atomically point `current` at a staged release. Does NOT mark it good
    /// (that happens only after the health gate passes).
    pub fn set_current(&self, version: u64) -> std::io::Result<()> {
        if !self.is_staged(version) {
            return Err(std::io::Error::new(
                std::io::ErrorKind::NotFound,
                format!("release {version} is not staged"),
            ));
        }
        let target = self.release_dir(version);
        let tmp = self.root.join(format!(".current.{version}.tmp"));
        let _ = std::fs::remove_file(&tmp);
        symlink(&target, &tmp)?;
        std::fs::rename(&tmp, self.current_link())?; // atomic swap
        let mut s = self.load_state();
        s.current = Some(version);
        self.save_state(&s)
    }

    /// Record the current version as the new last-known-good and reset the
    /// rollback counter (called after a successful health gate).
    pub fn mark_good(&self, version: u64) -> std::io::Result<()> {
        let mut s = self.load_state();
        s.current = Some(version);
        s.last_good = Some(version);
        s.rollback_count = 0;
        self.save_state(&s)
    }

    /// Atomically revert `current` to a prior version and bump the rollback count.
    pub fn rollback_to(&self, version: u64) -> std::io::Result<()> {
        self.set_current(version)?;
        let mut s = self.load_state();
        s.rollback_count = s.rollback_count.saturating_add(1);
        self.save_state(&s)
    }
}

#[cfg(unix)]
fn symlink(target: &Path, link: &Path) -> std::io::Result<()> {
    std::os::unix::fs::symlink(target, link)
}
#[cfg(not(unix))]
fn symlink(_target: &Path, _link: &Path) -> std::io::Result<()> {
    Err(std::io::Error::new(
        std::io::ErrorKind::Unsupported,
        "symlink activation requires a unix host",
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn stage(layout: &Layout, version: u64) {
        let d = layout.release_dir(version);
        std::fs::create_dir_all(&d).unwrap();
        std::fs::write(d.join("step-validator-node"), format!("bin-{version}")).unwrap();
    }

    #[test]
    fn atomic_activation_points_current() {
        let tmp = tempfile::tempdir().unwrap();
        let l = Layout::new(tmp.path()).unwrap();
        stage(&l, 100);
        l.set_current(100).unwrap();
        assert_eq!(l.current(), Some(100));
        assert!(l.current_link().exists());
        assert_eq!(
            std::fs::canonicalize(l.current_link()).unwrap(),
            std::fs::canonicalize(l.release_dir(100)).unwrap()
        );
    }

    #[test]
    fn activating_unstaged_fails() {
        let tmp = tempfile::tempdir().unwrap();
        let l = Layout::new(tmp.path()).unwrap();
        assert!(l.set_current(7).is_err());
    }

    #[test]
    fn swap_between_versions_and_rollback() {
        let tmp = tempfile::tempdir().unwrap();
        let l = Layout::new(tmp.path()).unwrap();
        stage(&l, 100);
        stage(&l, 200);
        l.mark_good(100).unwrap();
        l.set_current(200).unwrap();
        assert_eq!(l.current(), Some(200));
        assert_eq!(l.last_good(), Some(100)); // not yet promoted
        l.rollback_to(100).unwrap();
        assert_eq!(l.current(), Some(100));
        assert_eq!(l.load_state().rollback_count, 1);
    }

    #[test]
    fn state_survives_reload() {
        let tmp = tempfile::tempdir().unwrap();
        {
            let l = Layout::new(tmp.path()).unwrap();
            stage(&l, 5);
            l.mark_good(5).unwrap();
        }
        let l2 = Layout::new(tmp.path()).unwrap();
        assert_eq!(l2.current(), Some(5));
        assert_eq!(l2.last_good(), Some(5));
    }
}
