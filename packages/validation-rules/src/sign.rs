//! Hashing, signature recovery, and EIP-712 vote digests.
//!
//! The EIP-712 encoding here must match `MiningClaimVerifier.sol` bit-for-bit:
//! domain `EIP712Domain(name,version,chainId,verifyingContract)` with
//! name="StepMiningClaim", version="1", and vote struct
//! `StepValidatorVote(bytes32 claimHash,bytes32 triangleId,address miner,bool approve)`.
//! Conformance is proven end-to-end by the e2e test (tests/e2e), where votes
//! signed by the Rust node finalise claims on the deployed contracts.

use k256::ecdsa::{RecoveryId, Signature, SigningKey, VerifyingKey};
use sha3::{Digest, Keccak256};
use thiserror::Error;

pub type Address = [u8; 20];

#[derive(Debug, Error)]
pub enum SignError {
    #[error("invalid signature encoding")]
    Encoding,
    #[error("signature recovery failed")]
    Recovery,
}

pub fn keccak256(data: &[u8]) -> [u8; 32] {
    let mut h = Keccak256::new();
    h.update(data);
    h.finalize().into()
}

/// keccak256 of the canonical claim message — the protocol-wide claim identity.
pub fn claim_hash(canonical_message: &str) -> [u8; 32] {
    keccak256(canonical_message.as_bytes())
}

/// On-chain `bytes32` triangle identity (contracts hash the ID string).
pub fn triangle_id_hash(triangle_id: &str) -> [u8; 32] {
    keccak256(triangle_id.as_bytes())
}

/// EIP-191 personal-message digest of arbitrary bytes (`personal_sign`).
pub fn personal_digest(message: &[u8]) -> [u8; 32] {
    let prefix = format!("\x19Ethereum Signed Message:\n{}", message.len());
    let mut h = Keccak256::new();
    h.update(prefix.as_bytes());
    h.update(message);
    h.finalize().into()
}

fn address_of(vk: &VerifyingKey) -> Address {
    let encoded = vk.to_encoded_point(false);
    let digest = keccak256(&encoded.as_bytes()[1..]); // drop 0x04 prefix
    let mut a = [0u8; 20];
    a.copy_from_slice(&digest[12..]);
    a
}

/// Recover the signer address from a 65-byte `r||s||v` signature over a
/// 32-byte digest. Accepts v ∈ {0,1,27,28}.
pub fn recover_address(digest: &[u8; 32], signature_65: &[u8]) -> Result<Address, SignError> {
    if signature_65.len() != 65 {
        return Err(SignError::Encoding);
    }
    let sig = Signature::from_slice(&signature_65[..64]).map_err(|_| SignError::Encoding)?;
    let v = signature_65[64];
    let rec_byte = if v >= 27 { v - 27 } else { v };
    let rec = RecoveryId::try_from(rec_byte).map_err(|_| SignError::Encoding)?;
    let vk =
        VerifyingKey::recover_from_prehash(digest, &sig, rec).map_err(|_| SignError::Recovery)?;
    Ok(address_of(&vk))
}

/// Sign a 32-byte digest, returning the Ethereum-style 65-byte `r||s||v`
/// signature with v ∈ {27,28}.
pub fn sign_digest(digest: &[u8; 32], key: &SigningKey) -> [u8; 65] {
    let (sig, rec) = key
        .sign_prehash_recoverable(digest)
        .expect("prehash signing cannot fail for valid key");
    let mut out = [0u8; 65];
    out[..64].copy_from_slice(&sig.to_bytes());
    out[64] = 27 + rec.to_byte();
    out
}

pub fn signer_address(key: &SigningKey) -> Address {
    address_of(key.verifying_key())
}

/// EIP-191 `personal_sign` over `message` using a raw 32-byte secp256k1 key.
/// Convenience for callers (e.g. the node-agent's signed heartbeats, #56) that
/// hold key material as bytes and shouldn't depend on `k256` directly. Returns
/// `None` if the bytes are not a valid key.
pub fn personal_sign_with_key_bytes(key_bytes: &[u8], message: &[u8]) -> Option<[u8; 65]> {
    let key = SigningKey::from_slice(key_bytes).ok()?;
    Some(sign_digest(&personal_digest(message), &key))
}

/// The Ethereum address for a raw 32-byte secp256k1 key. `None` if invalid.
pub fn address_from_key_bytes(key_bytes: &[u8]) -> Option<Address> {
    Some(signer_address(&SigningKey::from_slice(key_bytes).ok()?))
}

/// Generate a fresh secp256k1 private key as 32 bytes, for keyless node
/// provisioning (the node makes its own identity; nothing secret ever travels).
/// Reads OS entropy from `/dev/urandom` and rejects the negligibly-rare draw that
/// isn't a valid scalar — no RNG-feature dependency on k256.
pub fn generate_key_bytes() -> std::io::Result<[u8; 32]> {
    use std::io::Read;
    loop {
        let mut buf = [0u8; 32];
        std::fs::File::open("/dev/urandom")?.read_exact(&mut buf)?;
        if SigningKey::from_slice(&buf).is_ok() {
            return Ok(buf);
        }
    }
}

