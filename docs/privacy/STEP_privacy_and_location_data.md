# STEP Privacy and Location Data

**Version:** 0.1 (alpha, as implemented) · **Date:** 2026-06-12

## 1. Master rule and its enforcement

**Raw location data never reaches the public blockchain (PRV-001/HARD §13.1).** This is structural, not procedural: the contract ABI for claim finalisation has no coordinate fields; the on-chain record is claim hash, triangle hash, miner, slot/campaign, amount, proof-CID hash, quorum signatures. The E2E privacy posture is testable by ABI inspection.

## 2. Where coordinates exist (the complete list)

1. **Device memory** (Core Location sample → claim builder).
2. **Validator request bodies** (TLS in deployment). Validator logs are structured JSON carrying claim hashes and reason codes — never coordinates (asserted by code review of every `tracing::` call; a log-scan check is part of the E2E privacy sweep E2E-8 in the test plan).
3. **Encrypted evidence bundles** (`step.evidence.bundle.v1`): per-bundle XChaCha20-Poly1305 key, wrapped under the foundation master key; CIDv1 addressing; storage tests assert ciphertext-at-rest contains no coordinate substrings.

Gateway claim records, indexer rows, and explorer pages are hash-level only. The public explorer shows triangle-level activity, never identities (miner profiles default to **Private**, HARD §13.4).

## 3. Deletion and retention (ADR-014, PRV-003)

Content-addressed storage cannot guarantee content erasure, so **deletion = destruction of the wrapped bundle keys**, after which the ciphertext is permanently unreadable — implemented, tested (read-after-destroy returns 404; destruction is idempotent), and logged (`evidence_key_destroyed`) for the privacy dashboard. Retention by purpose (fraud review short-term, dispute window, legal holds) runs as scheduled key destruction; users are told before their first claim that on-chain hashes are permanent.

## 4. User rights and controls (implemented surface)

- Onboarding states plainly: location is used only to build a proof when the user taps Mine; no background tracking (one-shot fixes only); no third-party analytics receive location (none are integrated at all in alpha).
- Profile modes: Private (default) / Pseudonymous / Public explorer.
- Export and off-chain deletion via pilot support (foundation-token-gated vault endpoints exist); on-chain permanence warning shown pre-claim.

## 5. Access control to evidence

Vault reads require the foundation bearer token and exist solely for claim review/disputes under HARD §13.3 — never public, never merchant-visible (merchants see aggregate verified visits only). Alpha key custody = env master key; managed KMS + per-reviewer audit logging are pre-pilot requirements (tracked).

## 6. Open compliance work (LEG gates — external)

GDPR privacy impact assessment, consumer privacy policy, retention-schedule sign-off, and processor agreements are mandatory gates before the TestFlight pilot (LEG-003/PRV-005). Engineering prerequisites for all four are in place.
