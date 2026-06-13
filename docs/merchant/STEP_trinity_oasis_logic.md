# STEP Trinity Oasis Logic

**Version:** 0.1 · **Date:** 2026-06-12

## 1. Deserts and oases (the demand engine)

Natural supply per triangle is finite (slots × halving curve). High-traffic places mine out first and become **Trinity deserts** — visibly dark on the MESH map. A **Trinity oasis** is sponsored re-seeding: a business escrows pre-existing Trinity against selected triangles so verified visitors earn again. Binding scarcity rule (TOK-004/HARD §10.2): **sponsorship never resets natural mining history** — `TriangleMiningState.usedSlots` is untouched by campaigns; natural exhaustion is permanent per triangle. And sponsored Trinity is never newly minted (TOK-003, E2E-proven supply conservation).

## 2. Oasis state model (HARD §10.3 → implementation)

| HARD state | Implementation |
|---|---|
| Planned | `PendingReview`/`Approved` (no budget yet) |
| Funded | `Funded` (escrow locked, not yet active) |
| Active | `Active` within `[startsAt, endsAt)` |
| Partially mined | `Active` with `released > 0` |
| Empty | `Completed` (budget can't pay another claim) |
| Expired | `Expired` (permissionless transition past endsAt) |
| Refunded | `refunded` accounting after policy settlement |
| Disputed | `Paused`/`Cancelled` by moderation (admin claim review in alpha) |

## 3. Map semantics (SYS §7.6 / HARD §10.4, implemented in the explorer)

White untouched · grey partially mined · black Trinity desert (slots exhausted) · blue oasis (active campaigns on the triangle) · red restricted/frozen. "Sponsored rich mine" (natural + sponsored simultaneously) renders as oasis-priority — both reward paths are simultaneously claimable since natural and sponsored claims are independent transactions.

## 4. Oasis types (alpha subset of the full catalogue)

Implemented end-to-end: **front-door oasis** (single triangle at entrance, L4 QR proof, per-wallet limit 1). The contracts already accept triangle *sets*, arbitrary windows, and per-wallet limits, so venue/route/event oases are dashboard-UI work, not protocol work. The full catalogue (in-store, venue, event, route, landmark, conquest-with-legal-review, loyalty, sampling, desert refill, virtual brand) is specified in the [campaign system doc](STEP_merchant_campaign_system.md) source requirements and gated on pilot learnings.

## 5. Miner-facing discovery

The app's oasis path: nearby campaign display (reward, proof requirement, merchant rules) → physical visit → QR scan at the door → claim with `campaign_id` + `merchant_proof` → sponsored Trinity on acceptance. The explorer shows public campaign status for transparency without exposing miner identities.
