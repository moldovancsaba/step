//! Real effect adapters: the process supervisor, the hash-verified artifact
//! fetcher, and the functional canary. The safety logic lives in `update.rs` and
//! `integrity.rs`; these just do the I/O behind the traits.

use crate::hashes::sha256_file;
use crate::layout::Layout;
use crate::secrets::Secrets;
use crate::update::{Canary, Fetcher, Supervisor};
use crate::ReleaseRef;
use serde::Deserialize;
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
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
    base_urls: Vec<String>,
    platform: String,
    releases_dir: PathBuf,
    params_path: PathBuf,
    config_path: PathBuf,
    client: reqwest::blocking::Client,
    max_bytes: u64,
}

impl HttpFetcher {
    pub fn new(base_urls: &[String], platform: &str, layout: &Layout) -> Self {
        Self {
            base_urls: base_urls
                .iter()
                .map(|u| u.trim_end_matches('/').to_string())
                .collect(),
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

    fn download_to(&self, url: &str, dest: &Path, max_bytes: u64) -> Result<(), String> {
        let mut resp = self
            .client
            .get(url)
            .send()
            .map_err(|e| format!("download {url}: {e}"))?;
        if !resp.status().is_success() {
            return Err(format!("download {url}: HTTP {}", resp.status()));
        }
        if let Some(parent) = dest.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
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
            if total > max_bytes {
                let _ = std::fs::remove_file(dest);
                return Err("artifact exceeds size cap".into());
            }
            use std::io::Write;
            file.write_all(&buf[..n]).map_err(|e| e.to_string())?;
        }
        Ok(())
    }

    fn fetch_source(&self, base: &str, target: &ReleaseRef) -> Result<PathBuf, String> {
        // Pre-#102 registry releases carry no package/manifest/chunk commitments
        // (package_size 0). Fetch the bare executable and verify it against the
        // on-chain binary hash — still fail-closed, just without chunking.
        // ponytail: drop this branch once the manifest-era registry is deployed.
        if target.package_size == 0 {
            return self.fetch_source_legacy(base, target);
        }
        if target.package_size > self.max_bytes {
            return Err("on-chain package size is invalid for this agent".into());
        }

        let semver = crate::format_semver(target.version);
        let tmp = self.releases_dir.join(format!("{}.tmp", target.version));
        let final_dir = self.releases_dir.join(target.version.to_string());
        let _ = std::fs::remove_dir_all(&tmp);
        std::fs::create_dir_all(&tmp).map_err(|e| e.to_string())?;

        let manifest_path = tmp.join("manifest.json");
        let manifest_url = format!(
            "{}/artifacts/{}/{}/manifest.json",
            base, self.platform, semver
        );
        self.download_to(&manifest_url, &manifest_path, 2 * 1024 * 1024)?;
        let manifest_bytes = std::fs::read(&manifest_path).map_err(|e| e.to_string())?;
        let manifest = ReleaseManifest::parse_and_verify(&manifest_bytes, target, &self.platform)?;

        let chunk_dir = tmp.join("chunks");
        std::fs::create_dir_all(&chunk_dir).map_err(|e| e.to_string())?;
        let package_path = tmp.join("step-validator-node");
        let mut package = std::fs::File::create(&package_path).map_err(|e| e.to_string())?;
        for chunk in &manifest.chunks {
            let chunk_path = chunk_dir.join(chunk.index.to_string());
            let chunk_url = format!(
                "{}/artifacts/{}/{}/chunks-{}",
                base, self.platform, semver, chunk.index
            );
            self.download_to(&chunk_url, &chunk_path, chunk.size.saturating_add(1))?;
            let measured = sha256_file(&chunk_path).map_err(|e| e.to_string())?;
            if measured != hex_hash(&chunk.sha256)? {
                return Err(format!("chunk {} hash mismatch", chunk.index));
            }
            let meta = std::fs::metadata(&chunk_path).map_err(|e| e.to_string())?;
            if meta.len() != chunk.size {
                return Err(format!("chunk {} size mismatch", chunk.index));
            }
            use std::io::{Seek, SeekFrom, Write};
            package
                .seek(SeekFrom::Start(chunk.offset))
                .map_err(|e| e.to_string())?;
            let bytes = std::fs::read(&chunk_path).map_err(|e| e.to_string())?;
            package.write_all(&bytes).map_err(|e| e.to_string())?;
        }
        package.sync_all().map_err(|e| e.to_string())?;
        drop(package);

        let package_hash = sha256_file(&package_path).map_err(|e| e.to_string())?;
        if package_hash != target.package {
            return Err("assembled package hash mismatch".into());
        }
        // For the current validator release format the package is the executable
        // itself, so the binary hash and package hash both have to match. Future
        // macOS bundle/pkg updates must unpack to this same verified executable
        // before activation.
        if package_hash != target.binary {
            return Err("assembled executable hash mismatch".into());
        }

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&package_path, std::fs::Permissions::from_mode(0o755))
                .map_err(|e| e.to_string())?;
        }

