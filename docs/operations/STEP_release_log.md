# STEP Release Log

## alpha-0.6 — 2026-06-27 (canonical mesh globe)

- **Canonical mining map:** the production web app now renders Earth, the full level-1 spherical icosahedron mesh, the GPS-locked mining triangle, and inspected triangles on one MapLibre GL JS v5 globe.
- **Globe mesh layer:** added `step-globe-mesh-custom`, a custom WebGL layer that sends STEP mesh geometry through MapLibre's `projectTile(a_pos)` globe shader path instead of drawing flat overlay lines.
- **Mobile parity:** the iOS Map tab now embeds the same map-only production globe through `WKWebView` using `StepConfig.WebAppURL` / `STEP_WEB_APP_URL`; MapLibre Native was removed from the Swift package so iOS uses the same visual SSOT and avoids binary-artifact package stalls.
- **TestFlight account fix:** iOS build `0.1.0 (4)` fetched account-api KDF params on fresh-device sign-in before deriving the verifier locally, so existing accounts can sign in without pre-existing local cache.
- **TestFlight launch-crash fix:** iOS build `0.1.0 (5)` fixes the build `4` startup crash caused by an empty bundled `StepConfig.WebAppURL` being force-unwrapped. The app now treats blank URL config values as unset and falls back safely, and the App Store build explicitly sets `STEP_WEB_APP_URL=https://step.moldovancsaba.workers.dev/?surface=ios-map`. Build `5` is uploaded, processed `VALID`, attached to `Friendly Pilot`, approved for external beta, and `IN_BETA_TESTING`.
- **Public map-only surface:** `https://step.moldovancsaba.workers.dev/?surface=ios-map` opens the mesh globe directly without the account login wall.
- **Documentation:** canonical behavior is specified in [`../engineering/STEP_mesh_globe_visual_ssot.md`](../engineering/STEP_mesh_globe_visual_ssot.md).

## alpha-0.5 — 2026-06-21 (self-sovereign trust centers — M8 + M9)

