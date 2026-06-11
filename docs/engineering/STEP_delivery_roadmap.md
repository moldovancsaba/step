# STEP Delivery Roadmap

**Version:** 0.1
**Date:** 2026-06-11
**Status:** Engineering delivery plan for the controlled alpha, derived from DEV §22 (milestone backlog), DEV §25 (development order), SYS §24 (alpha/MVP/V1/mature), and HARD §17 (alpha scope hardening)
**Target:** A working, documented, testable STEP alpha — an iPhone user detects their spherical triangle, submits a signed proof-of-presence, the claim is validated by a controlled validator quorum, Trinity is received on a testnet ledger, and a real merchant-funded Trinity oasis produces verified visits.

---

## 0. Roadmap principles

1. **MESH first.** Everything maps to triangle IDs; nothing useful can be built before deterministic geometry exists (DEV §25).
2. **One vertical slice early.** The first end-to-end claim (device → validator → contract → indexer → explorer) matters more than breadth.
3. **Unfrozen economics are configurable parameters,** never hardcoded assumptions (master prompt §6.3; requirements matrix §18).
4. **Legal gates are roadmap items,** not afterthoughts (HARD §12.4).
5. **Every milestone ends with: tests passing, docs updated, commit, release-log entry** (Definition of Done, master prompt §3).
6. **Nothing labelled "exchange," "cash-out," or "token sale" is built in alpha** beyond the closed campaign-credit model (HARD §12.5).

---

## 1. Phase overview

| Phase | Goal (verbatim intent from sources) | Exit proof |
|---|---|---|
| **M0 Foundations** | Repo, docs, skeletons, local env, CI | `docker compose up` brings up full local stack; CI green on all skeletons |
| **M1 MESH + map** | Deterministic geometry on all platforms | Same coordinate → same triangle ID in Rust, Swift, WASM; triangle renders on iOS and web map |
| **M2 Wallet + claims** | Signed claim from iPhone | Claim signed on device, accepted by local validator, status visible in app |
| **M3 Contracts** | Testnet finality | Claim finalised on Anvil: Trinity minted to miner, twin to treasury, events indexed |
| **M4 Validator node** | Real validation pipeline | Validator independently validates containment/nonce/timestamp, signs, submits on-chain; metrics exported |
| **M5 Merchant oasis** | Sponsored reward loop | Merchant campaign funded on testnet, QR proof, sponsored Trinity released, dashboard shows verified visit |
| **M6 Alpha pilot** | Controlled real-world pilot | TestFlight build, pilot city area, 3–10 merchants, 100–500 invited miners, field tests passed, alpha report |

Post-alpha phases (MVP, V1, mature) are summarised in §4 and are out of delivery scope for this roadmap.

---

## 2. Milestone detail

### M0 — Foundations

Deliverables (DEV §22 Milestone 0, adapted to the master-prompt repo layout — see ADR-001):

| # | Work item | Output |
|---|---|---|
| 0.1 | Repository + git + LICENSE + root README | Committed monorepo skeleton |
| 0.2 | Documentation tree under `docs/` (this set of five documents plus structure for the §4.2 master-prompt doc list) | Living docs |
| 0.3 | `packages/mesh-engine` Rust crate skeleton (canonical `mesh-core`) | Builds + empty test suite |
| 0.4 | `contracts/` Foundry skeleton with OpenZeppelin | `forge build` + `forge test` green |
| 0.5 | `apps/ios/` Swift/SwiftUI app skeleton with module layout per DEV §6.2 | Builds in Xcode, unit test target runs |
| 0.6 | `apps/web/` (explorer), `apps/merchant-dashboard/`, `apps/protocol-admin/` Next.js skeletons | Build + typecheck green |
| 0.7 | `infra/docker/` Compose: PostgreSQL+PostGIS, IPFS, Anvil, Prometheus, Grafana, Loki + service stubs | One-command local environment |
| 0.8 | CI pipeline: Rust fmt/clippy/test, forge build/test, web typecheck/lint/test, gitleaks, docs lint | Green pipeline |
| 0.9 | `packages/shared-types` + versioned JSON Schemas for claim and evidence bundle (`step.proof.location.v1`, `step.evidence.bundle.v1`) | Schema validation in CI |
| 0.10 | Config system: `.env.local/.testnet/.alpha`, config groups per DEV §19.3, protocol-parameter registry for unfrozen constants | No hardcoded parameters anywhere |