        for (src, name, expected) in [
            (&self.params_path, "protocol-params.json", target.params),
            (&self.config_path, "config.json", target.config),
        ] {
            if src.exists() {
                std::fs::copy(src, tmp.join(name)).map_err(|e| e.to_string())?;
                if sha256_file(&tmp.join(name)).map_err(|e| e.to_string())? != expected {
                    return Err(format!("{name} hash mismatch vs on-chain release"));
                }
            }
        }

        let _ = std::fs::remove_dir_all(&final_dir);
        std::fs::rename(&tmp, &final_dir).map_err(|e| e.to_string())?;
        Ok(final_dir)
    }

    /// Legacy (pre-#102) fetch: `GET {base}/artifacts/{platform}/{semver}` is the
    /// executable itself; verify its sha256 against the on-chain binary hash.
    fn fetch_source_legacy(&self, base: &str, target: &ReleaseRef) -> Result<PathBuf, String> {
        let semver = crate::format_semver(target.version);
        let tmp = self.releases_dir.join(format!("{}.tmp", target.version));
        let final_dir = self.releases_dir.join(target.version.to_string());
        let _ = std::fs::remove_dir_all(&tmp);
        std::fs::create_dir_all(&tmp).map_err(|e| e.to_string())?;

        let package_path = tmp.join("step-validator-node");
        let url = format!("{}/artifacts/{}/{}", base, self.platform, semver);
        self.download_to(&url, &package_path, self.max_bytes)?;
        if sha256_file(&package_path).map_err(|e| e.to_string())? != target.binary {
            return Err("downloaded executable hash mismatch vs on-chain release".into());
        }

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&package_path, std::fs::Permissions::from_mode(0o755))
                .map_err(|e| e.to_string())?;
        }

        for (src, name, expected) in [
            (&self.params_path, "protocol-params.json", target.params),
            (&self.config_path, "config.json", target.config),
        ] {
            if src.exists() {
                std::fs::copy(src, tmp.join(name)).map_err(|e| e.to_string())?;
                if sha256_file(&tmp.join(name)).map_err(|e| e.to_string())? != expected {
                    return Err(format!("{name} hash mismatch vs on-chain release"));
                }
            }
        }

        let _ = std::fs::remove_dir_all(&final_dir);
        std::fs::rename(&tmp, &final_dir).map_err(|e| e.to_string())?;
        Ok(final_dir)
    }
}

impl Fetcher for HttpFetcher {
    fn fetch_and_verify(&self, target: &ReleaseRef) -> Result<PathBuf, String> {
        // Artifacts are addressed by human semver (matching publish/serve), while
        // local release dirs use the packed-u64. Each source must independently
        // prove a matching release manifest and chunk index against chain state.
        let mut last_err = String::from("no artifact sources configured");
        for base in &self.base_urls {
            match self.fetch_source(base, target) {
                Ok(path) => return Ok(path),
                Err(e) => {
                    let _ = std::fs::remove_dir_all(
                        self.releases_dir.join(format!("{}.tmp", target.version)),
                    );
                    last_err = format!("{base}: {e}");
                }
            }
        }
        Err(format!(
            "no source served a contract-matching manifest/chunk set: {last_err}"
        ))
    }
}

#[derive(Debug, Deserialize)]
struct ReleaseManifest {
    schema: String,
    version: String,
    packed_version: String,
    platform: String,
    binary_sha256: String,
    package_sha256: String,
    package_size: u64,
    chunk_root: String,
    chunks: Vec<ManifestChunk>,
    params_sha256: String,
    config_sha256: String,
    manifest_sha256: String,
}

