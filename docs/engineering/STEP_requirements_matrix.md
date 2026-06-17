# STEP Requirements Matrix

**Version:** 0.1
**Date:** 2026-06-11
**Status:** Extracted requirements baseline — controlling sources are the three STEP planning documents
**Sources:**
- `STEP_complete_system_documentation.md` (referenced below as **SYS**)
- `STEP_development_documentation_open_source_apple_first.md` (referenced below as **DEV**)
- `STEP_hardening_system_documentation.md` (referenced below as **HARD**)

---

## 0. How to read this matrix

Each requirement has:

- **ID** — stable identifier, never reused.
- **Requirement** — normative statement.
- **Source** — document and section it was extracted from.
- **Class** — one of:
  - `CONFIRMED` — decided in the source documents, must not be violated.
  - `RECOMMENDED` — strongest documented design path, adopted unless an ADR overrides it.
  - `DECISION` — open decision required before or during implementation (tracked in ADR doc).
  - `ASSUMPTION` — working assumption adopted to proceed; explicitly revisitable.
  - `BLOCKER` — cannot ship the affected scope until resolved.
  - `RISK` — implementation risk requiring mitigation.
  - `LEGAL` — legal/compliance review required.
  - `RESEARCH` — technical research required.
- **Alpha** — `IN` (alpha scope), `OUT` (explicitly excluded from alpha), `PARTIAL` (limited alpha form), `N/A`.

---

## 1. Product identity requirements

| ID | Requirement | Source | Class | Alpha |
|---|---|---|---|---|
| PRD-001 | STEP is a proof-of-location / proof-of-presence blockchain system on a deterministic spherical triangular MESH of the Earth. | SYS §1, HARD §1.1 | CONFIRMED | IN |
| PRD-002 | Mining = physically visiting/touching any valid part of a mineable triangle and submitting a verifiable proof-of-presence. | SYS §1, DEV §0 | CONFIRMED | IN |
| PRD-003 | Walking, step counting, distance, health-app data, wearables, and imported fitness records are NOT protocol inputs. No mining logic may use HealthKit, pedometer, workouts, calories, or distance. | SYS §1, §2.3; DEV §1 | CONFIRMED | IN |
| PRD-004 | Trinity is the smallest indivisible unit of the STEP economy. The protocol must never mint, transfer, sell, or allocate less than 1 Trinity. | SYS §5.3, HARD §4.3 | CONFIRMED | IN |
| PRD-005 | Trinity is the smallest unit of STEP, not a separate token. | SYS §9.2 | CONFIRMED | IN |
| PRD-006 | The MESH is canonical: all mining, campaigns, deserts, oases, and analytics must map to triangle IDs. | DEV §1 | CONFIRMED | IN |
| PRD-007 | Businesses buy verified physical visits, not crypto. Trinity is the settlement/incentive layer. All sales, UI, and docs use this framing. | SYS §15.1, HARD §9.1, §18.1 | CONFIRMED | IN |
| PRD-008 | Marketing must never promise price appreciation, passive income, or guaranteed returns. | SYS §19.3, HARD §19 | CONFIRMED | IN |
| PRD-009 | Legacy concepts (StePenny, step counting, fitness API proof) are retired and must not appear in code, UI, or docs. | SYS §2.1 | CONFIRMED | IN |

---

## 2. MESH engine requirements