Gate to M1: CI green; local stack boots; protocol-parameter registry documents every unfrozen constant.

### M1 — MESH and map

| # | Work item | Output |
|---|---|---|
| 1.1 | Freeze MESH v1 spec for alpha: icosahedron orientation, great-circle edges, base-4 ID encoding, tolerances, antimeridian/pole policy (ADR-002) | `docs/geography/STEP_mesh_mathematics.md` v1 |
| 1.2 | Implement subdivision, triangle ID, `latLonToTriangle`, `containsPoint`, parent/children/neighbours, centroid, area in `mesh-engine` (Rust) | Passing unit + property tests |
| 1.3 | Golden test vectors (known coordinates → IDs), boundary tests, pole tests, antimeridian tests, precision tests | Committed test-vector file shared by all platforms |
| 1.4 | UniFFI/C FFI binding → Swift XCFramework; wasm-pack build → web | Cross-language golden tests pass identically |
| 1.5 | `boundaryPolicy(lat, lon, accuracy)` with deterministic tie-break (MESH-007/008) | Tested boundary behaviour |
| 1.6 | iOS: render current triangle on MapLibre Native with state colours | Manual verification steps documented |
| 1.7 | Web explorer: MESH overlay on MapLibre GL JS | `/mesh` page renders pilot area |
| 1.8 | Independent mathematical audit checklist for supply maths started (MESH-014 — external, runs in parallel) | Audit brief document |

Gate to M2: same coordinate produces same triangle ID in Rust, Swift, and WASM in CI.

### M2 — Wallet and claims

| # | Work item | Output |
|---|---|---|
| 2.1 | iOS wallet: secp256k1 keypair, Keychain/Secure Enclave storage, create/import flows | Wallet unit tests; security note |
| 2.2 | Claim builder: claim object per POP-002, EIP-712 typed signing | Signed claim verifiable off-device |
| 2.3 | Nonce challenge service (gateway in alpha — ADR-005) with TTL + one-time use | Replay tests |
| 2.4 | App Attest integration scaffolding (real attestation on device, structured mock flag in simulator, never in production builds) | Attestation evidence in claim |
| 2.5 | Local claim history (SQLite/GRDB), claim status screen (Draft→…→Finalised states per MIN-006) | UI tests |
| 2.6 | Gateway API (`services/`) accepting claims, OpenAPI spec, typed client in `packages/api-client` | Contract-tested API |
| 2.7 | Encrypted evidence bundle creation + IPFS upload + CID handling | Privacy test: no raw GPS leaves device unencrypted |

Gate to M3: claim created on real iPhone, signed, submitted, stored as encrypted bundle with CID; status visible in app.

### M3 — Smart contracts