#[derive(Debug, Deserialize)]
struct ManifestChunk {
    index: u64,
    offset: u64,
    size: u64,
    sha256: String,
}

impl ReleaseManifest {
    fn parse_and_verify(bytes: &[u8], target: &ReleaseRef, platform: &str) -> Result<Self, String> {
        let value: Value =
            serde_json::from_slice(bytes).map_err(|e| format!("manifest json: {e}"))?;
        let manifest_hash = manifest_hash(&value)?;
        if manifest_hash != target.manifest {
            return Err("manifest canonical hash mismatch".into());
        }
        let manifest: Self =
            serde_json::from_value(value).map_err(|e| format!("manifest shape: {e}"))?;
        if manifest.schema != "step.release-manifest.v1" {
            return Err("unsupported manifest schema".into());
        }
        if manifest.platform != platform {
            return Err("manifest platform mismatch".into());
        }
        if manifest.version != crate::format_semver(target.version) {
            return Err("manifest semver mismatch".into());
        }
        if manifest.packed_version != target.version.to_string() {
            return Err("manifest packed version mismatch".into());
        }
        if hex_hash(&manifest.binary_sha256)? != target.binary {
            return Err("manifest binary hash mismatch".into());
        }
        if hex_hash(&manifest.package_sha256)? != target.package {
            return Err("manifest package hash mismatch".into());
        }
        if manifest.package_size != target.package_size {
            return Err("manifest package size mismatch".into());
        }
        if hex_hash(&manifest.params_sha256)? != target.params {
            return Err("manifest params hash mismatch".into());
        }
        if hex_hash(&manifest.config_sha256)? != target.config {
            return Err("manifest config hash mismatch".into());
        }
        if hex_hash(&manifest.chunk_root)? != target.chunk_root {
            return Err("manifest chunk root mismatch".into());
        }
        if hex_hash(&manifest.manifest_sha256)? != target.manifest {
            return Err("manifest self hash mismatch".into());
        }
        verify_chunk_index(&manifest.chunks, target.package_size, target.chunk_root)?;
        Ok(manifest)
    }
}

fn hex_hash(s: &str) -> Result<[u8; 32], String> {
    let bytes = hex::decode(s.strip_prefix("0x").unwrap_or(s))
        .map_err(|e| format!("bad hex hash {s}: {e}"))?;
    bytes
        .try_into()
        .map_err(|_| format!("bad hash length for {s}"))
}

fn manifest_hash(value: &Value) -> Result<[u8; 32], String> {
    let mut unsigned = value.clone();
    if let Value::Object(ref mut obj) = unsigned {
        obj.remove("manifest_sha256");
        obj.remove("signatures");
    }
    let canonical = canonical_json(&unsigned);
    Ok(Sha256::digest(canonical.as_bytes()).into())
}

fn canonical_json(value: &Value) -> String {
    match value {
        Value::Null | Value::Bool(_) | Value::Number(_) | Value::String(_) => {
            serde_json::to_string(value).expect("json primitive serializes")
        }
        Value::Array(items) => {
            let inner = items
                .iter()
                .map(canonical_json)
                .collect::<Vec<_>>()
                .join(",");
            format!("[{inner}]")
        }
        Value::Object(map) => {
            let sorted: BTreeMap<_, _> = map.iter().collect();
            let inner = sorted
                .into_iter()
                .map(|(k, v)| {
                    format!(
                        "{}:{}",
                        serde_json::to_string(k).expect("key serializes"),
                        canonical_json(v)
                    )
                })
                .collect::<Vec<_>>()
                .join(",");
            format!("{{{inner}}}")
        }
    }
}

