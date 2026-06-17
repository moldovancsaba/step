# STEP Alpha Scope

**Version:** 0.1
**Date:** 2026-06-11
**Status:** Controlled alpha scope definition, consolidating SYS §24.1/§27, DEV §21, HARD §17, and master delivery prompt §9
**Rule:** Anything not listed as IN is OUT until this document is revised. Scope additions require an entry in the release log and a check against the legal compliance gates.

---

## 1. Alpha goal

The alpha must prove exactly one thing (HARD §17.1):

> Can STEP generate verified physical visits to real-world locations using MESH-based proof-of-presence and a Trinity reward loop?

Stated as the technical exit criterion (DEV §25):

> An iPhone user can physically touch a spherical triangle, submit a privacy-safe proof-of-presence, receive Trinity through smart-contract-controlled rules on a testnet, and a real merchant can fund a Trinity oasis that produces verified visits.

The alpha must **not** try to prove the economy, the exchange, open validation, or global mining.

---

## 2. Alpha boundaries

| Dimension | Alpha decision | Source |
|---|---|---|
| Geography | One controlled pilot city/district (config-driven; selection is OPEN-7) | HARD §17.2, SYS §27 |
| Token | Testnet Trinity on a foundation-operated internal EVM testnet; explicitly valueless | HARD §17.2, ADR-006 |
| Mineable levels | Levels 1..21, with **level 21 terminal** (no level 22; a fully-mined level-21 triangle is a permanent desert). Mineability is ancestor-gated and location-specific: a child appears mineable only when its parent's 27 slots are exhausted and it breaks down. See `docs/geography/STEP_mesh_id_v2.md`. | ADR-003 |
| Exchange | None. Closed campaign-credit model with declared reference price + disclaimer only | HARD §8.3, ADR-011 |
| Merchants | 3–10 pilot merchants, admin-approved, signed pilot agreement | HARD §17.2 |
| Miners | 100–500 invited TestFlight users | HARD §17.2, DEV §21.3 |
| Proof tiers | L1 (GNSS + app integrity), L2 (+ validator quorum), L4 via merchant QR | HARD §17.2, POP-004 |
| Validators | Foundation-operated nodes + selected merchant validators + selected approved points; weighted quorum; no open registration | DEV §9.5, HARD §17.2 |
| Networking | Gateway-mediated claim flow; libp2p gossip feature-flagged, not pilot-active | ADR-005, SYS §12.1 |
| Wallet | Self-custodial embedded wallet for miners; managed accounts for merchants | ADR-012 |
| Cash-out | None. No fiat in or out for miners | HARD §12.5 |
| Marketing | No investment-return language anywhere | HARD §12.5, §19 |
| Logging | Full audit trail; no raw GPS in any log or analytics | SYS §27, DEV §23.1 |

---

## 3. Alpha includes (must ship)

### 3.1 iOS miner app (`apps/ios`)
- Wallet create/import, Keychain-protected keys, export.
- Onboarding per DEV §6.3 Flow A: location-use explanation, terms, permissions, attestation enrolment.
- MESH map (MapLibre Native) with current triangle and state colours (SYS §7.6, HARD §10.4 display states).
- Current triangle detection via the canonical mesh-engine binding.
- Mine flow (Flow B): accuracy check, triangle state fetch, expected reward display, signed claim, submission, live status (Draft → Submitted → Validating → Accepted → Finalised / Rejected).
- Oasis flow (Flow C): nearby oasis discovery, reward/proof-level/merchant rules, QR scan for L4 proof.
- Trinity balance and claim history.
- Privacy controls: profile mode (private default / pseudonymous / public), data export, deletion request.
- Claim-status push notifications (APNs).

### 3.2 MESH engine (`packages/mesh-engine`)
- Deterministic icosahedral MESH per the frozen v1 spec (ADR-002): IDs, containment, parent/child/neighbours, centroid, area, boundary policy.
- Swift (XCFramework) and WASM bindings; shared golden test vectors.
- Pilot-area triangle states served via indexer; global logic still deterministic everywhere (DEV §21.1).

### 3.3 Smart contracts (`contracts/`) — internal testnet
- TrinityToken (indivisible unit enforced), MeshRegistry, TriangleMiningState (parameterised slots/curve, ≥1 Trinity invariant), MiningClaimVerifier (EIP-712 + weighted validator signatures), FoundationTreasury (configurable twin, public address), ProofRegistry, ValidatorRegistry, CampaignRegistry, RewardPool, SafetyRegistry, AccessController/EmergencyPause.
- All events per DEV §10.4 / HARD §15.3. Full Foundry test suite + Slither in CI.

