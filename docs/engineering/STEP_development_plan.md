# STEP Development Plan

**Version:** 0.1 · **Date:** 2026-06-12 · Companion to the [delivery roadmap](STEP_delivery_roadmap.md) (milestone detail) — this document records the working method, the as-built status, and the forward plan.

## 1. Method (applied throughout, master prompt §10)

MESH first, then one vertical slice, then breadth (DEV §25 ordering followed literally). Every module shipped with tests in the same commit; unfrozen economics expressed only as registry parameters; cross-language behaviour pinned by committed vectors rather than convention; commits at verified checkpoints with honest messages (including the unverified bits, e.g. Compose without Docker); failures reported as found (e.g. the dt==0 teleport gap E2E exposed, fixed with a unit test).

## 2. As-built status (verified on this machine, 2026-06-12)

| Milestone | Status | Verification |
|---|---|---|
| M0 foundations | ✅ | workspaces, schemas in CI, params registry, compose (unbooted — no Docker), CI defs |
| M1 MESH engine | ✅ | 18 Rust tests; 341 golden vectors; spec frozen |
| M2 wallet/claims | ✅ core | iOS StepCore 8/8 tests incl. exact Rust-signature reproduction; app shell compiles; Xcode target pending |
| M3 contracts | ✅ | 31 Foundry tests (unit+fuzz+invariants); live Anvil deploy |
| M4 validators | ✅ | 30 Rust tests across validation-rules+node; clippy clean |
| M2/M4 services | ✅ | 39 TS tests, 0 type errors, 9 packages |
| M5 web apps | ✅ | 3 Next.js builds green |
| M6 E2E | ✅ 5/5 | natural mint+twin, teleport rejection, nonce replay, contract freeze, sponsored supply-conservation — on real components |
| M6 pilot | ◻ external | TestFlight/merchants/field tests need Apple accounts, Docker host, legal gates |

Full inventory of remaining work: [release log](../operations/STEP_release_log.md) "Known gaps".

## 3. Forward plan (ordered)

**Pilot-readiness (engineering):** Xcode app target + App Attest server verification (the one security-critical missing proof input) → Compose boot verification on a Docker host + Postgres backends behind the existing store interfaces → multisig for admin/treasurer roles → Slither/Echidna in CI → OSM tile self-hosting for the pilot area.

**Pilot-readiness (external):** legal gates L4/L6/L7/L8 (PIA, consumer terms, app-store consult, merchant agreement) → pilot city + 3–10 merchants (OPEN-7) → field tests F1–F9 → alpha report vs KPIs.

**Post-alpha (MVP):** libp2p gossip propagation (flagged design exists) → validator-issued nonces replacing the shared-secret tag → WASM + XCFramework mesh bindings (FFI layer already exported) → wallet-clustering/validator-affinity fraud analytics → The Graph or self-hosted graph-node evaluation.

**Gated:** tokenomics ratification (OPEN-1/2/3/8 + MESH-014 audit) → exchange phase 2 (LEG-002) → contract audit before any non-testnet deployment (SC-007).

## 4. Working agreements (unchanged from M0)

No placeholder code or mocked production paths (environment-dependent behaviour is explicit config, ADR-015); parameters from the registry only; English comments; no raw GPS in logs; schema versioning on every wire format; every contract change re-runs ABI extraction; release-log entry per milestone.

## 5. Contract + protocol update playbook (copy/paste for next code changes)

1. Keep `config/protocol-params.alpha.json` as the canonical source for mineable levels, denominator, and slot policy.
2. Apply source changes first in `contracts/` and then patch `contracts/test/*` in the same commit for matching behavior.
3. Regenerate ABIs via `scripts/dev/extract-abis.mjs` after any contract shape change and commit outputs.
4. Update `contracts/src/*` shared type artifacts in `packages/shared-types` after ABI changes.
5. Update mirrored constants in tests and fixtures in the same commit (`contracts/test/StepFixture.sol`, service tests).
6. Update smart-contract-facing docs (`docs/smart-contracts/STEP_contract_specification.md`, `docs/engineering/STEP_api_contracts.md`) whenever events, claims, or params change.
7. Update user-facing docs (`docs/tokenomics/STEP_tokenomics_constitution.md`, `docs/product/STEP_product_specification.md`) for denomination, level, reward, or exhaustion changes.
8. Update backend services that convert/display STEP and Trinity in lockstep with the new ratio.
9. Update frontend map and claim UX copy from the same constants before release.
10. Add a release entry in `docs/operations/STEP_release_log.md` with migration impact and rollback plan.
11. Before merge, verify all prior CONFIRMED mechanisms remain intact and create a short verification note in the release entry.
