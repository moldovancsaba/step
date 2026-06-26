# STEP Incident Response

**Version:** 0.1 (alpha) · **Date:** 2026-06-12 · Owner: foundation operations. Every emergency action below is an on-chain event and therefore publicly reviewable by design (HARD §11.4).

## 1. Severity ladder and first moves

| Sev | Example | First move (implemented control) |
|---|---|---|
| S1 protocol exploit | mint bug, quorum bypass | `StepAccess.setPaused(PAUSE_MINTING, true)` — blocks all natural mints instantly (E2E-verified round trip) |
| S1 campaign exploit | escrow drain, release bypass | `setPaused(PAUSE_CAMPAIGNS, true)` — blocks funding and sponsored releases |
| S2 fraud cluster | spoofing ring beating L1/L2 | suspend implicated validators (`ValidatorRegistry.setStatus`), freeze affected triangles, tighten `fraud_score_reject_threshold` via param timelock |
| S2 safety incident | claims from a dangerous/restricted spot | `SafetyRegistry.freezeTriangle(id, reasonCode)` — contract-enforced immediately (E2E-5) |
| S3 service outage | gateway/indexer/validator down | restart; state is chain-reconstructible by design (projections rebuild from block 0; nodes lose only bounded nonce sets) |
| S3 key suspicion | env key exposure | rotate the key, regrant roles from admin, treasury withdrawal events make any abuse visible immediately |

Admin console panels exist for pause, freeze/unfreeze (reason-coded), and validator/campaign moderation — no CLI needed mid-incident.

## 2. Runbook skeleton (per incident)

1. Declare sev + scribe a timeline (UTC).
2. Apply the narrowest implemented control above (pause domain ≻ freeze triangles ≻ suspend validators ≻ stop a service).
3. Snapshot evidence: relevant chain events, validator metrics (`/metrics` counters incl. nonce replays and rejection counts), vault access logs.
4. Fix → re-verify with the targeted test (the E2E suite doubles as the recovery check for claim-path incidents).
5. Un-pause/unfreeze (also evented) only after the fix is test-proven.
6. Public post-incident note (the events are already public; the note explains them) + release-log entry + new regression test.

## 3. Drills (pilot gate M6.7)

Before TestFlight: one full pause/unpause drill on the internal testnet (already exercised in tests and E2E), one triangle freeze/unfreeze drill, one validator-loss drill (kill 1 of 3 — quorum 101 of 150 must fail closed), one gateway-restart drill mid-claim (idempotent resubmission covers it). Record timings in this file's first revision.

## 4. Contact tree

To be filled with pilot staffing (foundation ops lead, contract owner, validator operator, legal contact). Placeholder-free rule: this section is intentionally a TODO **tracked as a pilot gate** — names cannot exist before the pilot team does.