| ID | Requirement | Source | Class | Alpha |
|---|---|---|---|---|
| MESH-001 | MESH base is a spherical icosahedron: 20 base triangular faces (level 1). | SYS §6.2, HARD §5.4 | CONFIRMED | IN |
| MESH-002 | Each subdivision splits one triangle into 4 children; `T(n) = 20 × 4^(n-1)`; cumulative `C(n) = 20 × (4^n − 1) / 3`. | SYS §6.3, HARD §5.4 | CONFIRMED | IN |
| MESH-003 | MESH must be deterministic, hierarchical, global, non-overlapping, exhaustive, addressable, independently verifiable, and efficient on mobile. | HARD §5.2 | CONFIRMED | IN |
| MESH-004 | Triangle ID format (**Mesh ID v2**, `docs/geography/STEP_mesh_id_v2.md`): dotted **1-indexed** path `<face 1..20>(.<child 1..4>)*`; level = segment count; mined slot/NFT appends slot `1..27` as the final segment (`<triangleId>.<slot>`). Children 1=near A, 2=near B, 3=near C, 4=centre. Supersedes the old `STEP-{level}-F{face}-{base4path}` form. | SYS §7.3–7.4 | CONFIRMED | IN |
| MESH-005 | Required functions: `latLonToTriangle`, `triangleToVertices`, `containsPoint`, `parentTriangle`, `childTriangles`, `neighbourTriangles`, `triangleArea`, `triangleCentroid`, `boundaryPolicy`. | DEV §7.1 | CONFIRMED | IN |
| MESH-006 | Containment: convert WGS84 lat/lon to 3D unit vectors; oriented great-circle edge tests; documented tolerances. | SYS §6.7, HARD §5.8 | RECOMMENDED | IN |
| MESH-007 | Boundary cases must be deterministic. Normal mining: border claims assigned to one deterministic triangle (tie-break by triangle ID). Sponsored campaigns: stronger proof and merchant-defined safe zones. | SYS §6.8, HARD §5.7 | RECOMMENDED | IN |
| MESH-008 | If accuracy radius exceeds the triangle's safe threshold, reject or downgrade the proof. | SYS §6.7 | CONFIRMED | IN |
| MESH-009 | Alpha Earth model: spherical approximation. Production: evaluate ellipsoidal correction or declare protocol spherical-by-design with documented distortion. | SYS §7.2 | RECOMMENDED | IN |
| MESH-010 | Canonical MESH engine implemented once in Rust (`mesh-core`), exported to iOS (UniFFI/C FFI → XCFramework), web (WASM), validator node (native), with cross-language golden tests guaranteeing identical results. | DEV §4.1, §7.2 | RECOMMENDED | IN |
| MESH-011 | The MESH must handle poles and antimeridian (±180° longitude) without breaking IDs; behaviour must be tested. | DEV §7.3 | CONFIRMED | IN |
| MESH-012 | Mineable levels: all potential levels are available by depth configuration (default 1–25). A location can mine a triangle when it is the deepest non-exhausted available level along the local parent-to-child chain at that location; parent exhaustion is the gate, not a global blacklist. | SYS §6.4, HARD §5.6 | DECISION | PARTIAL (configurable constant) |
| MESH-013 | Exact icosahedron orientation, edge definition (great-circle), ID encoding, coordinate precision, and rounding policy must be frozen in a MESH specification before any supply numbers are published. | DEV §7.4, HARD §5.8 | DECISION | IN (alpha freeze of v1 spec) |
| MESH-014 | Independent mathematical audit of level count, triangle count, side length, area, total supply, and reward curve required before investor/whitepaper use. Known issue: level 21 count is ~22 trillion, not 2.1 trillion. | SYS §6.4, HARD §5.5 | BLOCKER (for whitepaper/investor numbers, not for alpha code) | N/A |
| MESH-015 | STEP should document its relationship to OGC DGGS principles. | SYS §6.9, HARD §5.3 | RESEARCH | OUT |

---

## 3. Proof-of-presence protocol requirements

| ID | Requirement | Source | Class | Alpha |
|---|---|---|---|---|
| POP-001 | The protocol answers exactly one question: "Was this miner physically inside this triangle at this time?" | SYS §11.1, HARD §6.1 | CONFIRMED | IN |
| POP-002 | Claim object must contain: claim_id, miner_wallet, triangle_id, mesh_level, latitude, longitude, accuracy_radius_m, timestamp (ISO8601 UTC), nonce, device_attestation_hash, app_attestation_hash, previous_claim_hash (optional), proof_bundle_hash/CID, miner_signature. | SYS §8.3, HARD §6.2, DEV §6.4 | CONFIRMED | IN |
| POP-003 | Claim acceptance requires ALL of: valid signature, fresh nonce, timestamp in window, coordinate inside triangle, accuracy acceptable, triangle open/available, collector slot available, cooldown expired, device integrity passed, app integrity passed, movement plausible, fraud score below threshold, validator quorum reached. | HARD §6.4, DEV §8.2 | CONFIRMED | IN (attestation may be mock-flagged in dev, real on TestFlight where possible) |
| POP-004 | Proof tiers L1–L5: L1 GNSS+app integrity; L2 +validator quorum; L3 +device attestation+weighted validators; L4 merchant QR/NFC/BLE/POS; L5 infrastructure-assisted. | HARD §6.3 (supersedes SYS §11.3 four-tier table) | CONFIRMED | PARTIAL (L1, L2, L4-QR in alpha) |
| POP-005 | Replay protection: one-time fast-expiring nonce, timestamp window, claim hash uniqueness, duplicate proof bundle rejection, previous-claim reference. | HARD §6.6 | CONFIRMED | IN |
| POP-006 | Movement plausibility checks: speed threshold, teleport detection vs previous accepted claims, device continuity, wallet clustering, validator collusion detection. | HARD §6.5 | CONFIRMED | PARTIAL (speed/teleport in alpha; clustering/collusion analytics MVP) |
| POP-007 | No single proof signal is sufficient. Location proof is probabilistic, never absolute. | SYS §11.2, §11.6 | CONFIRMED | IN |
| POP-008 | Raw GPS data must never be placed on-chain. On-chain: proof hash, triangle_id, claim_id, miner_wallet, collector_slot, trinity_amount, validator_quorum_hash, block number. Off-chain (encrypted): raw location samples, accuracy history, attestations, validator signatures, merchant proof, fraud score. | SYS §11.7, HARD §6.7, §13.1 | CONFIRMED | IN |
| POP-009 | Proof bundles are encrypted before upload to content-addressed storage (IPFS-compatible); only hash/CID goes on-chain. | DEV §13.3 | CONFIRMED | IN |
| POP-010 | Claim lifecycle: Created → Submitted → Propagated → Validated → QuorumReached → SubmittedOnChain → Finalised, with Rejected and Disputed branches. | DEV §8.1 | CONFIRMED | IN |
| POP-011 | The iOS app never claims final validity — it only produces signed evidence. | DEV §6.4 | CONFIRMED | IN |
| POP-012 | App integrity via Apple App Attest / DeviceCheck on iOS. | SYS §11.4, DEV §6.1 | CONFIRMED | PARTIAL (real where TestFlight allows; structure always present) |
| POP-013 | Proof schemas are versioned (`step.proof.location.v1`, `step.evidence.bundle.v1`). | DEV §6.4, §8.3 | CONFIRMED | IN |
| POP-014 | Exact accuracy thresholds, timestamp window, nonce TTL, and fraud-score threshold values per proof tier. | HARD §6 | DECISION | IN (configurable parameters with documented alpha defaults) |