| # | Work item | Output |
|---|---|---|
| 3.1 | `TrinityToken` (ERC-20 style, indivisible base unit, mint restricted to verifier) | Unit + invariant tests (no sub-Trinity, supply accounting) |
| 3.2 | `MeshRegistry` (mesh version, active levels, ID scheme commitment) | Tests |
| 3.3 | `TriangleMiningState` (slots, cooldown, opening delay, exhaustion, status) with parameterised slot count + reward curve | Tests incl. reward-curve ≥1 Trinity invariant |
| 3.4 | `MiningClaimVerifier` (EIP-712 claim digest, validator signature set verification, weighted threshold) | Fuzz + unit tests |
| 3.5 | `FoundationTreasury` (twin allocation at configurable rate, public address, event log) | Tests: twin minted on every natural mint |
| 3.6 | `ProofRegistry` (claim hash → proof CID hash) | Tests |
| 3.7 | `ValidatorRegistry` (types, weights, status; staking interface stubbed for alpha) | Tests |
| 3.8 | `SafetyRegistry` + `AccessController` (roles, emergency pause, triangle freeze) | Pause/freeze tests |
| 3.9 | Foundry deploy scripts for Anvil + internal testnet; deployments recorded in `contracts/deployments/` | Reproducible deployment |
| 3.10 | Slither clean run + fuzz suite in CI | Static analysis gate |

Gate to M4: end-to-end on Anvil — submitted claim with simulated validator signatures mints Trinity to miner and twin to treasury, emits all required events.

### M4 — Validator node

| # | Work item | Output |
|---|---|---|
| 4.1 | Rust validator node skeleton (`services/validator-node`): config (TOML), keys, storage | Boots in Compose |
| 4.2 | Claim intake (HTTP from gateway in alpha; libp2p gossip behind feature flag — ADR-005) | Integration tests |
| 4.3 | Validation pipeline: format → signature → nonce/timestamp → containment (via mesh-engine) → accuracy → triangle state → risk checks | Deterministic validation tests |
| 4.4 | Fraud checks v1: speed threshold, teleport detection vs previous accepted claim, duplicate detection, rate limits | Fraud simulation tests |
| 4.5 | Vote signing, weighted quorum aggregation, on-chain submission via relayer key | Quorum tests incl. malicious-peer simulation |
| 4.6 | Reputation state (local), penalty hooks (suspend/remove; stake slashing interface for later) | Tests |
| 4.7 | Prometheus metrics + OTel structured logs (no raw GPS in logs) | Grafana dashboard |
| 4.8 | Indexer (`services/indexer`): chain events → PostgreSQL; triangle/claim/campaign/treasury entities; explorer reads from it | Indexed entities match chain state in tests |

Gate to M5: full vertical slice — iPhone claim → gateway → 3 foundation validators → quorum → on-chain finality → indexer → claim visible in explorer.

### M5 — Merchant oasis

| # | Work item | Output |
|---|---|---|
| 5.1 | `CampaignRegistry` + `RewardPool` contracts (pre-funding, lock, release-on-proof, expiry, refund policy, per-wallet limits) | Campaign lifecycle tests incl. budget/refund/expiry |
| 5.2 | Merchant dashboard: onboarding (admin-approved), POI creation, triangle selector on map, front-door campaign builder, funding via closed campaign credits | E2E Playwright flow |
| 5.3 | Merchant API (`services/`): POI/campaign CRUD, PostGIS-backed POI→triangle mapping | API tests |
| 5.4 | QR merchant proof: rotating QR generation, scan validation in iOS app, L4 proof path in validator | Field-testable QR flow |
| 5.5 | Oasis discovery in iOS app: nearby oases, reward/proof level/merchant rules display | UI tests |
| 5.6 | Sponsored reward release + campaign budget decrement + merchant verified-visit reporting | Reporting matches chain events |
| 5.7 | Admin console: merchant approval, campaign moderation, triangle freeze, claim review (privacy-minimised), treasury dashboard | E2E admin flows |
| 5.8 | Campaign expiry worker (background jobs) + unused-budget handling per refund policy | Expiry tests |

Gate to M6: complete oasis loop on internal testnet — merchant funds campaign, miner physically-simulated visit claims via QR, sponsored Trinity released, dashboard shows verified visit and remaining budget.

### M6 — Alpha pilot

