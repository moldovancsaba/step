# STEP Test Plan

**Version:** 0.1
**Date:** 2026-06-11
**Status:** Alpha test plan, derived from DEV §18 (test pyramid + field tests), DEV §7.3 (MESH test strategy), HARD §16.3 (test requirements), and the Definition of Done (master prompt §3)
**Rule:** No feature is Done without automated tests and documented manual verification steps. No claim of "tested" may be made unless the tests exist and ran (master prompt §12).

---

## 1. Test principles

1. **Determinism is the product.** The MESH, validation rules, and reward logic must produce identical results across Rust, Swift, WASM, and Solidity. Cross-language golden tests are first-class CI citizens, not optional extras.
2. **Privacy is tested, not promised.** Automated tests assert that no raw GPS appears on-chain, in logs, in analytics events, or in indexer tables (HARD §16.3 "Privacy tests").
3. **Fraud paths are tested as thoroughly as happy paths.** Every acceptance condition in POP-003 has at least one test proving rejection when it fails.
4. **Parameters are tested at their boundaries.** Unfrozen protocol parameters (slots, curve, twin rate, thresholds) are tested across ranges, including the ≥1 Trinity invariant.
5. **Field tests are part of the plan,** with written procedures and recorded results — the alpha cannot pass on simulators alone (DEV §18.2).

---

## 2. Test pyramid by component

### 2.1 MESH engine (`packages/mesh-engine`)

| Test type | Content | Tooling |
|---|---|---|
| Golden coordinate tests | Committed vector file: (lat, lon, level) → triangle ID for ≥200 points covering all 20 faces, city-scale clusters, both hemispheres | Rust `#[test]`, file shared with Swift/WASM suites |
| Cross-language tests | Identical golden vectors executed in Rust, Swift (XCFramework), and WASM; CI fails on any divergence | XCTest, Vitest, cargo test |
| Property tests | ∀ random point: exactly one containing triangle per level (except boundary tolerance); `parent(child(t)) == t`; children partition parent; neighbours symmetric | proptest |
| Boundary tests | Points on edges/vertices resolve via deterministic tie-break (lowest ID); points within tolerance band behave per `boundaryPolicy` | Unit |
| Pole tests | North/South Pole and surrounding ring resolve consistently at all levels | Unit |
| Antimeridian tests | ±180° longitude points and triangles spanning the antimeridian produce stable IDs | Unit |
| Precision tests | Accuracy radius vs triangle size: claims with accuracy > safe threshold are flagged reject/downgrade per MESH-008 | Unit |
| Level tests | All configured mineable levels validated; ID round-trip (string ↔ bytes32) at every level | Unit |
| Performance tests | `latLonToTriangle` at level 21 within mobile-acceptable time (target: <1 ms native, <5 ms WASM) | Criterion bench, CI threshold |

### 2.2 Proof protocol (`packages/proof-protocol`, gateway, validation-rules)

| Test type | Content |
|---|---|
| Schema tests | Claim and evidence bundle validate against `step.proof.location.v1` / `step.evidence.bundle.v1`; unknown versions rejected |
| Signature tests | EIP-712 claim digest: valid signature accepted; wrong wallet, tampered field, wrong chain ID, wrong contract domain all rejected |
| Nonce tests | Fresh nonce accepted once; reuse rejected; expired (TTL) rejected; nonce bound to wrong wallet rejected |
| Timestamp tests | In-window accepted; stale and future-dated rejected; window boundary exact behaviour |
| Replay tests | Identical claim resubmission rejected; identical evidence bundle hash rejected (POP-005) |
| Attestation-mode tests | `attested` required on pilot-configured validators; `dev-unattested` rejected when `allow_dev_claims=false` (ADR-015); no path treats unattested as attested |
| Encryption tests | Bundle encrypts/decrypts (XChaCha20-Poly1305); key destruction renders bundle unreadable; CID matches content |

### 2.3 Smart contracts (`contracts/`)

| Test type | Content | Tooling |
|---|---|---|
| Unit tests | Every external function of every contract: success + every revert path | forge test |
| Invariant tests | Total supply = miner mints + twin mints − burns; no balance < 0; no mint < 1 Trinity ever (any slot, any curve parameters); used slots ≤ total slots; locked campaign budget = funded − released − refunded | forge invariant |
| Fuzz tests | Claim verifier with fuzzed signatures/weights/thresholds; reward curve across fuzzed slot counts and base rewards; campaign funding/release with fuzzed amounts | forge fuzz |
| Access control tests | Only verifier can mint; only AccessController roles can pause/freeze/set parameters; time-lock on parameter changes enforced | Unit |
| Pause/freeze tests | EmergencyPause blocks mint/claim/campaign paths; frozen triangle rejects claims; unfreeze restores | Unit |
| Event tests | Every state change emits its required event with correct fields (SC-003) — the indexer depends on this | Unit |
| Twin tests | FoundationTwinAllocated emitted and treasury credited at configured bps on every natural mint; cap honoured when set | Unit + fuzz over bps |
| Deployment tests | Deploy script idempotent on fresh Anvil; addresses recorded; config wiring (registry references) correct | forge script test |
| Static analysis | Slither no high/critical findings; gas snapshots tracked | CI gate |