---

## 4. Trinity tokenomics requirements

| ID | Requirement | Source | Class | Alpha |
|---|---|---|---|---|
| TOK-001 | Recommended denomination: 1 STEP = 67,108,864 Trinity. | SYS §9.1, HARD §4.2 | RECOMMENDED (final ratio is DECISION) | IN (configurable constant) |
| TOK-002 | Natural Trinity is minted only when a valid proof-of-presence claim is accepted for an available collector slot of a mineable triangle. | HARD §4.5 | CONFIRMED | IN |
| TOK-003 | Sponsored Trinity must come from already-existing Trinity (purchased/transferred/locked into campaign pools), never newly minted for campaigns. | HARD §4.6, SYS §9.5 | RECOMMENDED | IN |
| TOK-004 | Sponsored Trinity does not reset natural mining scarcity/history. | SYS §9.5, HARD §10.2 | CONFIRMED | IN |
| TOK-005 | Every mined Trinity creates a twin allocation to the foundation treasury under the active twin rule. Twin must be included in total-supply calculations from day one. | SYS §9.4, HARD §4.7 | CONFIRMED (mechanism); rate schedule is DECISION | IN (configurable rate; alpha default 100% bootstrap rate) |
| TOK-006 | Twin schedule recommendation: bootstrap high → growth reduced → mature capped/governance-controlled. Unlimited 1:1 forever must not be used unless total supply is explicitly designed around it. | SYS §9.4, HARD §4.7 | RECOMMENDED | PARTIAL |
| TOK-007 | Supply pools tracked separately: natural mining, foundation treasury, sponsored campaign, validator reward, locked/staked, burned, liquidity, dispute bond. | SYS §9.3, HARD §4.4 | CONFIRMED | PARTIAL (natural, treasury, campaign pools in alpha) |
| TOK-008 | Collector slots per triangle are finite. Reward curve must never produce <1 Trinity. Define Trinity denomination first, then slots and curve. Legacy 28-collector model is invalid if halving drops below 1 Trinity. | SYS §8.5, HARD §4.3 | DECISION | IN (configurable: slots + curve as protocol parameters) |
| TOK-009 | Token sinks/locks: campaign pools, validator staking, merchant staking, dispute bonds, premium placement, sponsorship rights, optional burn. | SYS §9.6, HARD §4.10 | RECOMMENDED | PARTIAL (campaign lock only) |
| TOK-010 | Fee streams: exchange fee, campaign creation fee, verified visit fee, premium proof fee, validator registration fee, dispute fee. First fee model: small exchange fee + campaign fee + validator fee from merchant-funded campaigns. Do not charge casual miners in alpha. | HARD §4.9 | RECOMMENDED | PARTIAL |
| TOK-011 | Tokenomics constitution must be written before whitepaper, public token discussion, or investor deck, and must produce the 15 outputs listed in HARD §4.11. | HARD §4.1, §4.11 | BLOCKER (for public launch; alpha proceeds with parameterised constants) | N/A |
| TOK-012 | Max supply model (fixed/capped/expandable). | SYS §26.2 | DECISION | OUT (alpha uses testnet Trinity) |
| TOK-013 | Burn policy (none/partial/governance). | SYS §26.2, HARD §4.11 | DECISION | OUT |
| TOK-014 | Foundation sell policy: public wallets, sale schedule and limits, disclosed transfers, lockups, independent reporting. | HARD §4.8, §11.3 | CONFIRMED (for production) | PARTIAL (public treasury address + dashboard) |

---

## 5. Mining state and business logic requirements