fn verify_chunk_index(
    chunks: &[ManifestChunk],
    package_size: u64,
    expected_root: [u8; 32],
) -> Result<(), String> {
    if chunks.is_empty() && package_size > 0 {
        return Err("manifest has no chunks for a non-empty package".into());
    }
    let mut next_offset = 0u64;
    let mut root_input = Vec::with_capacity(chunks.len() * 32);
    for (expected_index, chunk) in chunks.iter().enumerate() {
        if chunk.index != expected_index as u64 {
            return Err("chunk indexes must be contiguous from zero".into());
        }
        if chunk.offset != next_offset {
            return Err("chunk offsets must be contiguous".into());
        }
        if chunk.size == 0 {
            return Err("chunk size must be non-zero".into());
        }
        next_offset = next_offset.saturating_add(chunk.size);
        root_input.extend_from_slice(&hex_hash(&chunk.sha256)?);
    }
    if next_offset != package_size {
        return Err("chunk sizes do not sum to package size".into());
    }
    let measured_root: [u8; 32] = Sha256::digest(&root_input).into();
    if measured_root != expected_root {
        return Err("chunk root does not match on-chain release".into());
    }
    Ok(())
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

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn h(bytes: &[u8]) -> [u8; 32] {
        Sha256::digest(bytes).into()
    }

    fn hex(h: [u8; 32]) -> String {
        format!("0x{}", hex::encode(h))
    }

    fn release_and_manifest() -> (ReleaseRef, Vec<u8>) {
        let c0 = h(b"abc");
        let c1 = h(b"def");
        let mut root_input = Vec::new();
        root_input.extend_from_slice(&c0);
        root_input.extend_from_slice(&c1);
        let chunk_root = h(&root_input);
        let package = h(b"abcdef");
        let params = h(b"params");
        let config = h(b"config");
        let version = (1u64 << 32) | 7;
        let draft = json!({
            "schema": "step.release-manifest.v1",
            "version": "1.0.7",
            "packed_version": version.to_string(),
            "platform": "darwin-arm64",
            "platform_id": "0x1111111111111111111111111111111111111111111111111111111111111111",
            "binary_sha256": hex(package),
            "package_sha256": hex(package),
            "package_size": 6,
            "chunk_size": 3,
            "chunk_root": hex(chunk_root),
            "chunks": [
                { "index": 0, "offset": 0, "size": 3, "sha256": hex(c0) },
                { "index": 1, "offset": 3, "size": 3, "sha256": hex(c1) }
            ],
            "params_sha256": hex(params),
            "config_sha256": hex(config),
            "git_commit": "0000000000000000000000000000000000000000",
            "created_at": "2026-06-27T00:00:00.000Z"
        });
        let manifest_sha256 = hex(manifest_hash(&draft).expect("manifest hash"));
        let mut full = draft;
        full.as_object_mut().expect("object").insert(
            "manifest_sha256".into(),
            Value::String(manifest_sha256.clone()),
        );
        let target = ReleaseRef {
            version,
            binary: package,
            params,
            config,
            package,
            manifest: hex_hash(&manifest_sha256).unwrap(),
            chunk_root,
            package_size: 6,
        };
        (target, serde_json::to_vec(&full).unwrap())
    }

    #[test]
    fn release_manifest_verifies_against_on_chain_target() {
        let (target, bytes) = release_and_manifest();
        let manifest = ReleaseManifest::parse_and_verify(&bytes, &target, "darwin-arm64").unwrap();
        assert_eq!(manifest.version, "1.0.7");
        assert_eq!(manifest.chunks.len(), 2);
    }

    #[test]
    fn release_manifest_rejects_mutated_package_hash() {
        let (mut target, bytes) = release_and_manifest();
        target.package = [9; 32];
        let err = ReleaseManifest::parse_and_verify(&bytes, &target, "darwin-arm64").unwrap_err();
        assert!(err.contains("package"));
    }

    #[test]
    fn chunk_index_requires_contiguous_offsets_and_root() {
        let c0 = h(b"abc");
        let c1 = h(b"def");
        let mut root_input = Vec::new();
        root_input.extend_from_slice(&c0);
        root_input.extend_from_slice(&c1);
        let root = h(&root_input);
        let ok = vec![
            ManifestChunk {
                index: 0,
                offset: 0,
                size: 3,
                sha256: hex(c0),
            },
            ManifestChunk {
                index: 1,
                offset: 3,
                size: 3,
                sha256: hex(c1),
            },
        ];
        verify_chunk_index(&ok, 6, root).unwrap();

        let bad = vec![ManifestChunk {
            index: 0,
            offset: 1,
            size: 3,
            sha256: hex(c0),
        }];
        assert!(verify_chunk_index(&bad, 3, root).is_err());
    }
}