### 2.4 Validator node (`services/validator-node`)

| Test type | Content |
|---|---|
| Pipeline unit tests | Each validation stage in isolation: format, signature, nonce, timestamp, containment (against mesh-engine), accuracy, triangle state, proof tier |
| Quorum tests | Weighted aggregation: below-threshold rejected, at-threshold accepted; mixed approve/reject; duplicate validator votes rejected |
| Malicious peer simulation | Conflicting votes, replayed votes, votes for unknown claims, malformed messages — node must not crash, must penalise/ignore |
| Fraud tests | Speed-threshold violation (teleport between claims) rejected; impossible travel across pilot area rejected; duplicate device patterns flagged; rate limits enforced |
| Collusion tests | Same friendly validator set repeatedly approving one wallet raises risk score (alpha: flag; MVP: route randomisation assert) |
| P2P tests | Feature-flagged libp2p gossip: claim and vote propagation between 3 nodes in Compose; message format identical to gateway transport (ADR-005) |
| Chain submission tests | Accepted claim submitted on-chain exactly once; resubmission after revert handled; finality watched |
| Metrics tests | Prometheus endpoints expose claim counts, validation latency, rejection reasons |

### 2.5 iOS app (`apps/ios`)

| Test type | Content | Tooling |
|---|---|---|
| Unit tests | Wallet create/import/export; key never leaves Keychain API surface; claim builder output matches golden signed claims; mesh binding parity vectors | XCTest |
| Location simulation tests | Simulated GPX routes: correct triangle resolution, accuracy gating, boundary behaviour while moving | XCTest + simulated locations |
| UI tests | Onboarding flow A, mining flow B, oasis flow C; claim status state machine rendering; privacy mode switching | XCUITest |
| Attestation tests | Enrolment flow with mocked App Attest responses (mock clearly scoped to test target only); `dev-unattested` labelling correct in simulator | XCTest |
| Privacy tests | No raw GPS in analytics payloads or log output (assert on log capture); evidence encrypted before upload | XCTest |
| Snapshot/regression | Map state colours per SYS §7.6; oasis display states per HARD §10.4 | Snapshot tests |

### 2.6 Web apps (explorer, merchant dashboard, admin console)

| Test type | Content | Tooling |
|---|---|---|
| Component tests | Triangle map overlay, campaign builder form validation (Zod schemas), claim status views | Vitest + Testing Library |
| Integration tests | Typed API client against gateway/merchant API contract (OpenAPI-driven) | Vitest + mock server from OpenAPI |
| E2E tests | Merchant: onboard → POI → triangle select → fund front-door campaign → see verified visit. Admin: approve merchant → moderate campaign → freeze triangle → audit export. Explorer: mesh → triangle → claim → treasury pages render real indexer data | Playwright against Compose stack |

### 2.7 Indexer and services

| Test type | Content |
|---|---|
| Event ingestion tests | Every contract event type produces correct rows; reorg/restart replay idempotent |
| Consistency tests | Indexer triangle/claim/campaign/treasury state equals chain state after test scenario runs |
| Job tests | Campaign expiry releases/refunds per policy; retention job destroys keys on schedule; jobs idempotent |
| API contract tests | Gateway and merchant API responses validate against OpenAPI schemas in CI |

---

## 3. End-to-end system tests

Run against the full Compose stack + Anvil (CI nightly and pre-release):