| ID | Requirement | Source | Class | Alpha |
|---|---|---|---|---|
| MIN-001 | Mining eligibility: valid identity + valid proof + point inside triangle + triangle open + slot available + cooldown passed + validator acceptance. | SYS §8.1 | CONFIRMED | IN |
| MIN-002 | Triangle state machine: Unborn, Locked, Open, Claim pending, Validating, Accepted, Finalised, Rejected, Disputed, Exhausted, Oasis active, Frozen. | SYS §8.2 | CONFIRMED | IN |
| MIN-003 | Reward logic: on valid claim, take next collector slot, compute reward from curve, mint to miner, mint/allocate twin to treasury, update triangle state. | SYS §8.4 | CONFIRMED | IN |
| MIN-004 | Opening delay (legacy: 168h after birth), post-claim cooldown, demand-based throttle, and event overrides are protocol timing parameters. | SYS §8.6 | RECOMMENDED (values are DECISION) | IN (configurable) |
| MIN-005 | Miner statuses: New, Verified, Trusted, High-risk (delayed rewards), Frozen, Banned. | SYS §16.3 | CONFIRMED | PARTIAL |
| MIN-006 | Claim status states visible to user: Draft, Submitted, Validating, Accepted, Finalised, Rejected, Disputed, Frozen. | SYS §16.4 | CONFIRMED | IN |

---

## 6. Trinity deserts and oases requirements

| ID | Requirement | Source | Class | Alpha |
|---|---|---|---|---|
| OAS-001 | Desert formation: high-traffic areas mine out naturally and become Trinity deserts; remote areas remain Trinity mines. System must classify and display this. | SYS §10.1, HARD §10.1 | CONFIRMED | IN |
| OAS-002 | Oasis: business/advertiser/venue/foundation locks funded Trinity into selected triangles to attract verified visitors. | SYS §10.2, HARD §10.2 | CONFIRMED | IN |
| OAS-003 | Oasis/campaign types: front-door, in-store, venue/event, route, tourist/landmark, conquest (legal review), virtual brand, redemption, loyalty, sampling, desert refill, slow-hour, first-visit, repeat-visit. | SYS §10.3, §15.3; HARD §9.3; DEV §15.1 | CONFIRMED (full set); alpha subset | PARTIAL (front-door oasis only) |
| OAS-004 | Oasis state model: Planned → Funded → Active → Partially mined → Empty / Expired → Refunded; Disputed branch. | HARD §10.3 | CONFIRMED | IN |
| OAS-005 | Campaign settlement: pre-funded before activation, locked reward after miners act, release only on valid proof, defined expiry, predefined unused-funds rule (return/rollover/treasury), rejected claims unpaid, merchant reporting. | SYS §10.4, HARD §9.4 | CONFIRMED | IN |
| OAS-006 | Map must distinguish: Natural Mine, Trinity Desert, Trinity Oasis, Sponsored Rich Mine, Restricted Area, Event Zone — plus the MESH state colour scheme (white/grey/black/blue-green/gold/purple/red). | HARD §10.4, SYS §7.6 | CONFIRMED | IN |

---

## 7. Merchant campaign system requirements

| ID | Requirement | Source | Class | Alpha |
|---|---|---|---|---|
| MER-001 | Merchant onboarding flow: register → verify identity and location rights → wallet/managed account → create POI → map POI to triangle(s) → fund campaign → lock Trinity → miners claim → release on valid proof → dashboard + invoice. | SYS §15.2 | CONFIRMED | IN (admin-approved, not self-service) |
| MER-002 | Campaign object per HARD §9.2 / DEV §15.3: type, triangle_ids, budget, reward per valid claim, max_claims, per-wallet limit, proof level, schedule, active hours, refund policy, status. | HARD §9.2, DEV §15.3 | CONFIRMED | IN |
| MER-003 | Campaign state machine: Draft → PendingReview → Approved → Funded → Active → Paused → Completed, with Rejected/Expired/Cancelled/Disputed branches. | DEV §15.2 | CONFIRMED | IN |
| MER-004 | Merchant proof levels mapped to reward value (low GPS+integrity … purchase-linked POS). | SYS §15.5 | CONFIRMED | PARTIAL (GPS + QR in alpha) |
| MER-005 | Merchant accounting: prepayment, unused-budget rule, rejected claims not charged, fraud claims frozen and reviewed, tax-compliant invoice, exportable reporting. | SYS §15.6 | CONFIRMED | PARTIAL (invoicing simplified in pilot; pilot agreement required) |
| MER-006 | Campaign pricing engine with inputs (reference price, target visits, attractiveness, miner density, competition, distance, proof level, urgency, category, history) and outputs (suggested reward/budget, expected visits, cost/visit, claim speed, proof level recommendation). | HARD §9.5 | RECOMMENDED | OUT (V1; alpha uses manual reward setting) |
| MER-007 | Merchant must confirm location rights, legal access, no safety hazard, offer legality, and age-restriction compliance. | HARD §14.3 | CONFIRMED | IN |
| MER-008 | Restricted merchant categories (alcohol, tobacco, gambling, adult, weapons, controlled substances, political targeting, medical claims, financial promotions) excluded or legal-reviewed. | SYS §20.6 | LEGAL | IN (exclusion list enforced in onboarding) |
| MER-009 | Managed business accounts may hide wallet complexity from merchants. | HARD §18.3, SYS §25 | RECOMMENDED | IN |

