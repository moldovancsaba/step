# STEP Foundation Treasury Rules

**Version:** 0.1 (alpha, as implemented) · **Date:** 2026-06-12 · **Contract:** [`FoundationTreasury.sol`](../../contracts/src/FoundationTreasury.sol)

## 1. Income (alpha)

Sole alpha income: the twin allocation on every natural mint at `treasury.twin_bps` (UNFROZEN, 100% bootstrap default, optional lifetime cap `twin_cap_trinity`). Exchange/campaign/premium-proof fees are post-alpha (no exchange exists; pilot merchants are not charged — HARD §4.9 "do not charge casual miners in the alpha" extended to pilot merchants).

## 2. Transparency by construction (HARD §11.3)

- The treasury **is** the contract address: balance is public chain state; the explorer `/treasury` page renders lifetime twin and every withdrawal.
- Every twin emits `FoundationTwinAllocated(claimHash, amount)`; every outflow requires `TREASURER_ROLE` and emits `TreasuryWithdrawal(to, amount, purposeCode)` — un-reason-coded movement is impossible.
- Purpose codes in use: `VALIDATOR_GRANTS`, `PILOT_CAMPAIGN_GRANT`, `OPERATIONS`, `SECURITY`, `LEGAL`, `GRANTS` (extensible; each new code must be added here before first use).
- Twin-rate changes go through the parameter timelock (schedule→delay→apply, all evented). Cap mechanism implemented and tested.

## 3. Spending rules (alpha)

Permitted: validator operation grants, pilot campaign grants to approved merchants (this is how sponsored Trinity enters circulation without minting — TOK-003), security/audit, legal, operations. Forbidden: any market activity (no exchange exists), any transfer without a purpose code, any sale (testnet Trinity is valueless and non-transferable to fiat by policy LEG-004).

## 4. Pre-production obligations (not yet satisfiable — tracked)

Sale schedule + per-period caps, bootstrap lockups, independent treasury audit, multisig/timelock custody of `TREASURER_ROLE` (alpha uses an env admin key — known gap in the release log), and the ratified twin schedule (OPEN-2: recommended bootstrap-high → declining → capped). The HARD §4.8 "no hidden dumping" rule is structurally enforced already; the quantitative limits await the tokenomics constitution.