### 3.4 Validator network (`services/validator-node`)
- 3+ foundation validator nodes (Rust) running deterministic validation pipeline: format, signature, nonce/timestamp, containment, accuracy, triangle state, fraud checks v1 (speed/teleport/duplicate/rate-limit).
- Weighted quorum aggregation and on-chain submission.
- At least one merchant validator (QR proof) in the pilot.
- Prometheus metrics, structured logs, transparent operation logs.

### 3.5 Evidence pipeline (`services/proof-storage`)
- Encrypted proof bundles (ADR-014) on self-hosted IPFS; CID hash on-chain only; retention jobs; key-destruction deletion.

### 3.6 Merchant dashboard (`apps/merchant-dashboard`) + merchant API
- Admin-approved onboarding with restricted-category exclusion (MER-008) and location-rights confirmation (HARD §14.3).
- POI creation, triangle mapping on map, **front-door oasis** campaign builder (single campaign type in alpha).
- Campaign-credit funding at reference price (ADR-011), budget cap, schedule, per-wallet limit, refund policy selection.
- Reporting: verified visits, redemptions, spend, remaining/unused budget, rejected (unpaid) claims.

### 3.7 Admin console (`apps/protocol-admin`)
- Merchant approval, campaign moderation, triangle freeze/unfreeze with reason codes, claim review (privacy-minimised), validator management, protocol-parameter registry view, treasury dashboard, audit export.

### 3.8 Public explorer (`apps/web`)
- `/mesh` pilot-area map, `/triangle/[id]`, `/claim/[hash]`, `/campaign/[id]` (where public), `/treasury`, `/validators`. No `/market`.

### 3.9 Operations
- Docker Compose full local stack; internal testnet under `infra/localnet`.
- Monitoring dashboards: mining, MESH, validator, campaigns, safety, privacy (HARD §16.4 subset).
- Incident response runbook + emergency pause/freeze drill.
- Release log.

### 3.10 Compliance artefacts (gates before pilot go-live)
- Consumer terms, merchant pilot agreement, privacy policy, privacy impact assessment, app-store crypto-rules review (HARD §12.4). External sign-offs are tracked blockers, not engineering deliverables.

---

## 4. Alpha excludes (must not ship)

| Excluded | Reason | Source |
|---|---|---|
| Open public exchange, AMM, order book | Highest regulatory risk; CASP analysis required | HARD §8.2, §17.3 |
| Fiat cash-out (any direction for miners) | AML/tax risk | HARD §12.5, DEV §21.2 |
| ICO / token sale / investment marketing | Legal classification unresolved | HARD §17.3 |
| Global open mining | Proof model untested at scale | DEV §21.2 |
| Open validator registration / validator marketplace | Security risk before fraud rules are stable | DEV §9.5, §21.2 |
| DAO governance | Too early | DEV §21.2 |
| Satellite/oracle infrastructure validation (L5) | Partnership and complexity | DEV §21.2 |
| NFT / triangle-rights speculation | Distracts from proof + merchant value | DEV §21.2 |
| Production/mainnet token | Legal classification + audit required first | DEV §21.2, SC-007 |
| High-value rewards | Fraud incentive in unhardened pilot | HARD §17.3 |
| Unrestricted merchant self-service | Moderation and safety first | HARD §17.3 |
| Campaign pricing engine | V1 feature; alpha sets rewards manually | MER-006 |
| Android app | Out of scope this phase | DEV §1 |

---

## 5. Alpha success criteria and KPIs

Hard criteria (DEV §21.3):

| Area | Target |
|---|---|
| Claim validity | ≥95% of valid claims processed correctly in controlled tests |
| False acceptance | Near zero in known spoof/replay tests |
| Merchant flow | ≥3 real merchant oasis campaigns completed end-to-end |
| User flow | 100–500 TestFlight miners active |
| Proof speed | Claim status feedback within the UX threshold set in the test plan (alpha target: median ≤30 s to Accepted) |
| Safety | Zero unsafe-location incidents |
| Reporting | Merchants see verified visits and unused budget accurately |

Measured KPIs (HARD §17.4): claim acceptance rate, false rejection rate, fraud rejection rate, cost per verified visit, merchant repeat intent, miner repeat usage, average validation time, QR/POS redemption rate, support tickets per claim, battery impact.

---

## 6. Exit and go/no-go

The alpha ends with an **alpha report** (roadmap M6.8) evaluating every KPI against target, listing all fraud/safety incidents, all parameter values used, and all unresolved OPEN decisions. MVP go/no-go requires: hard criteria met, no critical security findings open, tokenomics constitution drafted, and the legal gates for the next phase identified with counsel engaged.
