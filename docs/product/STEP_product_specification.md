# STEP Product Specification

**Version:** 0.1 (alpha) · **Date:** 2026-06-12

## 1. Definition

STEP is a market for verified physical presence. The Earth is divided into a deterministic spherical triangular MESH (`step-mesh-v1`: icosahedral, 4-way subdivision, ~6.7 m triangles at the mineable level 21). A miner earns **Trinity** — the smallest, indivisible unit of the STEP economy — by being physically inside a triangle and submitting a signed proof-of-presence that independent validators verify and smart contracts finalise. Businesses buy verified visits by funding **Trinity oases**: triangles loaded with pre-existing Trinity that release rewards only against accepted proofs.

The single protocol question: *Was this miner physically present inside this spherical triangle at this time?*

**Negative definition (binding):** not a walking app, not step counting, not health-app integration, not move-to-earn, not a passive-income or guaranteed-return product. No code path reads pedometers, workouts, distance, or HealthKit.

## 2. Roles and value exchange

| Role | Gives | Gets |
|---|---|---|
| Miner | Verified physical visits | Trinity, collection/status |
| Business | Campaign budget (pilot: foundation-granted credits) | Verified foot traffic with on-chain reporting; never charged for rejected claims |
| Validator | Independent proof checking (geometry, fraud, signatures) | Fees/foundation support (alpha), reputation |
| Foundation | Protocol operation, safety, moderation | Twin allocation (public, parameterised) + fees |
| Trader | Liquidity (post-alpha, post-legal only) | Market participation |

## 3. Core mechanics (implemented)

1. **Natural mining:** each triangle has finite collector slots (alpha parameter: 27) with a halving reward curve floored at 1 Trinity; once exhausted the triangle is a **Trinity desert** until re-seeded by sponsorship. Opening delay and post-claim cooldown are timed parameters.
2. **Twin allocation:** every natural mint allocates a configurable twin to the public treasury (alpha default 100% bootstrap rate, optionally capped) — included in supply accounting from the first mint.
3. **Sponsored oases:** campaign Trinity is always pre-existing supply, escrowed before activation, released per accepted claim, refunded/rolled per declared policy at expiry. Per-wallet limits, time windows, triangle sets, and proof-level requirements are on-chain campaign state.
4. **Proof tiers:** L1 GNSS+app integrity → L2 +validator quorum (alpha standard) → L4 merchant rotating-QR for commercial campaigns. L3/L5 post-alpha.
5. **Safety:** reason-coded triangle freezes block finalisation instantly; restricted merchant categories are rejected at onboarding; no incentive may direct people into unsafe or restricted places.
6. **Privacy:** coordinates exist only in the signed claim sent to validators and in the encrypted evidence vault; the chain stores hashes only; deletion = evidence-key destruction; miner profiles default to private.

## 4. Miner experience (alpha app)

Onboarding explains location use plainly → self-custodial wallet in Keychain → location permission → map/triangle view → one-tap Mine → live status (validating → finalised/rejected with reasons) → balance and history → privacy controls. Testnet banner everywhere: pilot Trinity has no monetary value.

## 5. Merchant experience (alpha dashboard)

Managed accounts — merchants never touch crypto (sales line: *"Pay for verified visits, not impressions"*). Register (restricted categories blocked; location-rights confirmation mandatory) → foundation approval → POI with canonical triangle mapping → front-door oasis: reward per visit, duration, budget from granted campaign credits at the published reference price (with the mandatory "not a market price" disclaimer) → live chain-truth reporting (verified visits, released, refunded).

## 6. Success criteria

Alpha passes when (DEV §21.3): ≥95% valid-claim correctness, near-zero false acceptance under spoof/replay tests, ≥3 completed real merchant campaigns, 100–500 TestFlight miners, acceptable claim latency, zero unsafe-location incidents, accurate merchant reporting. KPIs tracked: acceptance/false-rejection/fraud-rejection rates, cost per verified visit, repeat usage, validation time, QR redemption, support load, battery impact.

## 7. Explicitly out of alpha scope

Open exchange or any fiat path, ICO/token sale, global mining, open validator registration, DAO, NFTs, high-value rewards, merchant self-service, campaign pricing engine, Android. See [alpha scope](../operations/STEP_alpha_scope.md) for the binding list.
