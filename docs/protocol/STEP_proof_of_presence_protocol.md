# STEP Proof-of-Presence Protocol

**Version:** v1 (alpha, as implemented) · **Date:** 2026-06-12
**Schemas:** [`step.proof.location.v1`](../../packages/schemas/step.proof.location.v1.json), [`step.evidence.bundle.v1`](../../packages/schemas/step.evidence.bundle.v1.json)
**Reference implementation:** [`packages/validation-rules`](../../packages/validation-rules) (Rust); conformance vector [`cross-language-vector.v1.json`](../../packages/schemas/cross-language-vector.v1.json)

## 1. Claim object and canonical signing

The claim carries wallet, triangle ID + level, coordinates, accuracy, RFC3339 UTC timestamp, nonce, integrity mode (+ attestation tokens when `attested`), optional campaign/QR/previous-hash, and the miner signature.

The signed bytes are the **STEP-CLAIM-V1 canonical message** — a fixed line format with fixed-decimal coordinates (lat/lon %.7f, accuracy %.2f), eliminating JSON/float ambiguity:

```text
STEP-CLAIM-V1\nwallet=<lowercase 0x…>\ntriangle=<id>\nlevel=<n>\nlat=…\nlon=…\nacc=…\nts=…\nnonce=…\nintegrity=…\ncampaign=<id|->\nprev=<hash|->\n
```

- `claim_hash = keccak256(message)` — protocol-wide claim identity
- miner signature = secp256k1 over the EIP-191 personal digest of the message; deterministic (RFC-6979), proven byte-identical in Rust/TS/Swift

## 2. Nonce challenge (ADR-017, alpha)

Gateway-issued: `wallethex:expiryUnix:random.tag16` where `tag = keccak256(secret‖payload)[..16]`, ≤128 chars. Validators verify the tag, wallet binding, and expiry, and enforce single use via a hashed seen-set. Replays are rejected even when the rest of the claim changes (proven in E2E-3b). MVP replaces the shared-secret tag with validator-issued challenges.

## 3. Acceptance rule (POP-003, all ANDed — every condition has a rejection test)

valid signature ∧ fresh single-use nonce ∧ timestamp within window ∧ fields in bounds ∧ integrity-mode policy satisfied (attested tokens present, or dev mode explicitly allowed off-pilot) ∧ **independently recomputed** triangle == claimed triangle ∧ accuracy within tier ceiling and boundary policy ∧ mineable level (natural) ∧ fraud score < threshold ∧ validator quorum weight ≥ threshold ∧ triangle open on-chain (not Locked/Cooldown/Exhausted/Frozen) ∧ claim hash never finalised before.

Alpha currently mines only level 21, and the app does not auto-downgrade to lower levels. If your resolved `mesh_level` is not mineable, the claim is rejected as `level_not_mineable`. Child triangles (21+1, etc.) are only mineable after the parent triangle is fully exhausted.

Boundary semantics at level 21 (≈6.7 m sides): with the alpha threshold this level is intentionally tuned for real GNSS hardware. `boundary_ambiguous` still applies when the accuracy circle intersects an edge, but only `reject_accuracy` blocks submission once the configured radius cap is exceeded.

## 4. Fraud scoring v1 (implemented signals)

| Signal | Trigger | Weight |
|---|---|---|
| speed_violation | inter-claim speed > `max_plausible_speed_mps` (param, 69.4) | 1.0 (hard) |
| teleport | claim predates previous accepted claim, **or** same-second timestamp with displacement > max(accuracy, 25 m) — gap found and fixed via E2E | 1.0 (hard) |
| accuracy_anomaly | reported accuracy < 0.5 m (implausible GNSS) | 0.5 |
| unattested | no app/device attestation | 0.4 |

Score = capped sum; reject at `fraud_score_reject_threshold` (param, 0.7). Wallet-clustering and validator-affinity analytics are MVP scope (require accumulated history). Plus per-wallet hourly rate limiting at the node.

## 5. Validator votes and finalisation

Validators sign **both approvals and rejections** (EIP-712 `StepValidatorVote(claimHash, triangleId, miner, approve)`) — rejections are evidence too. The gateway aggregates approvals (dedup, ascending addresses), pre-checks weight ≥ threshold, then submits `finaliseNaturalClaim`/`finaliseSponsoredClaim`; the contract independently re-verifies every signature against the on-chain registry and enforces all economic/safety state. The contract is final: validator approval cannot override a freeze, cooldown, exhaustion, or campaign rule (proven in E2E-5).

## 6. Evidence and privacy (POP-008/009)

Off-chain: the full claim + validator signatures + fraud score as a `step.evidence.bundle.v1`, encrypted per-bundle (XChaCha20-Poly1305) with wrapped keys; CIDv1 content addressing; deletion = key destruction (logged). On-chain: claim hash, triangle hash, miner, slot/campaign, amount, proof-CID hash, quorum signatures — never coordinates. Validator logs carry claim hashes and reason codes only.

## 7. Claim lifecycle (user-visible)

`submitted → validating → accepted → finalised` | `rejected(reasons[])`. Gateway records are idempotent per claim hash; chain reverts surface as `chain_revert:<reason>` rejections. Status streams to the app and the public explorer shows finalised claims only.

## 8. Parameters (all from the registry, never hardcoded)

`claim_timestamp_window_seconds` 300 · `nonce_ttl_seconds` 120 · `max_accuracy_radius_m_l1` 25 · `max_accuracy_fraction_of_side` 10.0 · `max_plausible_speed_mps` 69.4 · `fraud_score_reject_threshold` 0.7 · `mineable_levels` [21] — all UNFROZEN alpha defaults pending the tokenomics constitution and field data.
