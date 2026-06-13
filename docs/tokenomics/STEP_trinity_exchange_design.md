# STEP Trinity Exchange Design

**Version:** 0.1 · **Date:** 2026-06-12 · **Binding rule:** the exchange is the highest regulatory-risk component (HARD §8.2). Phases 2+ are BLOCKED on external legal review (LEG-002/EXC-002). No market code exists in the repo by design — this is verifiable by inspection of `services/exchange-service`.

## Phase 1 — Alpha (IMPLEMENTED): closed campaign credits, no market

- Foundation grants EUR-denominated campaign credits to approved pilot merchants (off-market, token-gated admin endpoint).
- Credits convert to a **Trinity budget figure** at the published reference price (`campaigns.reference_price_eur_per_step`, UNFROZEN) with floor-rounding to whole Trinity; the actual Trinity lock happens on-chain from previously-mined supply (treasury grant → merchant → RewardPool escrow), so scarcity is never bypassed.
- **Every API response carries verbatim:** *"Reference price for pilot campaign accounting only — not a market price, not a promise of value or investment return."* (HARD §8.4)
- No user↔user trades, no fiat in/out, no order book, no AMM, no price discovery. Miners cannot sell.

## Phase 2 — Private beta (DESIGNED, BLOCKED on legal): controlled internal marketplace

Gates before any code: legal memo on CASP/MiCA classification, AML policy, KYC provider, custody decision (OPEN-5/6). Design when unblocked: KYC-gated participants; batch auctions (manipulation-resistant at thin liquidity, HARD §12.3 option) or capped AMM; TWAP reference for campaign pricing; miner sell cooldown + fraud holds; trade size limits; full public market data; foundation trades pre-disclosed (HARD §8.6 control set).

## Phase 3 — Production (BLOCKED on legal sign-off)

Regulated venue or licensed partner; fee split (foundation/validators/optional burn) becomes a tokenomics-constitution parameter; treasury sale schedule per the [treasury rules](STEP_foundation_treasury_rules.md).

## First-price doctrine

The first real business purchase creates the first meaningful price signal (SYS §14.3); everything before it is accounting reference only. Marketing may never promise appreciation (PRD-008) — the compliant trader line is: *"Trinity is the settlement unit of a geospatial proof-of-presence economy."*