---

## 8. Validator network requirements

| ID | Requirement | Source | Class | Alpha |
|---|---|---|---|---|
| VAL-001 | Validator classes: mobile peer (low), approved point (medium), merchant validator (high), venue validator (high), infrastructure validator (very high), protocol validator (highest). | HARD §7.1, SYS §12.3 | CONFIRMED | PARTIAL (foundation-operated + selected merchant + approved point) |
| VAL-002 | Weighted quorum, never simple 51% of random phones: `sum(valid_approval_weights) >= required_threshold`. | SYS §12.4, HARD §7.2 | CONFIRMED | IN |
| VAL-003 | Validator pipeline: receive claim → check format → signature → timestamp/nonce → containment → proof tier → risk signals → sign approve/reject → publish vote → aggregate quorum → submit on-chain → monitor finality. | SYS §12.5, DEV §9.3 | CONFIRMED | IN |
| VAL-004 | Validator economics: validation fee, premium proof fee, foundation reward, staking yield (later), reputation-based routing. | SYS §12.6, HARD §7.3 | RECOMMENDED (amounts are DECISION) | PARTIAL (foundation-funded in alpha) |
| VAL-005 | Slashing triggers: impossible-location approval, miner collusion, repeated false rejection, duplicate-claim signing, forged merchant proof, committed-service downtime. | HARD §7.4, SYS §12.7 | CONFIRMED | PARTIAL (reputation + removal in alpha; stake slashing when staking exists) |
| VAL-006 | Validator appeal states: active, under_review, suspended, slashed, removed, appealed, restored. | HARD §7.5 | CONFIRMED | PARTIAL |
| VAL-007 | Miners must not freely choose all their validators (randomness/assignment required). | HARD §7.3 | CONFIRMED | IN |
| VAL-008 | Alpha: no open validator market. Foundation-operated nodes + selected merchant validators + selected approved points, transparent logs, testnet contracts. | DEV §9.5 | CONFIRMED | IN |
| VAL-009 | Validator node in Rust with rust-libp2p, TOML config, RocksDB/PostgreSQL storage, secp256k1/ed25519 signing, Prometheus metrics, OTel logs, Docker + native packaging. | DEV §9.1 | RECOMMENDED | IN |

---

## 9. Smart contract requirements

| ID | Requirement | Source | Class | Alpha |
|---|---|---|---|---|
| SC-001 | Stack: Solidity, Foundry, OpenZeppelin, EIP-712 typed signing; unit/invariant/fuzz/fork tests; Foundry deployment scripts; Slither/Mythril/Echidna where applicable. | DEV §10.1 | CONFIRMED | IN |
| SC-002 | Contract set: TrinityToken, MeshRegistry, TriangleMiningState, MiningClaimVerifier, ValidatorRegistry, CampaignRegistry, RewardPool, Treasury (FoundationTreasury), Exchange (not alpha), ProofRegistry, SafetyRegistry, DisputeManager, AccessController/EmergencyPause. | DEV §10.2–10.3, HARD §15.1, SYS §13.2 | CONFIRMED | PARTIAL (Exchange and DisputeManager stubs/excluded; rest in alpha) |
| SC-003 | Required events as listed in DEV §10.4 and HARD §15.3 (TriangleMined, FoundationTwinMinted/Allocated, CampaignCreated, OasisFunded/CampaignFunded, SponsoredRewardClaimed/Released, ValidatorRegistered, ValidatorSlashed, TriangleFrozen, ProofStored, MiningClaimSubmitted/Accepted/Rejected, TriangleOpened). | DEV §10.4, HARD §15.3 | CONFIRMED | IN |
| SC-004 | Contract design rules: no raw GPS on-chain, deterministic reward computation, reject sub-Trinity amounts, governed+time-locked upgradeability, emergency pause, events for all state changes, audit before mainnet, testnet first. | HARD §15.2 | CONFIRMED | IN |
| SC-005 | Deployment phases: Anvil local → internal testnet → public testnet → mainnet/L2 only after legal and cost review. Do not build a new L1 for alpha. | DEV §10.5–10.6, SYS §13.1 | CONFIRMED | IN (Anvil + internal testnet) |
| SC-006 | ERC-20-style interface for Trinity accounting; ERC-721/1155 for future triangle rights (not alpha). | SYS §13.3–13.4 | RECOMMENDED | PARTIAL (ERC-20 only) |
| SC-007 | No unaudited production deployment of any contract. | SYS §25, HARD §15.2 | BLOCKER (for production) | N/A |

