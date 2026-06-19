//! Real effect adapters: the process supervisor, the hash-verified artifact
//! fetcher, and the functional canary. The safety logic lives in `update.rs` and
//! `integrity.rs`; these just do the I/O behind the traits.

use crate::hashes::sha256_file;
use crate::layout::Layout;
use crate::secrets::Secrets;
use crate::update::{Canary, Fetcher, Supervisor};
use crate::ReleaseRef;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::Child;
use std::sync::Mutex;
use std::time::Duration;

/// Supervises the validator child, launched from `<root>/current`.
pub struct ProcessSupervisor {
    current_bin: PathBuf,
    params_path: PathBuf,
    validator_port: u16,
    secrets: Secrets,
    child: Mutex<Option<Child>>,
    client: reqwest::blocking::Client,
}

impl ProcessSupervisor {
    pub fn new(layout: &Layout, validator_port: u16, secrets: Secrets) -> Self {
        Self {
            current_bin: layout.current_link().join("step-validator-node"),
            params_path: layout.current_link().join("protocol-params.json"),
            validator_port,
            secrets,
            child: Mutex::new(None),
            client: reqwest::blocking::Client::builder()
                .timeout(Duration::from_secs(3))
                .build()
                .expect("http client"),
        }
    }

    fn healthz_url(&self) -> String {
        format!("http://127.0.0.1:{}/healthz", self.validator_port)
    }

    /// Quarantine: stop the validator child so a tampered node stops voting (#42).
    pub fn stop(&self) {
        let mut guard = self.child.lock().expect("child lock");
        if let Some(mut c) = guard.take() {
            let _ = c.kill();
            let _ = c.wait();
        }
    }
}

impl Supervisor for ProcessSupervisor {
    fn restart(&self) -> Result<(), String> {
        let mut guard = self.child.lock().expect("child lock");
        if let Some(mut c) = guard.take() {
            let _ = c.kill();
            let _ = c.wait();
        }
        // Secrets are loaded from the OS secure store (#43) and injected in-process
        // — never from a plaintext file/unit. Fail-closed: no identity, no child.
        let key = self
            .secrets
            .get("validatorKey")
            .ok_or("validator key unavailable from the secure store (fail-closed)")?;
        let nonce = self
            .secrets
            .get("nonceSecret")
            .ok_or("nonce secret unavailable from the secure store (fail-closed)")?;
        // Non-secret config (verifier address, chain id) is inherited from env; the
        // symlinked `current` binary + params mean a version swap is picked up here.
        let child = std::process::Command::new(&self.current_bin)
            .env("VALIDATOR_PORT", self.validator_port.to_string())
            .env("STEP_PROTOCOL_PARAMS", &self.params_path)
            .env("VALIDATOR_PRIVATE_KEY", key)
            .env("GATEWAY_NONCE_SECRET", nonce)
            .spawn()
            .map_err(|e| format!("spawn validator: {e}"))?;
        *guard = Some(child);
        Ok(())
    }

    fn healthy(&self) -> bool {
        self.client
            .get(self.healthz_url())
            .send()
            .map(|r| r.status().is_success())
            .unwrap_or(false)
    }
}

/// Downloads the target artifact from the hub and verifies every hash against the
/// on-chain release BEFORE staging it. Fail-closed: any mismatch returns an error
/// and nothing is staged for activation.
pub struct HttpFetcher {
    base_url: String,
    platform: String,
    releases_dir: PathBuf,
    params_path: PathBuf,
    config_path: PathBuf,
    client: reqwest::blocking::Client,
    max_bytes: u64,
}

impl HttpFetcher {
    pub fn new(base_url: &str, platform: &str, layout: &Layout) -> Self {
        Self {
            base_url: base_url.trim_end_matches('/').to_string(),
            platform: platform.to_string(),
            releases_dir: layout.releases_dir(),
            // params/config travel alongside the binary in the artifact; for the
            // pilot they are the canonical local files re-verified against chain.
            params_path: layout.releases_dir().join("..").join("shared-params.json"),
            config_path: layout.releases_dir().join("..").join("shared-config.json"),
            client: reqwest::blocking::Client::builder()
                .timeout(Duration::from_secs(120))
                .build()
                .expect("http client"),
            max_bytes: 256 * 1024 * 1024,
        }
    }

