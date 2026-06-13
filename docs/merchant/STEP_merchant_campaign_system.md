# STEP Merchant Campaign System

**Version:** 0.1 (alpha, as implemented) · **Date:** 2026-06-12
**Code:** [`CampaignRegistry.sol`](../../contracts/src/CampaignRegistry.sol), [`RewardPool.sol`](../../contracts/src/RewardPool.sol), [`services/merchant-api`](../../services/merchant-api), [`apps/merchant-dashboard`](../../apps/merchant-dashboard)

## 1. Commercial frame (binding)

Merchants buy **verified physical visits** — never crypto (PRD-007). Alpha accounts are foundation-managed (MER-009): no wallets, no gas, no token UX in the merchant path. Budgets come from granted campaign credits at the published reference price with the mandatory non-market disclaimer (ADR-011).

## 2. Onboarding gates (implemented in merchant-api)

Registration requires a permitted category — the SYS §20.6 restricted list (alcohol, tobacco, gambling, adult, weapons, controlled substances, political targeting, medical claims, financial promotions) is **rejected at HTTP 422**, and an explicit location-rights/safety/legality confirmation (HARD §14.3) is mandatory. All approvals are foundation-token-gated (alpha is admin-approved, MER-001). POIs map to canonical triangles via the mesh API; the merchant never types a triangle ID.

## 3. Campaign state machine (on-chain, DEV §15.2)

`PendingReview → Approved → Funded → Active → {Paused ⇄ Active} → Completed | Expired`; `Rejected`/`Cancelled` branches. Enforced rules, each with tests:
- **Pre-funding (OAS-005):** activation reverts unless Funded; funding reverts unless Approved and from the campaign's merchant, minimum one reward.
- **Release only on accepted proof:** the only path to merchant budget is the verifier's `finaliseSponsoredClaim` after validator quorum — *rejected claims structurally cannot charge the merchant.*
- **Per-wallet limits, time windows, triangle membership:** on-chain checks; violations revert with typed errors.
- **Empty oasis:** when remaining budget can't pay another claim → `Completed` (HARD §10.3 Empty), dust follows the policy.
- **Expiry/refund:** permissionless `expireCampaign` past `endsAt`; `refund` settles remainder per the campaign's declared policy (`ReturnToMerchant` or `ToTreasury`); double-refund impossible. The campaign-worker drives both automatically from chain state.
- **Moderation:** foundation can reject pre-fund, pause/cancel any time (fraud/legal, HARD §11.4) — cancel refunds the full remaining budget.

## 4. Proof levels for campaigns (alpha: L4 QR)

Rotating QR per POI: `stepqr1:{poi}:{5-min window}:{keyed tag}`, issued by merchant-api, scanned by the miner app into `merchant_proof`, verifiable by merchant validators with one previous-window skew tolerance. POS/NFC/BLE are post-alpha tiers.

## 5. Reporting (chain-truth)

The dashboard's campaign list renders indexer projections of contract events — verified visits, released, refunded are exactly what settled on-chain; there is no separate book to reconcile. Per-visit drill-down joins `SponsoredRewardClaimed` events.

## 6. Known alpha cuts (tracked in release log)

Map-based triangle selector (lat/lon entry + canonical resolution instead); campaign pricing engine (MER-006, V1 — rewards set manually); invoicing/tax docs (pilot agreement covers settlement); multi-triangle and non-front-door campaign types (contract supports triangle sets already; UI exposes front-door only).