---

## 10. iOS app requirements

| ID | Requirement | Source | Class | Alpha |
|---|---|---|---|---|
| IOS-001 | Native Swift + SwiftUI (not React Native), Clean Architecture + MVVM, MapLibre Native iOS, Core Location, Keychain + Secure Enclave, App Attest/DeviceCheck, URLSession (libp2p via Rust FFI or gateway in alpha), SQLite via GRDB.swift or SQLite.swift, CryptoKit/Swift Crypto + audited secp256k1 for EVM signing, BGTaskScheduler, APNs optional. | DEV §3.2, §6.1 | CONFIRMED | IN |
| IOS-002 | App features: wallet create/import, secure key storage, location detection, current triangle detection, claim creation/signing/submission, claim status tracking, Trinity balance, MESH map with state colours, natural vs sponsored Trinity visibility, nearby oases, campaign discovery, privacy controls. | DEV §6.2–6.3; master prompt §5.1 | CONFIRMED | IN |
| IOS-003 | First-launch flow: explain location use → accept terms → create/import wallet → secure key storage → location permission → attestation enrolment → map with current triangle. | DEV §6.3 Flow A | CONFIRMED | IN |
| IOS-004 | Mining flow (Flow B) and merchant oasis flow (Flow C) as specified. | DEV §6.3 | CONFIRMED | IN |
| IOS-005 | Privacy: no raw GPS to analytics, encrypted proof bundles, coarse public display (triangle, not GPS), user export, off-chain deletion support, on-chain permanence warning. | DEV §6.5 | CONFIRMED | IN |
| IOS-006 | No raw GPS in logs; self-hosted privacy-friendly analytics only; prefer self-hosted/local crash logs during alpha. | DEV §6.1, §23.1 | CONFIRMED | IN |
| IOS-007 | Apple platform exceptions accepted: Xcode, iOS SDK, Apple Developer Program, TestFlight/App Store, App Attest, APNs. | DEV §2.2 | CONFIRMED | IN |
| IOS-008 | App-store crypto rules compliance review before distribution. | HARD §12.4 | LEGAL | IN (gate before TestFlight pilot) |
| IOS-009 | Android explicitly out of scope for this phase. | DEV §1 | CONFIRMED | OUT |

---

## 11. Web application requirements

| ID | Requirement | Source | Class | Alpha |
|---|---|---|---|---|
| WEB-001 | Stack: Next.js + TypeScript, Tailwind CSS, MapLibre GL JS, OSM-compatible tiles, TanStack Query, React Hook Form + Zod, ECharts/Recharts, wagmi/viem/WalletConnect where needed, SIWE-style or managed merchant auth, Vitest + Playwright. | DEV §11.1 | CONFIRMED | IN |
| WEB-002 | Four web apps: web-explorer (public transparency), merchant-dashboard, admin-console (protocol-admin), public-site. | DEV §11.2 | CONFIRMED | PARTIAL (explorer, merchant dashboard, admin console; public-site deferred) |
| WEB-003 | Explorer pages: /mesh, /triangle/[id], /claim/[hash], /wallet/[address] (opt-in public mode), /campaign/[id], /market (post-alpha), /treasury, /validators. | DEV §11.3 | CONFIRMED | PARTIAL (no /market in alpha) |
| WEB-004 | Merchant dashboard modules: onboarding, POI manager, triangle selector, campaign builder, reward/proof settings, funding, reporting, settlement. | DEV §11.4 | CONFIRMED | PARTIAL (one campaign type) |
| WEB-005 | Admin console modules: safety map (freeze/unfreeze), claim review (privacy-minimised), merchant approval, campaign moderation, validator management, treasury dashboard, market control (post-alpha), protocol parameters, audit export. | DEV §11.5 | CONFIRMED | PARTIAL |
| WEB-006 | Strong typed API client; OpenAPI + JSON Schema for all API surfaces; versioned schemas; no duplicated constants (config-driven chain IDs, addresses, levels, thresholds). | DEV §4.1 | CONFIRMED | IN |

---

## 12. Exchange requirements

