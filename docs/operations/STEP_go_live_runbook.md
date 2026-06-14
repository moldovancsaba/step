# STEP Go-Live Runbook

**Version:** 0.1 · **Date:** 2026-06-13 · Audience: foundation operations.

## 0. What "go live" means for STEP

The source documents bind "live" for this phase to a **controlled alpha pilot on an internal testnet** — NOT a production token economy. The following are forbidden until their external gates clear (HARD §12.5, ADR-011, SC-007): mainnet deployment, any fiat path, public/open trading, open validator registration, public global mining, and unaudited production contracts. "Go live" here therefore means: **stand up the pilot stack so an invited iPhone miner can mine a triangle, validators verify, contracts finalise on the internal testnet, and a pilot merchant funds a Trinity oasis that pays verified visits** — and do so with monitoring, safety controls, and incident response in place.

This runbook gives two bring-up paths (native, container) and the binding go-live checklist.

## 1. Native bring-up (verified, fastest for a single host)

Prerequisites: Rust (stable), Foundry, Node 22 + pnpm. From repo root:

```sh
pnpm install
node scripts/dev/up.mjs      # anvil → deploy → register validators → all services
node scripts/dev/smoke.mjs   # end-to-end verification of the RUNNING stack
node scripts/dev/down.mjs     # stop everything
```

`up.mjs` generates per-run secrets into `.runtime/.env.runtime`, writes pidfiles and per-service logs under `.runtime/logs/`, and prints the service URLs. `smoke.mjs` asserts all health endpoints, a full natural-mining flow (mesh resolve → signed claim → quorum → on-chain mint + twin → indexer), merchant onboarding + rotating QR, and closed campaign-credit conversion. **This path is verified on the build machine — smoke passes 17/17.**

Web apps (separate terminals). The **web miner** is the Apple-independent way to
actually use the platform — anyone with a phone browser can mine:
```sh
# Browser miner (:3003) — geolocation + in-browser wallet + signed claim.
# Its server-side /api routes proxy to the stack, so no CORS setup is needed.
GATEWAY_URL=http://127.0.0.1:8080 MESH_API_URL=http://127.0.0.1:9101 \
STEP_RPC_URL=http://127.0.0.1:8545 STEP_DEPLOYMENTS_FILE=$PWD/contracts/deployments/31337.json \
  pnpm --filter @step/web-miner dev

pnpm --filter @step/web-explorer dev          # :3000  explorer
pnpm --filter @step/merchant-dashboard dev     # :3001  merchant
pnpm --filter @step/protocol-admin dev          # :3002  admin
# explorer/merchant: point NEXT_PUBLIC_INDEXER_URL / NEXT_PUBLIC_MESH_API_URL at the stack
```

> The web miner submits `dev-unattested` claims, so the validators must run with
> `VALIDATOR_ALLOW_DEV_CLAIMS=true` (the native `up.mjs` does this; pilot/compose
> validators set it false and expect App Attest from the iOS app). Use the web
> miner for the open sandbox; use the iPhone app for the attested pilot.

## 2. Container bring-up (the pilot host)

```sh
cp infra/deployment/.env.deploy.example infra/deployment/.env.deploy
# generate fresh secrets:  openssl rand -hex 24   (and -hex 32 for EVIDENCE_MASTER_KEY)
# set VALIDATOR_*_KEY + VALIDATOR_ADDRS, passwords, public URLs
docker compose -f infra/deployment/docker-compose.deploy.yml \
  --env-file infra/deployment/.env.deploy up -d --build
```

Brings up chain, one-shot contract deploy + validator registration, 3 validators (`allow_dev_claims=false`), backend services, the 3 web apps, and PostGIS/IPFS/Redis/observability. **Status: authored, not yet boot-verified (the build machine had no Docker daemon).** First action on a Docker host: `docker compose ... up -d --build` then run the smoke test against the exposed gateway/indexer/mesh URLs. The wiring mirrors the verified native path exactly.

## 3. Configuration that MUST change for a real pilot

| Item | Default (dev) | Required for pilot |
|---|---|---|
| Validator `VALIDATOR_ALLOW_DEV_CLAIMS` | true (native dev) | **false** (compose already sets this) |
| Chain accounts | Anvil well-known keys | fresh keys; admin/treasurer behind multisig |
| `STEP_PARAM_DELAY` | 0 (native dev) | ≥ 86400 (timelock real) |
| Secrets (nonce/QR/foundation/evidence) | generated per run | provisioned, rotated, stored in a secret manager |
| Evidence master key | env | managed KMS |
| Reverse proxy / TLS | none | terminate TLS; only expose gateway, indexer, mesh-read, web |
| Tile source (explorer) | MapLibre demo style | self-hosted OSM tiles for the pilot area |

## 4. Binding go-live checklist

**Engineering (in this repo, do before pilot):**
- [ ] Container stack boots on the host and smoke passes
- [ ] Postgres-backed indexer + operational stores (interfaces exist; swap memory backends)
- [ ] Multisig on `AccessController` admin + `TREASURER_ROLE`
- [ ] Slither + Echidna runs clean in CI
- [ ] iOS: Xcode app target, App Attest **server-side verification** wired into the gateway/validator (the one security-critical missing proof input — see `apps/ios/README.md`)
- [ ] Safety registry seeded with the pilot area's restricted triangles; freeze drill executed (see incident response)

**External gates (cannot be satisfied in-repo — owner/counsel/Apple):**
- [ ] Smart-contract audit (SC-007 blocks any non-testnet deploy)
- [ ] Tokenomics constitution ratified (OPEN-1/2/3/8 + independent MESH math audit, MESH-014)
- [ ] Legal: PIA + consumer terms + merchant agreement + app-store crypto review (legal risk register L4/L6/L7/L8)
- [ ] Apple Developer Program + TestFlight distribution
- [ ] Pilot city + 3–10 merchants selected (OPEN-7)
- [ ] Field tests F1–F9 executed on physical iPhones

**Production (explicitly later, not "alpha go-live"):** mainnet/L2 chain selection, exchange phases 2–3 after CASP/legal sign-off, open validator registration, DAO governance.

## 5. Operating the live pilot

- **Monitoring:** Prometheus scrapes validator `/metrics` (claims/approved/rejected/rate-limited/nonce-replays); Grafana at `:3009`. Watch claim acceptance rate, fraud-rejection rate, validation latency.
- **Safety/incidents:** see [incident response](STEP_incident_response.md) — domain pause (`PAUSE_MINTING`/`PAUSE_CAMPAIGNS`), reason-coded triangle freeze, validator suspension; all evented and publicly reviewable. Run the drills in §3 of that doc before opening to miners.
- **Transparency:** the explorer `/treasury`, `/validators`, and triangle/claim pages are the public record; every foundation action is on-chain.
- **Privacy:** no raw GPS leaves the proof path; evidence deletion = key destruction; PIA must be signed before storing pilot evidence at scale.

## 6. Exit to MVP

The pilot ends with the alpha report (KPIs in `STEP_alpha_scope.md` §5). MVP go/no-go requires: hard criteria met, no open critical security findings, tokenomics constitution drafted→ratified, and the next-phase legal gates engaged with counsel.
