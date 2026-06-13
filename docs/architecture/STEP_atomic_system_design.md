# STEP Atomic System Design

**Version:** 0.1 · **Date:** 2026-06-12 · Modules as implemented, with code locations.

## 1. Mobile (apps/ios/StepCore)

| Module (DEV §21.3 mapping) | File | Atomic responsibility |
|---|---|---|
| WalletModule | `Sources/StepCore/Wallet.swift` | Key create/import/load (Keychain ThisDeviceOnly), Ethereum address, r‖s‖v signing |
| LocationModule | `Sources/StepAppUI/AppModel.swift` (`LocationService`) | One-shot precise fix → `LocationSample` |
| MeshModule | `Sources/StepCore/GatewayClient.swift` (`resolveTriangle`) | Canonical triangle for a coordinate |
| ClaimModule / Proof | `CanonicalClaim.swift`, `ClaimBuilder.swift` | Canonical message, hashes, EIP-191 digest, signed claim assembly |
| AttestationModule | `ClaimBuilder.AttestationEvidence` | Explicit attested/dev-unattested evidence (App Attest wiring = app-target step) |
| Networking | `GatewayClient.swift` | Nonce, submit, status |
| Map | `Views.swift` (`TriangleShapeView`) | Native canonical-triangle rendering |
| PrivacyModule | `Views.swift` (`SettingsView`) + `AppModel.PrivacyMode` | Private-by-default profile modes |

## 2. Validation (packages/validation-rules, services/validator-node)

| Module (DEV validator list) | File | Atomic responsibility |
|---|---|---|
| ClaimParser | `claim.rs` | Schema-shaped claim + canonical message |
| SignatureVerifier | `sign.rs` | EIP-191 recovery == wallet; EIP-712 vote digests (contract-exact) |
| LocationVerifier | `validate.rs` step 8 | Independent `boundary_policy` recomputation; client triangle never trusted |
| RiskEngine | `fraud.rs` | Speed/teleport (incl. same-second displacement), accuracy anomaly, unattested signal → score |
| QuorumEngine | gateway `quorum.ts` + contract `_checkQuorum` | Weighted aggregation, ascending-address dedup |
| Nonce | node `nonce.rs` (verify) + gateway/shared-types (issue) | Tagged wallet-bound expiring single-use challenge |
| Rate limiting | node `state.rs` | Sliding-hour per-wallet cap |
| Metrics | node `metrics.rs` | Prometheus counters (claims/approved/rejected/ratelimited/replays) |

## 3. Contracts (contracts/src) — see [contract spec](../smart-contracts/STEP_contract_specification.md)

Atomic state owners: `TriangleMiningState` (slots/cooldown/exhaustion), `FoundationTreasury` (twin + reason-coded movements), `CampaignRegistry` (campaign machine + wallet limits), `RewardPool` (escrow only), `MiningClaimVerifier` (quorum + replay + orchestration), `SafetyRegistry` (freezes), `StepAccess` (roles + domain pauses), `Parameterized` (schedule→delay→apply for every economic constant).

## 4. Services (TypeScript)

| Service | Atomic responsibility | Store |
|---|---|---|
| gateway-api | nonce issue; fan-out; consistency check; quorum pre-check; simulate-first relay; idempotent records | memory (claims are chain-recoverable) |
| indexer | event→projection (`events.ts` pure), explorer REST | memory, rebuildable from block 0 (Postgres at public-testnet stage) |
| proof-storage | XChaCha20-Poly1305 vault, CIDv1(raw,sha2-256), key-destruction deletion, token-gated reads | memory/file backends |
| merchant-api | onboarding gates (categories, rights), POI→triangle, rotating QR issue/verify | memory registry (rebuildable; Postgres at MVP) |
| exchange-service | closed campaign credits only; floor-rounded Trinity conversion; disclaimer on every response | memory ledger |
| campaign-worker | pure `shouldExpire`/`shouldRefund` over chain state → permissionless expire/refund txs | none (chain-driven) |

## 5. Identity and hashing conventions (cross-language contract)

- `claim_hash = keccak256(STEP-CLAIM-V1 canonical message)`
- `triangle_id_hash = keccak256(utf8(triangle id string))` — the on-chain `bytes32` triangle identity
- miner signature: EIP-191 personal-sign over the canonical message (RFC-6979 ⇒ byte-identical across implementations)
- vote digest: EIP-712, domain `StepMiningClaim/1/chainId/verifier`, struct `StepValidatorVote(claimHash,triangleId,miner,approve)`
- conformance pinned by `packages/schemas/cross-language-vector.v1.json` (replayed by Rust, TS, Swift suites) and `packages/mesh-engine/golden/golden_vectors.tsv` (341 rows)
