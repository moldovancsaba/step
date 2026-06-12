# STEP Legal Risk Register

**Version:** 0.1 · **Date:** 2026-06-12
**Nothing here is legal advice (SYS §20.1).** Every item below requires external counsel; this register tracks exposure, the engineering posture that limits it today, and what is blocked until resolution. Owner: foundation/legal (OPEN-5/6).

| # | Risk area | Exposure | Alpha engineering posture (implemented) | Blocked until counsel resolves |
|---|---|---|---|---|
| L1 | MiCA crypto-asset classification of Trinity | Whitepaper/issuer duties if in scope | Internal testnet only; explicit "no monetary value" banners; no public supply numbers (constitution DRAFT-gated) | Any public token communication, testnet→mainnet move |
| L2 | CASP licensing (exchange/custody/transfer services) | Highest-risk component (HARD §8.2) | **No exchange code exists**; closed credits with mandatory non-market disclaimer; miners cannot sell | Exchange phases 2–3 |
| L3 | AML/KYC | Cash-out and trading triggers | No fiat paths anywhere; no user↔user transfers in product flows | Any sell/cash-out feature, KYC thresholds |
| L4 | GDPR / location privacy | Sensitive-data processing | Structural no-GPS-on-chain; encryption; key-destruction deletion; private-by-default profiles; minimal one-shot location | PIA + privacy policy sign-off before TestFlight pilot |
| L5 | Tax (miner income, merchant expense) | Jurisdiction-dependent | Valueless testnet Trinity in pilot; merchant settlement via pilot agreement | Tax guidance before any real-value reward |
| L6 | Consumer protection | Reward terms, permanence of chain records | Pre-claim permanence warning; clear rejection reasons; refund policies on-chain | Consumer terms before pilot |
| L7 | App Store crypto rules | Distribution rejection/removal | Wallet is self-custodial; no purchases, no token sale in-app; testnet | App-store review consult before TestFlight (IOS-008) |
| L8 | Merchant campaign liability | Safety, premises rights, advertising law | Mandatory rights/safety confirmation; restricted-category hard block; moderation + instant freeze | Merchant pilot agreement template |
| L9 | Restricted locations / safety | Incentivised trespass or danger | SafetyRegistry freezes (contract-enforced, E2E-proven); reason codes; no campaign without rights confirmation | Pilot-area safety review with local input |
| L10 | Advertising / financial promotion law | "Earnings" framing risk | No income/appreciation language anywhere (PRD-008 enforced in copy); trader-facing copy avoided entirely in alpha | Marketing review before public visibility |
| L11 | Foundation market-making / treasury sales | Market abuse exposure | No market exists; treasury moves reason-coded and public | Treasury sale schedule + venue rules (phase 2+) |
| L12 | Custody model (embedded wallet) | Wallet-provider obligations | Self-custodial keys on device (Keychain); merchants are managed accounts within a closed pilot | Custody opinion (OPEN-5) before scale |

**Compliance gates wired into the roadmap (HARD §12.4 → M6.2):** legal memo before any token sale/exchange · PIA before evidence storage at pilot scale · AML policy before any cash-out · merchant terms before paid campaigns · consumer terms before rewards · tax guidance · app-store review. Engineering treats each as a release blocker, not advice.