| Scenario | Asserts |
|---|---|
| **E2E-1 Natural mining** | Simulated iOS client (or device in lab) → claim → 3 validators → quorum → on-chain mint → twin to treasury → slot used → indexer → explorer shows claim Finalised; all 15 steps of SYS §23.1 |
| **E2E-2 Oasis mining** | Funded campaign → miner claim with QR proof → sponsored release from RewardPool → budget decrement → merchant report row; all 10 steps of SYS §23.2 |
| **E2E-3 Rejection paths** | One scenario per POP-003 condition: each single failed condition yields Rejected with reason, no mint, merchant not charged |
| **E2E-4 Exhaustion** | Mine all slots → triangle Exhausted → further claims rejected → state colour changes → sponsored campaign on exhausted triangle still works (OAS-004/TOK-004) |
| **E2E-5 Safety freeze** | Admin freezes triangle mid-campaign → claims rejected with reason code → unfreeze restores → all actions in audit log |
| **E2E-6 Campaign expiry/refund** | Campaign expires with unused budget → refund per policy → reporting correct |
| **E2E-7 Emergency pause** | Pause → all mint/claim/campaign paths revert → unpause → system resumes; drill documented |
| **E2E-8 Privacy sweep** | After E2E-1..7: scan chain state, indexer DB, and all service logs for any raw coordinate from the test fixtures — must find zero |

---

## 4. Load and resilience tests

| Test | Content | Target |
|---|---|---|
| High-density mining | Simulated burst of claims in one pilot-area triangle cluster (HARD §16.3 "Load tests") | Quorum latency and rejection correctness hold at 50 claims/min pilot-scale burst |
| Validator outage | Kill 1 of 3 validators mid-flow | Quorum still reached or claims queue correctly; alerting fires |
| Chain outage | Pause Anvil/testnet | Claims queue, users see honest status, no double-mint on recovery |
| Offline client | Submit with no network, regain network | Claim expiry honest, clear user feedback (field test 7 analogue) |

---

## 5. Security testing

| Area | Activity | When |
|---|---|---|
| Contracts | Slither every CI run; Foundry fuzz/invariant suites; Echidna campaign on TrinityToken + RewardPool + MiningClaimVerifier; external audit before any non-testnet deployment (SC-007) | M3 onward; audit pre-production |
| Dependencies | cargo audit, npm/pnpm audit, osv-scanner | Every CI run |
| Secrets | gitleaks | Every CI run |
| Containers | Trivy image scans | Every image build |
| Mobile | OWASP MASVS checklist review (key storage, transport, tamper assumptions) | M2, repeated before TestFlight |
| Replay/spoof red team | Internal attempt set: replayed claims, modified client (unattested), GPS-spoofed simulator claims, emulator claims — all must be rejected, results recorded in alpha report | M6 field phase |

---

## 6. Field tests (real devices, pilot area) — DEV §18.2

Each test has a written procedure, expected result, and recorded outcome in `tests/field-tests/`.

| # | Test | Purpose | Pass condition |
|---|---|---|---|
| F1 | Open sky GPS | Normal outdoor mining | Claim accepted; accuracy within threshold; status ≤ UX target |
| F2 | Dense urban | Multipath/inaccurate GPS | Low-accuracy claims downgraded/rejected per MESH-008, no false triangle |
| F3 | Indoor merchant QR | L4 validation | QR claim accepted only with valid rotating QR at the right POI |
| F4 | Boundary walk | Triangle edge behaviour | Deterministic assignment while crossing edges; no flapping double-claims |
| F5 | High movement | Car/transit false positives | Claims during implausible speed rejected by fraud check |
| F6 | Replay | Old proof reuse | Re-submission of captured claim rejected |
| F7 | Offline/poor network | Claim expiry and feedback | Honest expiry, no silent loss, no duplicate on retry |
| F8 | Fraud simulation | Spoofing/impossible travel | Spoofed and teleporting claims rejected; logged with reasons |
| F9 | Battery impact | Mobile UX KPI | Battery drain within KPI bound over a 2-hour mining session |

---

## 7. Acceptance gates

| Gate | Requirement |
|---|---|
| Per-PR | Component tests + lint + static analysis green; new code has tests; privacy assertions unchanged or strengthened |
| Per-milestone | Milestone gate criteria from the delivery roadmap met; E2E suite green; docs updated; release-log entry |
| Pre-TestFlight | E2E-1..8 green, security scans clean, MASVS review done, F1–F4 passed on at least 2 physical iPhones, compliance gate checklist reviewed |
| Pre-pilot (M6) | All field tests F1–F9 passed, fraud red-team results recorded, emergency drill done, external legal gates signed off or pilot scope reduced accordingly |
| Alpha exit | DEV §21.3 success criteria measured and reported in the alpha report |

---

## 8. Test data and fixtures policy

- Golden vectors, GPX routes, and merchant/POI fixtures live in `tests/` and are versioned with the MESH spec version.
- Fixtures use clearly synthetic identities and the pilot test area; no real personal data in fixtures.
- No production keys, endpoints, or secrets in any test (ENG-001).
- Mocks are confined to test targets; production code paths contain no mock branches (master prompt §1) — environment-dependent behaviour (e.g. attestation modes) is explicit configuration per ADR-015, never a hidden mock.
