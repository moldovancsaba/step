//! STEP P2P validator gossip (#54).
//!
//! Replaces the central gateway in the claim→vote→finalise path with a libp2p
//! gossip mesh: any node receives a claim, validates it locally, signs an
//! EIP-712 vote (byte-compatible with the existing contract), gossips the vote,
//! aggregates peers' votes by claim, and — when a weighted on-chain quorum of
//! approvals exists — submits the bundle to the shared chain. No single
//! coordinator sits in the finalisation path.
//!
//! The protocol core (`messages`, `aggregate`, `replay`, `engine`) is pure and
//! fully unit-tested offline; `swarm` is the libp2p I/O that drives it.

pub mod aggregate;
pub mod agreement;
pub mod config;
pub mod engine;
pub mod messages;
pub mod replay;
pub mod swarm;

pub use aggregate::{Bundle, VoteAggregator};
pub use engine::{Action, Engine};
pub use messages::{ClaimMsg, Gossip, VoteMsg};
