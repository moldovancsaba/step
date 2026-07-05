//! # STEP claim validation rules
//!
//! Deterministic validation checks for proof-of-presence claims (POP-003,
//! HARD §6.4): every validator node runs exactly these rules, so a claim's
//! validity never depends on which node evaluated it. Network-dependent state
//! (nonce single-use sets, rate limits, previous-claim lookups) lives in the
//! node; this crate is pure functions over inputs.
//!
//! Cryptographic conventions (mirrored in Swift and TypeScript):
//! - **Canonical claim message** (`canonical_message`): fixed-format,
//!   line-oriented UTF-8 — no JSON float ambiguity in signed bytes.
//! - **claim_hash** = keccak256(canonical message bytes).
//! - **Miner signature** = secp256k1 over the EIP-191 personal-message digest
//!   of the canonical message (`personal_sign` compatible, recoverable).
//! - **triangle_id_hash** = keccak256(utf8(triangle ID string)) — the on-chain
//!   `bytes32` triangle identity used by the contracts.

pub mod claim;
pub mod fraud;
pub mod sign;
pub mod validate;

pub use claim::{Claim, IntegrityMode, MerchantProof};
pub use fraud::{FraudScore, FraudSignal, PreviousClaim};
pub use sign::{
    campaign_id_word, claim_hash, eip712_vote_digest, keccak256, personal_digest, recover_address,
    triangle_id_hash, Address,
};
pub use validate::{validate_claim, RejectReason, ValidationContext, ValidationParams, Verdict};