Hardened, self-maintaining trust centers (M8, #34–#47) and reliable, **third-party-free** operation that moves materially toward the P2P/DAO end-state (M9, #48–#57). All landed CI-green on `feat/v2-mining-nfts`. Decisions recorded as ADR-018…ADR-022; architecture in [STEP_local_node_and_trust_federation.md](../architecture/STEP_local_node_and_trust_federation.md) §7; operations in [STEP_trust_center_runbook.md](STEP_trust_center_runbook.md).

- **On-chain trust layer (M8):** `ReleaseRegistry` (authorized release hashes, weighted rollout/revoke) + `IntegrityAttestation` (tamper → quorum auto-suspend) behind a `TimelockController`; `step-node-agent` self-updates from chain with hash-verified artifacts, functional canary, **failsafe rollback**, continuous self-integrity, and keychain secrets isolation; release pipeline + artifact distribution + launchd/systemd service; `fleet-api` + GDS Fleet console.
- **Third-party-free operation (M9 #48/#49/#53):** LAN/mDNS or self-hosted WireGuard transport (no SaaS); one-command `onboard.mjs`; boot-persistent service.
- **Resilience (M9 #51/#52):** hub-outage tolerance (keep-running, backoff, `degraded` status); multi-source hash-verified artifacts.
- **Signed fleet heartbeats (M9 #56):** node-key-signed, verified against the registered on-chain address (anti-spoof); four-state view (up/degraded/suspended/dark) + deduped, rate-limited alerts.
- **DAO governance (M9 #55):** `StepGovernor` (audited OZ Governor) + `StepGovToken` (ERC20Votes) govern RELEASE/PARAM/VALIDATOR_ADMIN roles through the timelock — privileged actions execute only after an on-chain vote, no admin key.
- **P2P gossip (M9 #54):** `step-gossip-node` (libp2p gossipsub) — claim/vote propagation + peer weighted-quorum assembly; no central gateway in the finalise path; identity = validator secp256k1 key; discovery = mDNS + self-hosted bootstrap.
- **Trust-minimised reads (M9 #50, partial):** RPC failover + multi-endpoint read agreement (a lone divergent chain node is outvoted, not trusted). Full replicated-ledger migration remains the open infra track on #50.
- **Verification:** full CI gate green by real exit codes before every push (`cargo fmt`/`clippy -D warnings`/`test --workspace`, `pnpm typecheck`/`test`/`build`, `forge test` 83, gitleaks v8.21.2 0 leaks). New Rust tests: node-agent 33, gossip-node 32; fleet-api 30; contracts +3 (StepGovernor).

## alpha-0.4 — 2026-06-16 (reference normalization pass)

- Aligned denominator and reward-curve text in all published tokenomics/contract-adjacent docs:
  - `docs/tokenomics/STEP_tokenomics_constitution.md` now uses `1 STEP = 67,108,864 Trinity` as the canonical working ratio.
  - Development playbook now includes a file-by-file contract-doc-service update sequence in `docs/engineering/STEP_development_plan.md`.
  - Exchange service conversion tests (`services/exchange-service/test/credits.test.ts`) updated to the same denominator.
- Clarified operator onboarding docs:
  - `README.md` now documents the `/explorer/mesh` route and wallet import/export behavior.
  - `docs/product/STEP_product_specification.md` now states the concrete wallet recovery path and map route.
- No protocol-contract behavior change in this release; only reference and operator-use guidance, plus assertion fixtures/comments for consistency.

## alpha-0.3 — 2026-06-14 (usable without Apple — browser miner)

- **`apps/web-miner`**: a browser-based miner so anyone with a phone browser can use the platform — no Apple, no TestFlight. The browser generates a self-custody wallet, reads geolocation, and signs the canonical claim locally (`@step/proof-protocol`); same-origin `/api` routes proxy to the gateway/mesh/chain (no CORS). **Verified end-to-end against the live stack — a browser-path claim finalised on-chain and received the base reward.**
- Wired into the deploy compose (`:3003`) and the go-live runbook as the primary "let people use it" path. Sandbox uses `dev-unattested` claims (validators `allow_dev_claims=true`); the attested iPhone pilot path is unchanged.
- `Dockerfile.web` now uses an exact `./apps/<APP>` path filter. All 7 CI jobs green on `main`.

## alpha-0.2 — 2026-06-13 (go-live enablement)

Pushed to GitHub (`moldovancsaba/step`, PR #1 into `main`). Adds the deployable/operable layer on top of alpha-0.1:

- **One-command native pilot bring-up** (`scripts/dev/up.mjs` / `down.mjs` / `smoke.mjs`): launches the full backend stack and verifies it end-to-end. **Verified on the build machine — smoke 17/17.**
- **Container artifacts**: multi-stage Rust Dockerfile, parameterised TS-service and Next.js Dockerfiles, and `infra/deployment/docker-compose.deploy.yml` (full pilot stack with idempotent contract deploy + validator registration) + `.env.deploy.example`. Authored for the pilot host; not boot-verified here (no Docker daemon).
- **Validator** now resolves the verifier address from `STEP_DEPLOYMENTS_FILE` (container-friendly).
- **CI green on GitHub runners**: fixed all jobs (rust fmt, ajv-formats schema validation, filesystem gitleaks scan, web `--passWithNoTests`); added dedicated `e2e` (full-stack, passed on a fresh runner) and `swift` (macOS/Xcode 16) jobs; cargo network-retry + cache hardening. Untracked the per-env `contracts/deployments/31337.json` artifact.
- **[Go-live runbook](STEP_go_live_runbook.md)**: native + container bring-up, required pilot config changes, and the binding go-live checklist separating in-repo engineering items from external gates (audit/legal/Apple/mainnet).

CI status at push: contracts, e2e, web, schemas, secrets green; rust/swift fixes applied for environmental issues (transient crates.io reset; runner Xcode version).

## alpha-0.1 — 2026-06-12 (initial engineering delivery)

**Commits:** `3965476` docs baseline → `e5dc9a8` M0 → `843f14a` M1 mesh → `561c7b5` M3 contracts → `e2964dd` M4 validators → M2/M4 services → E2E green → M5 web apps → iOS StepCore → this documentation set.

### Verified in this release (all on the build machine, macOS/arm64)

- **126 automated tests passing across 5 toolchains:** Rust 48 (mesh 18 + validation/node 30, clippy -D warnings clean) · Solidity 31 (incl. 512-run fuzz + supply invariants) · TypeScript 39 (incl. cross-language conformance) · Swift 8 (incl. exact Rust-signature reproduction) · **E2E 5/5 on real components** (anvil + deployed contracts + 3 release-build Rust validators + gateway): natural mint+twin, teleport fraud rejection, nonce replay rejection, contract-enforced freeze, sponsored supply conservation.
- Live Anvil deployment via `script/Deploy.s.sol`; address book committed.
- Three Next.js apps `next build` green; `pnpm -r typecheck` 0 errors.
- One genuine protocol bug found by E2E and fixed with regression coverage: same-second teleport evaded fraud scoring (dt==0 branch).

### Known gaps (complete list — nothing hidden)

| Gap | Why | Tracked |
|---|---|---|
| Docker Compose never booted | no Docker daemon on build machine | verify on Docker host; CI job exists |
| CI workflows authored but never executed | no GitHub remote configured | push + first run |
| No `git push` (DoD item) | no `origin` remote exists | owner to provide remote |
| Xcode app target / TestFlight | CLT-only machine, no Apple accounts | apps/ios/README steps |
| App Attest server-side verification | needs Apple endpoints + app target | pilot blocker for `attested` claims |
| MapLibre Native iOS basemap | app-target integration | native triangle rendering shipped meanwhile |
| Postgres/PostGIS backends | memory stores are pilot-scale honest; interfaces ready | public-testnet stage |
| libp2p gossip live path | ADR-005 alpha topology is gateway-mediated by design | MVP |
| Slither/Echidna runs | not executed in this environment | CI + pre-audit |
| Contract audit | external | blocks any non-testnet deploy (SC-007) |
| Multisig for admin/treasurer | env keys in alpha | pre-pilot |
| Map-based triangle selector, pricing engine, invoicing | alpha cuts per scope | MVP/V1 |
| Field tests F1–F9, pilot city/merchants | physical world + business decisions | M6 external |
| Tokenomics ratification + MESH audit | owner decisions OPEN-1/2/3/8 + MESH-014 | blocks public numbers |
| Legal gates L1–L12 | external counsel | risk register |
| OSM tile self-hosting (explorer uses demo style) | infra task | pilot |

### Parameter freeze status

`step-mesh-v1` FROZEN (incl. rotation constant 0°, OPEN-10 resolved). All economic values UNFROZEN in `config/protocol-params.alpha.json`.
