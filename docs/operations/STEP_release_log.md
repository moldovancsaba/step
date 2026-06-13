# STEP Release Log

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