| # | Work item | Output |
|---|---|---|
| 6.1 | Pilot geography configuration (one city district — business DECISION; system is config-driven so any district works) | Pilot config |
| 6.2 | Compliance gate execution: consumer terms, merchant pilot agreement, privacy policy + PIA, app-store crypto-rules review (LEG-003, IOS-008) | Signed-off gate checklist (external dependencies marked) |
| 6.3 | TestFlight distribution, APNs claim-status notifications | Internal alpha → TestFlight alpha |
| 6.4 | 3–10 pilot merchants onboarded with signed agreements; pilot oasis campaigns | Live campaigns |
| 6.5 | Field test execution per test plan §6 (open sky, dense urban, indoor QR, boundary, high movement, replay, offline, fraud simulation) | Field test report |
| 6.6 | Public transparency dashboard (explorer) live for pilot area incl. treasury | Public URL |
| 6.7 | Monitoring + incident response runbook (`docs/operations/STEP_incident_response.md`), emergency pause drill | Drill log |
| 6.8 | Alpha report vs KPIs (HARD §17.4): claim acceptance rate, false rejection, fraud rejection, cost per verified visit, merchant repeat intent, miner repeat usage, validation time, QR redemption, support tickets/claim, battery impact | Alpha report + go/no-go for MVP |

Alpha success criteria (DEV §21.3): ≥95% valid claims processed correctly in controlled tests; near-zero false acceptance in known spoof/replay tests; ≥3 real merchant campaigns completed; 100–500 TestFlight miners; acceptable claim-feedback latency; zero unsafe-location incidents; merchants can see verified visits and unused budget.

---

## 3. Cross-cutting tracks (run across all milestones)

| Track | Content | Owner cadence |
|---|---|---|
| **Tokenomics constitution** | Produce the 15 outputs of HARD §4.11; depends on MESH audit (MESH-014) and denomination decision. Drafted during M1–M3, frozen before any public supply statement. | Parallel doc track |
| **Legal risk register** | Maintain `docs/legal-risk/STEP_legal_risk_register.md`; track HARD §12.3 questions; trigger external counsel before M6 gate 6.2. | Updated every milestone |
| **Security** | Slither/fuzz in CI from M3; cargo/npm audit + gitleaks + Trivy from M0; OWASP MASVS checklist for iOS from M2; contract audit booking before any non-testnet deployment. | Continuous |
| **Privacy** | Data-classification enforcement tests from M2 (no raw GPS on-chain/in logs); retention jobs by M5; PIA by M6. | Continuous |
| **Documentation** | Master-prompt §4.2 document set filled in as the matching modules are implemented — each doc written when its subject is built, never as a placeholder. | Per feature (ENG-002) |
| **Release log** | `docs/operations/STEP_release_log.md` entry per milestone. | Per milestone |

---

## 4. Post-alpha outline (not in delivery scope)

| Phase | Adds (SYS §24) |
|---|---|
| MVP | Real device/app integrity everywhere, basic open-ish validator set, multiple merchant pilots, fraud review tooling, public MESH activity dashboard |
| V1 | Weighted P2P validators over libp2p in production mode, multiple campaign types, controlled internal market (KYC-gated, post-legal-memo), campaign pricing engine, validator incentives, treasury dashboard hardening |
| Mature | Open validator participation, regulated exchange path, governance/DAO pathway, ZK/selective-disclosure proofs, ecosystem APIs |

---

## 5. Dependency-critical decisions before/at each milestone

| Needed by | Decision | Tracked in |
|---|---|---|
| M1 start | ADR-002 MESH v1 freeze (orientation, edges, encoding, tolerances) | ADR doc |
| M1 start | ADR-003 mineable levels for alpha (parameterised) | ADR doc |
| M3 start | ADR-007 collector slots + reward curve alpha defaults (parameterised) | ADR doc |
| M3 start | ADR-008 twin rate alpha default (parameterised) | ADR doc |
| M5 start | Closed campaign-credit accounting model details | ADR-011 |
| M6 gate | Pilot city, pilot merchants (business decision); external legal sign-offs (LEG-003) | Blockers list |
