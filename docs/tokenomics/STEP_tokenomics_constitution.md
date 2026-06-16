# STEP Tokenomics Constitution — DRAFT

**Version:** 0.1 DRAFT · **Date:** 2026-06-12
**Status: NOT RATIFIED.** Every value below marked UNFROZEN is a working alpha parameter, not a decision. Ratification requires the owner decisions OPEN-1/2/3/8 (ADR log) and the independent MESH mathematical audit (MESH-014). Until ratification, no whitepaper, investor material, or public supply statement may cite these numbers (HARD §4.1). This draft exists so the *mechanisms* are specified and testable while the *values* stay honest.

## 1. Ratified mechanisms (implemented and frozen as mechanisms)

1. **Trinity is structurally indivisible** — `TrinityToken.decimals() == 0`; mint of 0 reverts (PRD-004).
2. **Exactly two mint paths**: natural mining rewards via the claim verifier, and the foundation twin via the treasury — both claim-driven (TOK-002). The supply invariant `totalSupply == minerMints + twinMints` is enforced by fuzzed invariant tests and re-checked in E2E.
3. **Sponsored Trinity is never minted** (TOK-003): campaign budgets are pre-existing supply escrowed in RewardPool; E2E proves totalSupply is unchanged across sponsored claims.
4. **Twin allocation on every natural mint** at `treasury.twin_bps` with optional lifetime cap, fully evented, treasury address public by construction.
5. **Reward curve floor**: no slot may yield < 1 Trinity — validated at parameter scheduling, re-validated at timelock apply, and required at consumption.
6. **Every economic constant is a governed time-locked parameter** (schedule → delay → apply, evented) — never code.
7. **Sinks implemented in alpha**: campaign escrow locks; refund-to-treasury policy. (Staking, dispute bonds, burns: mechanisms reserved, not implemented — see §3.)

## 2. UNFROZEN parameters (alpha defaults; the registry is authoritative)

| Output (HARD §4.11) | Alpha default | Blocking decision |
|---|---|---|
| 1 STEP : Trinity ratio | 67,108,864 | OPEN-1 |
| Mineable levels | [21] | ADR-003 confirm + audit |
| Triangle count at level 21 | 21,990,232,555,520 (implementation-verified) | MESH-014 independent audit |
| Collector slots / triangle | 27 | OPEN with tokenomics |
| Reward curve | geometric halving from 2²⁶ Trinity (slot 27 = exactly 1) | OPEN with tokenomics |
| Max natural supply | slots×curve×count — **deliberately not published pre-audit** | MESH-014 + above |
| Twin rate / cap | 10000 bps, uncapped (testnet bootstrap) | OPEN-2 |
| Max total supply model | undecided | OPEN-3 |
| Burn policy | none in alpha | OPEN-8 |
| Validator rewards | foundation-funded in alpha | OPEN-9 |
| Exchange fees | none (no exchange in alpha) | LEG-002 first |
| Campaign refund rules | ReturnToMerchant \| ToTreasury, on-chain per campaign | ratified as mechanism |
| Reference price | 1 EUR/STEP, accounting-only with mandatory disclaimer | pilot calibration |
| Transparency dashboard | explorer /treasury + params view | shipped |

## 3. Reserved mechanisms (specified, intentionally unimplemented in alpha)

Validator/merchant staking and slashing economics (registry has stake slots and slash events; amounts/yields = OPEN-9); dispute bonds (DisputeManager is post-alpha — admin claim review covers alpha); fee burns (treasury can implement via reason-coded withdrawal to a burn address once OPEN-8 decides).

## 4. Inflation-risk statement (HARD §4.7 obligation)

A permanent 100% twin doubles effective issuance. The alpha default is the *documented bootstrap phase* on a valueless testnet; the constitution cannot be ratified with an unlimited 1:1 twin unless max supply is explicitly designed around it. The recommended ratification shape remains bootstrap-high → declining → capped/governed, with the cap mechanism already implemented and tested.

## 5. Ratification procedure

1. MESH-014 independent audit of counts/areas/supply arithmetic.
2. Owner resolves OPEN-1/2/3/8, including whether `67,108,864` remains canonical and whether 27 slots with geometric halving are kept.
3. UI and accounting teams publish the denominator mapping as: `1 STEP = 67,108,864 Trinity`; first mineable slot at any mineable triangle starts at `slot 0 = 67,108,864`.
4. This document is rewritten with final values and loses its DRAFT banner.
5. On-chain parameters are scheduled/applied through the timelock with public notice.
6. Only then may external materials cite definitive supply or emissions figures.

## 6. Operational answers for the first beta run

1. How many times can a triangle be mined naturally? `27` times (default `collector_slots_per_triangle`).
2. How many breakdown levels are available? The deterministic subdivision is recursive and 4-way per level (`step-mesh-v1` supports deep levels by recursion; the protocol enforces mineable levels by configuration).
3. How much Trinity does a miner earn? `slot 0` starts at `67,108,864`; each next slot divides by 2, and the protocol blocks any slot reward < `1` Trinity.
4. How is a claim approved? A claim is approved only when it passes validator quorum checks and all acceptance gates (geometry, signature, freshness, precision, cooldown/open state, and no fraud reasons). Rejection reasons are returned by the gateway/contract and shown to the miner.
5. Can I mine the same triangle twice with the same wallet? No. A wallet can consume each natural triangle slot only once.
