# STEP

**Proof-of-location / proof-of-presence blockchain system on a spherical triangular MESH of the Earth.**

STEP divides the Earth into a deterministic hierarchy of spherical triangles (the MESH). A miner mines by **physically visiting or touching any valid part of a mineable triangle** and submitting a verifiable, signed proof-of-presence. The smallest blockchain unit is **Trinity**. Businesses buy Trinity and place it into stores, front doors, venues, and points of interest — creating **Trinity oases** that attract verified real-world visitors. Heavily-mined areas become **Trinity deserts** until re-seeded by sponsored campaigns.

STEP is **not** a walking app, not a fitness app, and not move-to-earn. Step counts, health-app data, and distance are never protocol inputs. The only protocol question is:

> Was this miner physically present inside this spherical triangle at this time?

## Repository layout

| Path | Contents |
|---|---|
| `apps/ios` | Native Swift/SwiftUI miner app (Apple-first; attested pilot) |
| `apps/web-miner` | Browser miner (geolocation + in-browser wallet) — usable on any phone browser, no Apple needed |
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
```

## Start the alpha stack locally

```sh
# 1) install dependencies
pnpm install

# 2) start everything (backend + all web experiences) in one terminal
pnpm dev:full-stack

# 3) optional: run only backend first, then launch frontends in separate terminals
node scripts/dev/up.mjs

# 3) in separate terminals, run the apps
GATEWAY_URL=http://127.0.0.1:8080 \
MESH_API_URL=http://127.0.0.1:9101 \
STEP_RPC_URL=http://127.0.0.1:8545 \
STEP_DEPLOYMENTS_FILE=$PWD/contracts/deployments/31337.json \
pnpm --filter @step/web-miner dev

pnpm --filter @step/static-frontend dev
pnpm --filter @step/web-explorer dev
```

For non-sandbox online webapp checks, run:

```sh
pnpm start:non-sandbox-webapp
```

Open:
- `http://127.0.0.1:3003` for browser mining (device-local wallet)
- `http://127.0.0.1:3000` for mesh map explorer
- `http://127.0.0.1:3010` for static launcher with links into full web products

For the static launcher, use `http://127.0.0.1:3010/explorer/mesh` when you want the visible triangle map.

The static frontend can be used at `http://127.0.0.1:3010`; in Settings you can set:
- Explorer URL (default non-sandbox app entry, e.g. `/explorer`)
- Miner URL (default non-sandbox app entry, e.g. `/miner`)

Wallet workflow in web frontend:
- Create a new wallet in Settings or import from a downloaded wallet file / private key.
- Export wallet file from Settings to back up identity.
- Paste the same private key on another device to restore that wallet and load it into that browser session.

For a single-host public deployment, route `/explorer/*` and `/miner/*` through the online gateway
to the web explorer (`apps/web`) and web miner (`apps/web-miner`) services.

If you use the Cloudflare Worker deployment, set:
- `STEP_BACKEND_GATEWAY_URL` (for `https://.../api/gateway` on your backend host, e.g. `https://step-api.example.com/api/gateway`)
- `STEP_BACKEND_INDEXER_URL` (for `https://.../api/indexer` on your backend host, e.g. `https://step-api.example.com/api/indexer`)
- `STEP_WEB_EXPLORER_URL` (example: `https://step-explorer.example.com`)
- `STEP_WEB_MINER_URL` (example: `https://step-miner.example.com`)

For a real non-sandbox launch, these backend URLs must be publicly reachable HTTPS URLs.
`127.0.0.1` / `localhost` is valid only for local-machine testing and will fail for remote users.

Store `STEP_BACKEND_GATEWAY_URL` and `STEP_BACKEND_INDEXER_URL` as GitHub repository Variables
(Settings → Actions → Variables). Workflow deployment uses those values when deploying Cloudflare Worker.

For one-command local worker deploy with real endpoints:

```sh
cp .env.example .env
# fill in your real values
source .env
pnpm --dir apps/static-frontend build
pnpm --dir apps/static-frontend deploy:cloudflare-worker
```

For a single `workers.dev` launcher, the static app can keep `gatewayUrl` and `indexerUrl`
on `/api/gateway` and `/api/indexer`; set only `STEP_BACKEND_*` and the optional
`STEP_WEB_*` bindings in the Worker environment.

If you use `services/online-gateway`, set:
- `STEP_EXPLORER_URL` (example: `http://127.0.0.1:3000`)
- `STEP_MINER_URL` (example: `http://127.0.0.1:3003`)

## Full local stack (requires Docker)
docker compose -f infra/docker/docker-compose.yml up

## Protocol parameters

Economic constants (Trinity denomination, collector slots, reward curve, foundation twin rate) are **UNFROZEN protocol parameters**, not decided values. They live in [`config/protocol-params.alpha.json`](config/protocol-params.alpha.json) and are pending the tokenomics constitution. No code may hardcode them.

### Triangle IDs & mine progression (Mesh ID v2)

Triangle IDs are **dotted, 1-indexed paths** — `face(1–20).child(1–4)…` — where
the level is the number of segments (`1` = a level-1 face, `1.2` = level 2,
`3.2.3.4.3.2` = level 6). A mined **slot/NFT** appends the slot index `1–27` as
the final segment: `1.1` is face 1, slot 1 (the first mine on a virgin mesh).
Shorter id ⇒ larger triangle. Canonical spec: [`docs/geography/STEP_mesh_id_v2.md`](docs/geography/STEP_mesh_id_v2.md).

Mine progression: a virgin mesh is the 20 level-1 faces; mining hands out a
triangle's **27 slots in order (1→27), one slot per wallet per triangle**. When
all 27 are taken the triangle **breaks down into its 4 children** (next finer
level) and mining continues there. A triangle is mineable only once its parent
is exhausted, so first-time mining at a fresh location is at **level 1**. **Level
21 is terminal** — a fully-mined level-21 triangle is a permanent desert until a
merchant re-seeds it.

## Status

Pre-alpha. Testnet only. No exchange, no fiat, no public mining. See [alpha scope](docs/operations/STEP_alpha_scope.md) for the binding IN/OUT list.

## License

Apache-2.0 (open-source-first policy; see ADR log).