const EIP712_DOMAIN_TYPEHASH: &str =
    "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)";
const VOTE_TYPEHASH: &str =
    "StepValidatorVote(bytes32 claimHash,bytes32 triangleId,address miner,bool approve)";

fn abi_word_u256(v: u64) -> [u8; 32] {
    let mut w = [0u8; 32];
    w[24..].copy_from_slice(&v.to_be_bytes());
    w
}

fn abi_word_address(a: &Address) -> [u8; 32] {
    let mut w = [0u8; 32];
    w[12..].copy_from_slice(a);
    w
}

fn domain_separator(chain_id: u64, verifying_contract: &Address) -> [u8; 32] {
    let mut enc = Vec::with_capacity(160);
    enc.extend_from_slice(&keccak256(EIP712_DOMAIN_TYPEHASH.as_bytes()));
    enc.extend_from_slice(&keccak256(b"StepMiningClaim"));
    enc.extend_from_slice(&keccak256(b"1"));
    enc.extend_from_slice(&abi_word_u256(chain_id));
    enc.extend_from_slice(&abi_word_address(verifying_contract));
    keccak256(&enc)
}

/// The digest a validator signs to vote on a claim — must equal
/// `MiningClaimVerifier.voteDigest(...)` on-chain.
pub fn eip712_vote_digest(
    chain_id: u64,
    verifying_contract: &Address,
    claim_hash_: &[u8; 32],
    triangle_id_hash_: &[u8; 32],
    miner: &Address,
    approve: bool,
) -> [u8; 32] {
    let mut struct_enc = Vec::with_capacity(160);
    struct_enc.extend_from_slice(&keccak256(VOTE_TYPEHASH.as_bytes()));
    struct_enc.extend_from_slice(claim_hash_);
    struct_enc.extend_from_slice(triangle_id_hash_);
    struct_enc.extend_from_slice(&abi_word_address(miner));
    struct_enc.extend_from_slice(&abi_word_u256(if approve { 1 } else { 0 }));
    let struct_hash = keccak256(&struct_enc);

    let mut final_enc = Vec::with_capacity(66);
    final_enc.extend_from_slice(b"\x19\x01");
    final_enc.extend_from_slice(&domain_separator(chain_id, verifying_contract));
    final_enc.extend_from_slice(&struct_hash);
    keccak256(&final_enc)
}

pub fn parse_address(s: &str) -> Option<Address> {
    let s = s.strip_prefix("0x")?;
    let bytes = hex::decode(s).ok()?;
    bytes.try_into().ok()
}

pub fn format_address(a: &Address) -> String {
    format!("0x{}", hex::encode(a))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sign_and_recover_round_trip() {
        let key = SigningKey::from_slice(&[7u8; 32]).unwrap();
        let me = signer_address(&key);
        let digest = keccak256(b"hello step");
        let sig = sign_digest(&digest, &key);
        assert_eq!(recover_address(&digest, &sig).unwrap(), me);
        // Tampered digest recovers a different address.
        let other = keccak256(b"hello stop");
        assert_ne!(recover_address(&other, &sig).unwrap(), me);
    }

    #[test]
    fn personal_sign_round_trip() {
        let key = SigningKey::from_slice(&[9u8; 32]).unwrap();
        let msg = b"STEP-CLAIM-V1\nwallet=0xabc\n";
        let digest = personal_digest(msg);
        let sig = sign_digest(&digest, &key);
        assert_eq!(
            recover_address(&digest, &sig).unwrap(),
            signer_address(&key)
        );
    }

    #[test]
    fn generated_key_is_valid_and_unique() {
        let a = generate_key_bytes().unwrap();
        let b = generate_key_bytes().unwrap();
        assert_ne!(a, b, "two draws must differ");
        assert!(address_from_key_bytes(&a).is_some());
        assert!(personal_sign_with_key_bytes(&a, b"hi").is_some());
    }

    #[test]
    fn known_keccak_vector() {
        // keccak256("") — canonical test vector.
        assert_eq!(
            hex::encode(keccak256(b"")),
            "c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470"
        );
    }

    #[test]
    fn vote_digest_changes_with_every_field() {
        let contract = parse_address("0x610178dA211FEF7D417bC0e6FeD39F05609AD788").unwrap();
        let miner = parse_address("0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266").unwrap();
        let ch = keccak256(b"claim");
        let th = keccak256(b"triangle");
        let base = eip712_vote_digest(31337, &contract, &ch, &th, &miner, true);
        assert_ne!(
            base,
            eip712_vote_digest(31337, &contract, &ch, &th, &miner, false)
        );
        assert_ne!(
            base,
            eip712_vote_digest(1, &contract, &ch, &th, &miner, true)
        );
        assert_ne!(
            base,
            eip712_vote_digest(31337, &contract, &keccak256(b"x"), &th, &miner, true)
        );
    }
}
