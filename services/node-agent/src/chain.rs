//! Read-only chain client: resolves a node's authorized target from
//! ReleaseRegistry via JSON-RPC `eth_call`. The agent never writes to chain — a
//! tamper finding is reported to the hub, which holds INTEGRITY_ROLE and submits
//! it on-chain (cleaner trust boundary, no gas/keys needed on the node).

use crate::ReleaseRef;
use std::time::Duration;

/// ABI selector for `effectiveTarget(address,bytes32)` (computed via `cast sig`).
const SEL_EFFECTIVE_TARGET: [u8; 4] = [0x17, 0x4a, 0x31, 0x6d];
/// ABI selector for `release(bytes32,uint64)`.
const SEL_RELEASE: [u8; 4] = [0x5c, 0xe8, 0xc9, 0xc4];

pub struct ChainReader {
    client: reqwest::blocking::Client,
    rpc_urls: Vec<String>,
    registry: String,
    platform_id: [u8; 32],
}

impl ChainReader {
    pub fn new(rpc_urls: &[String], registry: &str, platform_id_hex: &str) -> Result<Self, String> {
        let platform_id =
            parse_b32(platform_id_hex).ok_or("bad PLATFORM_ID (need 0x + 32 bytes)")?;
        if rpc_urls.is_empty() {
            return Err("no RPC endpoints configured".into());
        }
        let client = reqwest::blocking::Client::builder()
            .timeout(Duration::from_secs(10))
            .build()
            .map_err(|e| e.to_string())?;
        Ok(Self {
            client,
            rpc_urls: rpc_urls.to_vec(),
            registry: registry.to_string(),
            platform_id,
        })
    }

    /// Resolve the release this node should run. `None` means "no active release"
    /// (e.g. everything revoked) — the caller holds its last-good locally.
    pub fn effective_target(&self, node_addr_hex: &str) -> Result<Option<ReleaseRef>, String> {
        let node = parse_addr(node_addr_hex).ok_or("bad NODE_ADDRESS")?;
        let mut data = Vec::with_capacity(4 + 64);
        data.extend_from_slice(&SEL_EFFECTIVE_TARGET);
        data.extend_from_slice(&[0u8; 12]);
        data.extend_from_slice(&node); // left-padded address
        data.extend_from_slice(&self.platform_id);
        let out = self.eth_call(&data)?;
        Ok(decode_release(&out))
    }

    /// The authorized release for an exact version on this platform — used by the
    /// integrity check to get the baseline hashes for the version actually running
    /// (NOT the target, which may be newer). `None` if unknown/revoked.
    pub fn release_of(&self, version: u64) -> Result<Option<ReleaseRef>, String> {
        let mut data = Vec::with_capacity(4 + 64);
        data.extend_from_slice(&SEL_RELEASE);
        data.extend_from_slice(&self.platform_id);
        data.extend_from_slice(&[0u8; 24]);
        data.extend_from_slice(&version.to_be_bytes()); // left-padded uint64
        let out = self.eth_call(&data)?;
        Ok(decode_release(&out))
    }

    /// eth_call with RPC failover: try endpoints in order; the first that responds
    /// (transport success) serves the read. A contract-level revert is returned as
    /// an error from the first reachable endpoint (no point retrying the same
    /// deterministic revert elsewhere).
    fn eth_call(&self, data: &[u8]) -> Result<Vec<u8>, String> {
        let body = serde_json::json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "eth_call",
            "params": [{ "to": self.registry, "data": format!("0x{}", hex::encode(data)) }, "latest"]
        });
        let mut last_err = String::from("no RPC endpoints");
        for url in &self.rpc_urls {
            match self.client.post(url).json(&body).send() {
                Err(e) => {
                    last_err = format!("rpc {url} unreachable: {e}");
                    continue; // transport failure → try the next endpoint
                }
                Ok(resp) => {
                    let v: serde_json::Value =
                        resp.json().map_err(|e| format!("rpc decode: {e}"))?;
                    if let Some(err) = v.get("error") {
                        return Err(format!("rpc error: {err}")); // deterministic — don't fail over
                    }
                    let result = v
                        .get("result")
                        .and_then(|r| r.as_str())
                        .ok_or("rpc: no result")?;
                    let trimmed = result.strip_prefix("0x").unwrap_or(result);
                    return hex::decode(trimmed).map_err(|e| format!("hex: {e}"));
                }
            }
        }
        Err(last_err)
    }
}

fn parse_addr(s: &str) -> Option<[u8; 20]> {
    let b = hex::decode(s.strip_prefix("0x").unwrap_or(s)).ok()?;
    (b.len() == 20).then(|| {
        let mut a = [0u8; 20];
        a.copy_from_slice(&b);
        a
    })
}

fn parse_b32(s: &str) -> Option<[u8; 32]> {
    let b = hex::decode(s.strip_prefix("0x").unwrap_or(s)).ok()?;
    (b.len() == 32).then(|| {
        let mut a = [0u8; 32];
        a.copy_from_slice(&b);
        a
    })
}

