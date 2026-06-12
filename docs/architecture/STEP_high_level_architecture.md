# STEP High-Level Architecture

**Version:** 0.1 (alpha, as built) · **Date:** 2026-06-12

## 1. Topology (alpha, ADR-005/006)

```text
 iOS app (StepCore)            merchant dashboard        protocol admin        explorer
   │ signed claim                 │ server actions          │ server actions     │ reads
   ▼                              ▼ (managed key)           ▼ (admin key)        │
 gateway-api ──── nonce ───► miner                          │                    │
   │  fan-out claim                                          │                    │
   ▼                                                         │                    │
 3× validator-node (Rust) ── independent geometry/fraud/sig checks ── signed EIP-712 votes
   │  votes back to gateway                                  │                    │
   ▼                                                         ▼                    │
 gateway quorum pre-check ──► MiningClaimVerifier ◄── CampaignRegistry/RewardPool │
   │ (relayer tx, simulate-first)        │ mints/releases, twin, proof hashes     │
   │                                     ▼                                        │
   │                            Anvil / internal EVM testnet ──── events ──► indexer ──► explorer/dashboards
   ▼
 proof-storage (encrypted evidence vault, CIDs)        campaign-worker (chain-driven expiry/refund)
 exchange-service (closed campaign credits ONLY)       merchant-api (POIs, rotating QR)
```

Centralisation points in alpha are deliberate, documented progressive-decentralisation steps (SYS §12.1): gateway-issued nonces (shared-tag scheme), gateway as relayer, foundation-operated validators, env-key admin (multisig pre-pilot gap). The validator nodes' message shapes are transport-independent; libp2p gossip replaces the HTTP fan-out at MVP without protocol changes.

## 2. Layer responsibilities (DEV §5.1 separation, as implemented)

| Layer | Implementation | Responsibility | Never does |
|---|---|---|---|
| iOS app | `apps/ios/StepCore` | Produce signed claims + evidence; show status | Claim validity decisions |
| Gateway | `services/gateway-api` | Nonces, fan-out, quorum pre-check, relaying, evidence hand-off | Geometry or fraud judgment |
| Validators | `services/validator-node` + `packages/validation-rules` | Independent recomputation of geometry, signature, freshness, fraud; signed votes either way | Trusting client-supplied triangle IDs |
| Contracts | `contracts/src` | Final economic truth: quorum verification, slots/curve, twin, escrow, freezes, pauses, replay | Seeing coordinates (PRV-001) |
| Evidence vault | `services/proof-storage` | Encrypted bundles, kubo-compatible CIDs, key-destruction deletion | Serving raw evidence publicly |
| Indexer | `services/indexer` | Rebuildable projection of events; explorer REST | Being a source of truth |
| Web apps | `apps/web`, `merchant-dashboard`, `protocol-admin` | UX for public/merchants/foundation | Holding user keys |

## 3. Cross-language determinism (the architecture's spine)

One geometry implementation (Rust `mesh-engine`, ADR-004) serves every consumer: natively in validators, via HTTP mesh API for TS/web/merchant-api, golden vectors for conformance (WASM + Swift FFI bindings are the MVP path). One canonical claim byte-format (`STEP-CLAIM-V1`) and one EIP-712 vote scheme are implemented three times (Rust/TS/Swift) and pinned to each other by a committed vector — including exact RFC-6979 signature reproduction — and proven end-to-end by `tests/e2e` against deployed contracts.

## 4. Trust boundaries

1. **Client → validators:** untrusted. Everything recomputed; integrity mode (`attested`/`dev-unattested`) is explicit and policy-gated (ADR-015).
2. **Validators → chain:** trust is weighted and quorum-gated (VAL-002); the contract re-verifies every signature against the on-chain registry and rejects duplicates/unsorted sets.
3. **Gateway:** availability/ordering trust only — it cannot forge claims (miner signatures), votes (validator signatures), or outcomes (contract re-checks). Worst case: censorship, mitigated post-alpha by P2P propagation.
4. **Foundation roles:** powerful but fully evented (freezes, pauses, treasury, params with timelock) for public review.

## 5. Data-flow privacy budget

Coordinates appear in exactly three places: device memory, validator request bodies (TLS, logged as hashes only), encrypted evidence bundles. On-chain and in the indexer/explorer: hashes, amounts, statuses. See [privacy doc](../privacy/STEP_privacy_and_location_data.md).
