# STEP Validator Protocol

**Version:** v1 (alpha) · **Date:** 2026-06-12 · **Node:** [`services/validator-node`](../../services/validator-node) (Rust)

## 1. Validator identity and registry

A validator is a secp256k1 keypair registered on-chain (`ValidatorRegistry`): type (MobilePeer/ApprovedPoint/Merchant/Venue/Infrastructure/Protocol), weight, status (Active/UnderReview/Suspended/Removed), stake slot. Only **Active** weight counts toward quorum; status and weight changes and slashes are events. Alpha set: foundation-registered Protocol validators (weight 50, quorum 100 ⇒ 2-of-3); registration is admin-gated (DEV §9.5 — no open market until fraud rules are field-proven).

## 2. Node pipeline (every claim, deterministic)

1. parse + wallet check → 2. per-wallet sliding-hour rate limit → 3. nonce tag/binding/expiry + single-use set → 4. full `validation-rules` pipeline (signature recovery, freshness, bounds, integrity policy, **independent geometry recomputation via the embedded mesh-engine**, accuracy/boundary, level, fraud score with per-wallet movement history) → 5. sign EIP-712 vote (approve or reject — both are signed evidence) → 6. respond `{verdict, vote, validated_at}`.

Determinism guarantee: two honest nodes with the same parameter registry and history inputs produce the same verdict; all judgment lives in the shared `validation-rules` crate, the node adds only stateful facts (nonce set, rate window, last-approved location).

## 3. Quorum and finalisation

`Σ activeWeight(approvals) ≥ verifier.quorum_threshold_weight` with signatures sorted by ascending validator address (cheap on-chain dedup). Two transports produce the same bundle, because the vote shape is transport-independent and the contract re-verifies everything (so any relayer is an availability dependency, not a trust dependency): (1) the **gateway** aggregates and relays in alpha (DEV §9.3 "chain **or relayer**"); (2) the delivered **libp2p gossip mesh** (`services/gossip-node`, #54) lets any node aggregate gossiped votes by claim and submit the bundle itself, with no central coordinator — see [STEP_local_node_and_trust_federation.md](../architecture/STEP_local_node_and_trust_federation.md) §4. On the gossip path each peer reads `activeWeight` from multiple chain endpoints and uses only a value a majority agree on (#50), so a single divergent chain node cannot skew quorum weights.

## 4. Incentives and penalties (alpha → target)

Alpha: foundation-funded operation; penalties = on-chain status changes (`UnderReview`/`Suspended`/`Removed`) and `slash(amount, reasonCode)` against posted stake, both admin/slasher-role gated and evented. Appeal states per HARD §7.5 are representable in the registry status machine. Target (OPEN-9, post-alpha): validation fees from merchant-funded flows, premium-proof fees, stake-weighted routing, randomised assignment so miners cannot pick their validators.

## 5. Mesh API duty

Nodes expose the canonical geometry read API (`GET /v1/mesh/resolve`, `GET /v1/mesh/triangle/{id}`) so every non-Rust consumer uses the single implementation (ADR-004). This is a pure function of the frozen spec — no consensus involved.

## 6. Operations

Config via env (port, chain id, verifier address, key, nonce secret, `allow_dev_claims` — **must be false on pilot nodes**, params file, rate limit). Structured JSON logs with claim hashes and reason codes (never coordinates). Prometheus `/metrics`: claims/approved/rejected/rate-limited/nonce-replays. Health: `/healthz`. State is in-memory and reconstructible; a restarted node only loses its nonce seen-set (bounded by nonce TTL) and movement history (regrows per wallet).
