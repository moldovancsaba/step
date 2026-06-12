# STEP Data Models

**Version:** 0.1 (alpha, as implemented) · **Date:** 2026-06-12

## 1. Authority hierarchy (DAT-001/002)

1. **Chain state** — the only economic truth: balances, slots, campaign budgets/status, freezes, validator registry, treasury, parameters.
2. **Encrypted evidence vault** — the only home of raw location data.
3. **Projections** (indexer) and **registries** (merchant-api POIs, gateway claim records) — rebuildable; alpha keeps them in memory because the chain/vault can reconstruct them at pilot scale (Postgres/PostGIS lands at public-testnet per the release log).

## 2. Canonical entities

**Claim** (`step.proof.location.v1`, schema-validated in CI): identity = `claim_hash = keccak256(canonical message)`. Sensitive form (with coordinates) exists only device→validator→vault; hash form everywhere else.

**Evidence bundle** (`step.evidence.bundle.v1`): claim + validator signatures (approve *and* reject) + attestation verdicts + fraud score + optional merchant confirmation; encrypted per-bundle; addressed by CIDv1(raw, sha2-256); on-chain commitment = keccak256(cid).

**Triangle**: identity = ID string per step-mesh-v1; on-chain key = keccak256(string). Geometry is *computed, never stored* (the mesh engine is the database). Mutable state on-chain: `usedSlots, lastMinedAt` (+ freeze in SafetyRegistry); projection adds display aggregates (total mined, oasis links).

**Campaign**: on-chain struct — merchant, rewardPerClaim, budget/released/refunded, window, maxClaimsPerWallet, requiredProofLevel (1–5), refundPolicy, status enum (10 states), triangle-membership mapping, per-wallet claim counts.

**Validator**: on-chain — type enum, weight, status enum, stake; projection adds slashed totals.

**Treasury**: `totalTwinMinted` + reason-coded withdrawal events; balance is the token balance of the contract address.

**Merchant/POI** (off-chain registry): merchant {id, name, category, status, rights_confirmed}; POI {id, merchant, name, lat/lon (operational data, never on-chain), level, canonical triangle id+hash}.

**Credits ledger** (closed pilot accounting): per-merchant balance + grant/conversion entries with Trinity equivalents at the reference price.

## 3. Identity/hash conventions

See [atomic system design §5](../architecture/STEP_atomic_system_design.md) — claim hash, triangle hash, EIP-191 miner signature, EIP-712 vote digest; cross-language conformance pinned by committed vectors.

## 4. Privacy classification (every store, HARD §13.2)

| Store | Coordinates? | Public? |
|---|---|---|
| Chain | never (no ABI field exists) | yes |
| Evidence vault | encrypted only | no — foundation token, deletable via key destruction |
| Validator/gateway logs | never (hashes + reason codes) | no |
| Indexer/explorer | never | yes (hash-level) |
| Merchant-api POIs | merchant's own POI coords (business data, merchant-consented) | no |
| iOS device | user's own samples, transient + Keychain key | n/a |