| ID | Requirement | Source | Class | Alpha |
|---|---|---|---|---|
| EXC-001 | Staged path — Alpha: simulated price / closed campaign credits, NO exchange. Private beta: controlled internal marketplace, KYC-gated. V1: compliant marketplace with KYC thresholds. Production: regulated model only after legal sign-off. | SYS §14.2, HARD §8.3, DEV §12.1 | CONFIRMED | IN (closed credit model only) |
| EXC-002 | The exchange is the highest regulatory-risk component; MiCA/CASP analysis required before any public exchange, custody, transfer, fiat conversion, or public token market. | HARD §8.2, §12.2 | BLOCKER + LEGAL | N/A |
| EXC-003 | Initial price is a reference price for pilot campaign accounting only — never a promise of market value. | HARD §8.4 | CONFIRMED | IN (displayed with disclaimer) |
| EXC-004 | Market manipulation controls when live: TWAP, trade size limits, miner sell cooldown, fraud hold, KYC thresholds, public market data, treasury sale disclosure. | HARD §8.6, SYS §14.4 | CONFIRMED (for beta+) | OUT |
| EXC-005 | Exchange components when built: order/AMM engine, liquidity pool, TWAP oracle, trade ledger, fee engine, compliance gate, treasury monitor, market dashboard. | DEV §12.2 | CONFIRMED (for beta+) | OUT |

---

## 13. Data, indexing, and infrastructure requirements

| ID | Requirement | Source | Class | Alpha |
|---|---|---|---|---|
| DAT-001 | PostgreSQL + PostGIS for operational/analytical data (POIs, geocoding, reporting, fraud analytics, safety areas, cached geometry) — never the source of final economic truth. | DEV §13.2 | CONFIRMED | IN |
| DAT-002 | Blockchain is the source of final economic truth. | DEV §1, §5.1 | CONFIRMED | IN |
| DAT-003 | IPFS-compatible content-addressed storage for encrypted proof bundles; pin via self-hosted nodes; CID/hash on-chain only; retention and deletion policies for sensitive off-chain data. | DEV §13.3 | CONFIRMED | IN |
| DAT-004 | Indexer: The Graph or custom (custom easier for alpha); indexed entities per DEV §14.2; PostgreSQL materialised views for dashboards. | DEV §14.1–14.2 | RECOMMENDED | IN (custom indexer) |
| DAT-005 | Data classification table (DEV §13.1) governs what is public, on-chain, encrypted, or internal. | DEV §13.1 | CONFIRMED | IN |
| DAT-006 | Observability: OpenTelemetry + Prometheus + Grafana + Loki; required dashboards per HARD §16.4 (mining, MESH, validator, tokenomics, exchange, campaigns, safety, privacy). | DEV §3.1, HARD §16.4 | CONFIRMED | PARTIAL (core mining/MESH/validator/campaign dashboards) |
| DAT-007 | Docker + Compose local env: PostgreSQL/PostGIS, IPFS node, indexer, validator node, gateway API, merchant API, Prometheus, Grafana, Loki, Anvil. | DEV §19.2 | CONFIRMED | IN |
| DAT-008 | Env files (.env.local/.testnet/.alpha/.production), no committed secrets, config groups per DEV §19.3. | DEV §19.3 | CONFIRMED | IN |
| DAT-009 | Background jobs (claim processing, indexing, fraud review, campaign expiry) via Temporal OSS or Faktory/Redis. | DEV §3.1 | RECOMMENDED | IN (one chosen in ADR) |
| DAT-010 | IaC via OpenTofu; container scanning (Trivy); secret scanning (gitleaks); dependency audits (cargo audit, npm audit, osv-scanner). | DEV §3.1, §17.2 | CONFIRMED | PARTIAL (CI checks in; OpenTofu when first remote deploy happens) |

---

## 14. Safety requirements

| ID | Requirement | Source | Class | Alpha |
|---|---|---|---|---|
| SAF-001 | STEP must never create financial incentive to trespass, enter restricted areas, behave dangerously, or violate venue rules. | HARD §14.1, SYS §20.5 | CONFIRMED | IN |
| SAF-002 | SafetyRegistry of blocked/restricted triangles: military, airports, railways/motorways, schools, hospitals, construction, private property without rights, dangerous natural areas, age-restricted zones, crowd-risk zones. | DEV §16.1, HARD §14.2 | CONFIRMED | IN |
| SAF-003 | Safety engine functions: isTriangleBlocked, getRestrictionReason, freezeTriangle, unfreezeTriangle, validateMerchantRights, safeAccessPoint. | DEV §16.2 | CONFIRMED | IN |
| SAF-004 | Emergency freeze state flow: active → frozen → reviewed → restored or permanently_blocked; all emergency actions logged and publicly reviewable. | HARD §14.4, §11.4 | CONFIRMED | IN |

---

## 15. Privacy requirements

| ID | Requirement | Source | Class | Alpha |
|---|---|---|---|---|
| PRV-001 | Raw GPS location history never on public blockchain (master privacy rule). | HARD §13.1 | CONFIRMED | IN |
| PRV-002 | Data category table (HARD §13.2) governs on-chain vs encrypted off-chain vs internal storage. | HARD §13.2 | CONFIRMED | IN |
| PRV-003 | Retention by purpose: fraud review (short-medium), merchant dispute (until window ends), legal obligation (jurisdictional), proof hash (permanent on-chain), user account data (deletable where required). | HARD §13.3 | CONFIRMED | IN |
| PRV-004 | User profile modes: private (default), pseudonymous, public explorer. Default must be privacy-protective. | HARD §13.4 | CONFIRMED | IN |
| PRV-005 | GDPR: explicit consent, data minimisation, purpose separation, access/export rights, deletion mechanisms, privacy impact assessment before location proof storage. | SYS §20.4, HARD §12.4 | LEGAL + CONFIRMED | IN (PIA is a gate before pilot) |