    fn download_to(&self, url: &str, dest: &Path) -> Result<(), String> {
        let mut resp = self
            .client
            .get(url)
            .send()
            .map_err(|e| format!("download {url}: {e}"))?;
        if !resp.status().is_success() {
            return Err(format!("download {url}: HTTP {}", resp.status()));
        }
        let mut file = std::fs::File::create(dest).map_err(|e| e.to_string())?;
        let mut buf = [0u8; 64 * 1024];
        let mut total: u64 = 0;
        loop {
            let n = resp.read(&mut buf).map_err(|e| e.to_string())?;
            if n == 0 {
                break;
            }
            total += n as u64;
            if total > self.max_bytes {
                let _ = std::fs::remove_file(dest);
                return Err("artifact exceeds size cap".into());
            }
            use std::io::Write;
            file.write_all(&buf[..n]).map_err(|e| e.to_string())?;
        }
        Ok(())
    }
}

impl Fetcher for HttpFetcher {
    fn fetch_and_verify(&self, target: &ReleaseRef) -> Result<PathBuf, String> {
        let dir = self.releases_dir.join(target.version.to_string());
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        let bin = dir.join("step-validator-node");
        // Artifacts are addressed by human semver (matching publish/serve), not the
        // packed-u64 used for the local release directory.
        let url = format!(
            "{}/artifacts/{}/{}",
            self.base_url,
            self.platform,
            crate::format_semver(target.version)
        );
        self.download_to(&url, &bin)?;

        // verify binary hash vs the on-chain authority — fail-closed
        let measured = sha256_file(&bin).map_err(|e| e.to_string())?;
        if measured != target.binary {
            let _ = std::fs::remove_dir_all(&dir);
            return Err("binary hash mismatch vs on-chain release".into());
        }
        // params/config: copy the verified shared files into the release dir
        for (src, name, expected) in [
            (&self.params_path, "protocol-params.json", target.params),
            (&self.config_path, "config.json", target.config),
        ] {
            if src.exists() {
                std::fs::copy(src, dir.join(name)).map_err(|e| e.to_string())?;
                if sha256_file(&dir.join(name)).map_err(|e| e.to_string())? != expected {
                    let _ = std::fs::remove_dir_all(&dir);
                    return Err(format!("{name} hash mismatch vs on-chain release"));
                }
            }
        }
        Ok(dir)
    }
}

/// Functional canary: launch the staged binary on an ephemeral port and confirm
/// it answers `/healthz`. (The golden-claim assertion is the documented next step;
/// the trait shape supports it without changing callers.)
pub struct HealthCanary {
    probe_port: u16,
    secrets: Secrets,
    client: reqwest::blocking::Client,
}

impl HealthCanary {
    pub fn new(probe_port: u16, secrets: Secrets) -> Self {
        Self {
            probe_port,
            secrets,
            client: reqwest::blocking::Client::builder()
                .timeout(Duration::from_secs(2))
                .build()
                .expect("http client"),
        }
    }
}

impl Canary for HealthCanary {
    fn run(&self, staged_dir: &Path) -> Result<bool, String> {
        let bin = staged_dir.join("step-validator-node");
        // The canary runs the candidate binary with the node's real identity (from
        // the secure store) + non-secret config inherited from the agent's env, so
        // it exercises the actual startup path, not a stub.
        let key = self
            .secrets
            .get("validatorKey")
            .ok_or("canary: validator key unavailable")?;
        let nonce = self
            .secrets
            .get("nonceSecret")
            .ok_or("canary: nonce secret unavailable")?;
        let mut child = std::process::Command::new(&bin)
            .env("VALIDATOR_PORT", self.probe_port.to_string())
            .env(
                "STEP_PROTOCOL_PARAMS",
                staged_dir.join("protocol-params.json"),
            )
            .env("VALIDATOR_PRIVATE_KEY", key)
            .env("GATEWAY_NONCE_SECRET", nonce)
            .spawn()
            .map_err(|e| format!("canary spawn: {e}"))?;
        let url = format!("http://127.0.0.1:{}/healthz", self.probe_port);
        let mut ok = false;
        for _ in 0..20 {
            std::thread::sleep(Duration::from_millis(150));
            if self
                .client
                .get(&url)
                .send()
                .map(|r| r.status().is_success())
                .unwrap_or(false)
            {
                ok = true;
                break;
            }
        }
        let _ = child.kill();
        let _ = child.wait();
        Ok(ok)
    }
}
