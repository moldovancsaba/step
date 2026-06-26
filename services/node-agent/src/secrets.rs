//! Secrets isolation (#43): the validator private key and the shared nonce secret
//! are loaded from the OS secure store at runtime and injected into the validator
//! child in-process — never written to plaintext run scripts, service units, or
//! logs.
//!
//! Backends (SECRET_BACKEND): `keychain` (macOS `security`), `secret-service`
//! (Linux `secret-tool`), or `file` (an age/operator-encrypted JSON at SECRET_FILE
//! with enforced 0600 perms). Fail-closed: a missing/locked store yields `None`
//! and the agent refuses to start the child rather than running without identity.

use std::path::PathBuf;
use std::process::Command;

#[derive(Clone, Debug)]
pub enum Backend {
    Keychain { service: String },
    SecretService { collection: String },
    File { path: PathBuf },
}

#[derive(Clone, Debug)]
pub struct Secrets {
    backend: Backend,
    /// Namespacing prefix so multiple nodes can coexist (e.g. the node address).
    namespace: String,
}

impl Secrets {
    pub fn from_env(namespace: &str) -> Self {
        let backend = match std::env::var("SECRET_BACKEND").as_deref() {
            Ok("file") => Backend::File {
                path: PathBuf::from(
                    std::env::var("SECRET_FILE").unwrap_or_else(|_| "secrets.json".into()),
                ),
            },
            Ok("secret-service") => Backend::SecretService {
                collection: std::env::var("SECRET_COLLECTION").unwrap_or_else(|_| "default".into()),
            },
            _ => Backend::Keychain {
                service: std::env::var("SECRET_SERVICE").unwrap_or_else(|_| "app.step.node".into()),
            },
        };
        Self {
            backend,
            namespace: namespace.to_lowercase(),
        }
    }

    fn account(&self, key: &str) -> String {
        format!("step.node.{}.{key}", self.namespace)
    }

    /// Fetch a secret, or `None` if absent/locked (fail-closed at the call site).
    pub fn get(&self, key: &str) -> Option<String> {
        match &self.backend {
            Backend::Keychain { service } => {
                let out = Command::new("security")
                    .args([
                        "find-generic-password",
                        "-s",
                        service,
                        "-a",
                        &self.account(key),
                        "-w",
                    ])
                    .output()
                    .ok()?;
                out.status
                    .success()
                    .then(|| String::from_utf8_lossy(&out.stdout).trim().to_string())
            }
            Backend::SecretService { collection } => {
                let out = Command::new("secret-tool")
                    .args([
                        "lookup",
                        "collection",
                        collection,
                        "account",
                        &self.account(key),
                    ])
                    .output()
                    .ok()?;
                out.status
                    .success()
                    .then(|| String::from_utf8_lossy(&out.stdout).trim().to_string())
            }
            Backend::File { path } => read_secret_file(path)?.get(&self.account(key)).cloned(),
        }
    }

    /// Store a secret in the OS store (keyless provisioning). Used by `--init` so
    /// the node's self-generated key never touches plaintext on disk (except the
    /// `file` backend, which is written 0600). Returns Err on backend failure.
    pub fn store(&self, key: &str, value: &str) -> Result<(), String> {
        match &self.backend {
            // macOS `security add-generic-password -w` is not consistently
            // stdin-driven across versions; pass the value as the option
            // argument so provisioning cannot block on an interactive prompt.
            Backend::Keychain { service } => {
                let out = Command::new("security")
                    .args([
                        "add-generic-password",
                        "-U",
                        "-s",
                        service,
                        "-a",
                        &self.account(key),
                        "-w",
                        value,
                    ])
                    .output()
                    .map_err(|e| e.to_string())?;
                out.status
                    .success()
                    .then_some(())
                    .ok_or("security add failed".into())
            }
            Backend::SecretService { collection } => Command::new("secret-tool")
                .args([
                    "store",
                    "--label=step-node",
                    "collection",
                    collection,
                    "account",
                    &self.account(key),
                ])
                .stdin(std::process::Stdio::piped())
                .spawn()
                .and_then(|mut c| {
                    use std::io::Write;
                    c.stdin.take().unwrap().write_all(value.as_bytes())?;
                    c.wait()
                })
                .map_err(|e| e.to_string())
                .and_then(|s| {
                    s.success()
                        .then_some(())
                        .ok_or("secret-tool store failed".into())
                }),
            Backend::File { path } => {
                let mut map = read_secret_file(path).unwrap_or_default();
                map.insert(self.account(key), value.to_string());
                let json = serde_json::to_string(&map).map_err(|e| e.to_string())?;
                std::fs::write(path, json).map_err(|e| e.to_string())?;
                #[cfg(unix)]
                {
                    use std::os::unix::fs::PermissionsExt;
                    std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))
                        .map_err(|e| e.to_string())?;
                }
                Ok(())
            }
        }
    }
}

/// Read an 0600 JSON secret file. Refuses (returns `None`) if the file is group/
/// world-accessible — secrets must never live in loosely-permissioned files.
fn read_secret_file(path: &std::path::Path) -> Option<std::collections::HashMap<String, String>> {
    let meta = std::fs::metadata(path).ok()?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mode = meta.permissions().mode() & 0o077;
        if mode != 0 {
            eprintln!(
                "secret file {} has unsafe permissions (need 0600)",
                path.display()
            );
            return None;
        }
    }
    let raw = std::fs::read(path).ok()?;
    serde_json::from_slice(&raw).ok()
}

/// Redact known secret substrings from a string before it is logged.
pub fn redact(s: &str, secrets: &[&str]) -> String {
    let mut out = s.to_string();
    for secret in secrets {
        if secret.len() >= 6 {
            out = out.replace(secret, "***REDACTED***");
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn file_backend_reads_namespaced_secret() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("secrets.json");
        let mut f = std::fs::File::create(&path).unwrap();
        f.write_all(br#"{"step.node.0xabc.validatorKey":"0xdeadbeef"}"#)
            .unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600)).unwrap();
        }
        std::env::set_var("SECRET_BACKEND", "file");
        std::env::set_var("SECRET_FILE", &path);
        let s = Secrets::from_env("0xABC");
        assert_eq!(s.get("validatorKey").as_deref(), Some("0xdeadbeef"));
        std::env::remove_var("SECRET_BACKEND");
        std::env::remove_var("SECRET_FILE");
    }

    #[test]
    fn file_backend_refuses_loose_permissions() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("secrets.json");
        std::fs::write(&path, br#"{"x":"y"}"#).unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o644)).unwrap();
            assert!(read_secret_file(&path).is_none()); // world-readable → refused
        }
    }

    #[test]
    fn redact_hides_secret_material() {
        let key = "0xdeadbeefcafebabe";
        let line = format!("spawned child with key={key}");
        assert!(!redact(&line, &[key]).contains(key));
        // short strings are not redacted (avoid mangling unrelated text)
        assert_eq!(redact("abc", &["abc"]), "abc");
    }
}
