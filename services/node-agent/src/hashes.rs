//! sha256 file measurement — the single canonical hashing method, shared in spirit
//! with the release pipeline (`scripts/release/publish.mjs`). Streamed so memory
//! stays bounded regardless of artifact size.

use crate::{Hash, Measurement};
use sha2::{Digest, Sha256};
use std::io::Read;
use std::path::Path;

/// sha256 a file, streaming in fixed chunks (bounded memory).
pub fn sha256_file(path: &Path) -> std::io::Result<Hash> {
    let mut f = std::fs::File::open(path)?;
    let mut hasher = Sha256::new();
    let mut buf = [0u8; 64 * 1024];
    loop {
        let n = f.read(&mut buf)?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    Ok(hasher.finalize().into())
}

/// Measure the binary/params/config of a staged release directory.
pub fn measure_dir(dir: &Path) -> std::io::Result<Measurement> {
    Ok(Measurement {
        binary: sha256_file(&dir.join("step-validator-node"))?,
        params: sha256_file(&dir.join("protocol-params.json"))?,
        config: sha256_file(&dir.join("config.json"))?,
    })
}

/// Lowercase hex with `0x` prefix.
pub fn hex0x(h: &Hash) -> String {
    format!("0x{}", hex::encode(h))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn known_vector() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("f");
        std::fs::File::create(&p)
            .unwrap()
            .write_all(b"abc")
            .unwrap();
        // sha256("abc")
        assert_eq!(
            hex0x(&sha256_file(&p).unwrap()),
            "0xba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
    }

    #[test]
    fn measure_dir_reads_three_files() {
        let dir = tempfile::tempdir().unwrap();
        for name in ["step-validator-node", "protocol-params.json", "config.json"] {
            std::fs::write(dir.path().join(name), name.as_bytes()).unwrap();
        }
        let m = measure_dir(dir.path()).unwrap();
        assert_ne!(m.binary, m.params);
        assert_ne!(m.params, m.config);
    }
}