/// Decode the ABI-encoded `Release` struct. The manifest-era registry (#102)
/// returns 12 static 32-byte words; the currently-deployed pre-manifest
/// registry returns 8 (version, binary, params, config, package, publisher,
/// createdAt, revoked). Accept both — the manifest fields simply decode to
/// zero on the legacy layout. Returns `None` for an empty/zero release
/// (version 0), a revoked release, or a too-short blob.
// ponytail: drop the 8-word branch once the #102 registry is deployed on-chain.
fn decode_release(out: &[u8]) -> Option<ReleaseRef> {
    let legacy = out.len() == 32 * 8;
    if !legacy && out.len() < 32 * 12 {
        return None;
    }
    let word = |i: usize| -> &[u8] { &out[i * 32..(i + 1) * 32] };
    let mut v8 = [0u8; 8];
    v8.copy_from_slice(&word(0)[24..32]);
    let version = u64::from_be_bytes(v8);
    if version == 0 {
        return None;
    }
    let revoked_word = if legacy { 7 } else { 11 };
    if word(revoked_word).iter().any(|&b| b != 0) {
        return None;
    }
    let mut binary = [0u8; 32];
    let mut params = [0u8; 32];
    let mut config = [0u8; 32];
    let mut package = [0u8; 32];
    let mut manifest = [0u8; 32];
    let mut chunk_root = [0u8; 32];
    let mut package_size = 0u64;
    binary.copy_from_slice(word(1));
    params.copy_from_slice(word(2));
    config.copy_from_slice(word(3));
    package.copy_from_slice(word(4));
    if !legacy {
        manifest.copy_from_slice(word(5));
        chunk_root.copy_from_slice(word(6));
        let mut size8 = [0u8; 8];
        size8.copy_from_slice(&word(7)[24..32]);
        package_size = u64::from_be_bytes(size8);
    }
    Some(ReleaseRef {
        version,
        binary,
        params,
        config,
        package,
        manifest,
        chunk_root,
        package_size,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_a_release_tuple() {
        // Hand-build the 12-word ABI return for version 1.2.3 and release hashes.
        let version: u64 = (1u64 << 32) | (2 << 16) | 3;
        let mut out = vec![0u8; 32 * 12];
        out[24..32].copy_from_slice(&version.to_be_bytes());
        out[32..64].copy_from_slice(&[0x11u8; 32]);
        out[64..96].copy_from_slice(&[0x22u8; 32]);
        out[96..128].copy_from_slice(&[0x33u8; 32]);
        out[128..160].copy_from_slice(&[0x44u8; 32]);
        out[160..192].copy_from_slice(&[0x55u8; 32]);
        out[192..224].copy_from_slice(&[0x66u8; 32]);
        out[248..256].copy_from_slice(&1234u64.to_be_bytes());
        // word11 revoked = 0
        let r = decode_release(&out).expect("decoded");
        assert_eq!(r.version, version);
        assert_eq!(r.binary, [0x11; 32]);
        assert_eq!(r.params, [0x22; 32]);
        assert_eq!(r.config, [0x33; 32]);
        assert_eq!(r.package, [0x44; 32]);
        assert_eq!(r.manifest, [0x55; 32]);
        assert_eq!(r.chunk_root, [0x66; 32]);
        assert_eq!(r.package_size, 1234);
    }

    #[test]
    fn zero_version_is_none() {
        assert!(decode_release(&[0u8; 32 * 12]).is_none());
    }

    #[test]
    fn revoked_is_none() {
        let mut out = vec![0u8; 32 * 12];
        out[31] = 1; // version 1
        out[32 * 12 - 1] = 1; // revoked = true
        assert!(decode_release(&out).is_none());
    }

    #[test]
    fn short_blob_is_none() {
        assert!(decode_release(&[0u8; 10]).is_none());
    }

    #[test]
    fn decodes_a_legacy_pre_manifest_release_tuple() {
        // The deployed pre-#102 registry returns 8 words:
        // version, binary, params, config, package, publisher, createdAt, revoked.
        let version: u64 = 1u64 << 32; // 1.0.0
        let mut out = vec![0u8; 32 * 8];
        out[24..32].copy_from_slice(&version.to_be_bytes());
        out[32..64].copy_from_slice(&[0x11u8; 32]);
        out[64..96].copy_from_slice(&[0x22u8; 32]);
        out[96..128].copy_from_slice(&[0x33u8; 32]);
        // word4 package = 0, word5 publisher (non-zero, must not read as revoked),
        // word6 createdAt, word7 revoked = 0.
        out[172..192].copy_from_slice(&[0xaa; 20]);
        out[216..224].copy_from_slice(&1_750_000_000u64.to_be_bytes());
        let r = decode_release(&out).expect("decoded legacy");
        assert_eq!(r.version, version);
        assert_eq!(r.binary, [0x11; 32]);
        assert_eq!(r.params, [0x22; 32]);
        assert_eq!(r.config, [0x33; 32]);
        assert_eq!(r.manifest, [0; 32]);
        assert_eq!(r.package_size, 0);
    }

    #[test]
    fn legacy_revoked_is_none() {
        let mut out = vec![0u8; 32 * 8];
        out[31] = 1; // version word
        out[32 * 8 - 1] = 1; // legacy revoked word 7
        assert!(decode_release(&out).is_none());
    }
}
