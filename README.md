# STEP

**Proof-of-location / proof-of-presence blockchain system on a spherical triangular MESH of the Earth.**

STEP divides the Earth into a deterministic hierarchy of spherical triangles (the MESH). A miner mines by **physically visiting or touching any valid part of a mineable triangle** and submitting a verifiable, signed proof-of-presence. The smallest blockchain unit is **Trinity**. Businesses buy Trinity and place it into stores, front doors, venues, and points of interest — creating **Trinity oases** that attract verified real-world visitors. Heavily-mined areas become **Trinity deserts** until re-seeded by sponsored campaigns.

STEP is **not** a walking app, not a fitness app, and not move-to-earn. Step counts, health-app data, and distance are never protocol inputs. The only protocol question is:

> Was this miner physically present inside this spherical triangle at this time?

## Repository layout

| Path | Contents |
|---|---|
| `apps/ios` | Native Swift/SwiftUI miner app (Apple-first) |
| `apps/web` | Public explorer (Next.js + MapLibre GL JS) |
| `apps/merchant-dashboard` | Merchant campaign tools |
| `apps/protocol-admin` | Foundation admin / safety console |
| `packages/mesh-engine` | **Canonical Rust MESH engine** (geometry, triangle IDs, containment) + bindings |
| `packages/proof-protocol` | Claim/evidence schemas and signing logic |
| `packages/shared-types` | Cross-language types generated from schemas/ABIs |
| `packages/wallet-core` | Wallet primitives |
| `packages/api-client` | Typed API client (OpenAPI-derived) |
| `packages/validation-rules` | Deterministic claim validation checks (Rust) |
| `packages/schemas` | Versioned JSON Schemas (`step.proof.location.v1`, …) |
| `contracts/` | Solidity contracts (Foundry) |
| `services/validator-node` | Rust validator node |
| `services/gateway-api` | Claim intake + nonce challenge (alpha topology, ADR-005) |
| `services/indexer` | Chain events → PostgreSQL |
| `services/merchant-api` | POI/campaign CRUD |
| `services/proof-storage` | Encrypted evidence bundles → IPFS |
| `services/exchange-service` | Closed campaign-credit accounting (no market in alpha) |
| `services/campaign-worker` | Expiry/refund/retention background jobs |
| `docs/` | Product, architecture, tokenomics, protocol, legal-risk, operations documentation |
| `infra/` | Docker Compose, internal testnet, deployment |
| `tests/` | E2E scenarios, simulations, field-test procedures |

## Controlling documents

Engineering starts from these committed documents:

- [Requirements matrix](docs/engineering/STEP_requirements_matrix.md) — every requirement, sourced and classified
- [Delivery roadmap](docs/engineering/STEP_delivery_roadmap.md) — milestones M0–M6
- [Architecture decision records](docs/engineering/STEP_architecture_decision_records.md) — all decisions incl. OPEN ones
- [Alpha scope](docs/operations/STEP_alpha_scope.md) — hard IN/OUT boundary
- [Test plan](docs/engineering/STEP_test_plan.md)

## Quick start (development)

Prerequisites: Rust (stable), Foundry, Node 22 + pnpm, Xcode 16+ (iOS app only), Docker (full local stack only).

```sh
# Rust workspace: mesh engine + validation rules + validator node
cargo test --workspace

# Contracts
cd contracts && forge test

# TypeScript workspace
pnpm install && pnpm -r test

# Full local stack (requires Docker)
docker compose -f infra/docker/docker-compose.yml up
```

## Protocol parameters

Economic constants (Trinity denomination, collector slots, reward curve, foundation twin rate, mineable level) are **UNFROZEN protocol parameters**, not decided values. They live in [`config/protocol-params.alpha.json`](config/protocol-params.alpha.json) and are pending the tokenomics constitution. No code may hardcode them.

## Status

Pre-alpha. Testnet only. No exchange, no fiat, no public mining. See [alpha scope](docs/operations/STEP_alpha_scope.md) for the binding IN/OUT list.

## License

Apache-2.0 (open-source-first policy; see ADR log).