---

## 16. Legal and compliance requirements

| ID | Requirement | Source | Class | Alpha |
|---|---|---|---|---|
| LEG-001 | Legal risk register required covering: MiCA/CASP, AML/KYC, GDPR/location privacy, tax (miners + businesses), consumer protection, internal exchange, app-store crypto rules, merchant campaign liability, restricted businesses/locations, advertising law. | Master prompt §8; SYS §20; HARD §12 | CONFIRMED | IN (register exists; resolutions are external) |
| LEG-002 | Open legal classification questions (HARD §12.3): Trinity classification, CASP authorisation, fiat sell, business purchase, foundation market-making, mining tax, custody obligations. All marked "legal opinion required". | HARD §12.3 | BLOCKER (for the respective features) | N/A |
| LEG-003 | Compliance gates (HARD §12.4): legal memo before token sale/exchange; PIA before proof storage; AML policy before cash-out; merchant terms before paid campaigns; consumer terms before rewards/wallet; tax guidance; app-store review. | HARD §12.4 | CONFIRMED | IN (gates enforced in roadmap) |
| LEG-004 | Alpha compliance posture: no open public exchange, no fiat cash-out, no investment-return marketing, testnet/closed-loop credits, real merchant visits only with signed legal terms. | HARD §12.5 | CONFIRMED | IN |
| LEG-005 | Nothing in project documentation is legal advice; professional legal review required before token issuance, exchange operation, fiat acceptance, or user Trinity sales. | SYS §20.1 | CONFIRMED | IN |

---

## 17. Engineering process requirements

| ID | Requirement | Source | Class | Alpha |
|---|---|---|---|---|
| ENG-001 | Coding standards: English comments/UI, no mock business data in production code, no hardcoded addresses/parameters, no raw GPS in logs, no secrets in repo, tests for every critical module, versioned schemas, events on every contract, documented economic rules. | DEV §23.1 | CONFIRMED | IN |
| ENG-002 | Every feature ships with: implementation, tests, schema/interface update, documentation update, migration note if data changed, security/privacy note if location/wallet/money involved. | DEV §23.2; master prompt §3 | CONFIRMED | IN |
| ENG-003 | CI per component: iOS build+tests, Rust fmt/clippy/test/audit, Foundry build/test/fuzz/coverage/Slither, web typecheck/lint/tests/Playwright, Docker build+scan, docs lint+linkcheck, schema validation. | DEV §20.1 | CONFIRMED | IN |
| ENG-004 | Release channels: local → internal alpha → TestFlight alpha → merchant pilot → public testnet beta → production (only after legal, security, market controls). | DEV §20.2 | CONFIRMED | IN |
| ENG-005 | Development order: MESH first → one triangle claim from iPhone → testnet contract finality → merchant oasis → validator quorum → explorer/dashboard → controlled city alpha → only then real exchange. | DEV §25 | CONFIRMED | IN |
| ENG-006 | Definition of Done per master prompt §3 (implementation, tests, manual verification steps, docs, commit, push, deployability, no hidden regressions, no placeholders, assumptions recorded, security/privacy review, product-logic consistency). | Master prompt §3 | CONFIRMED | IN |

---

## 18. Open decisions index (cross-reference)

All `DECISION` items are tracked as ADRs (see `STEP_architecture_decision_records.md`). The decisions that block the most downstream work, in dependency order:

1. **Trinity denomination** (TOK-001) → blocks collector slots, reward curve, supply maths.
2. **Mineable depth set** (MESH-012) → defaults to 1–25 depth for this alpha, with local availability determined by parent exhaustion at the target coordinate.
3. **Collector slots + reward curve** (TOK-008) → blocks TriangleMiningState and reward tests.
4. **Foundation twin schedule** (TOK-005/006) → blocks Treasury contract finalisation and tokenomics constitution.
5. **MESH v1 freeze** (MESH-013: orientation, edges, ID encoding, tolerances) → blocks cross-platform golden tests.
6. **Chain selection for pilot testnet** (SC-005) → blocks public-facing pilot deployment (not local dev).
7. **Legal classification set** (LEG-002) → blocks exchange, cash-out, public token discussion.

Alpha strategy for 1–4: implement as **named, configurable protocol parameters** with documented alpha defaults, clearly marked as unfrozen (per master prompt §6.3). Alpha strategy for 5: freeze a v1 MESH spec for alpha geography; version it so a v2 can supersede before mainnet.
