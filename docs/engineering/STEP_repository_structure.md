# STEP Repository Structure

**Version:** 0.1 · **Date:** 2026-06-12 · Layout per ADR-001 (master prompt §4.1 merged with DEV §4); deviations documented there.

```text
step/
├── apps/
│   ├── ios/StepCore/          Swift package: protocol core (tested) + SwiftUI app layer; README lists Xcode steps
│   ├── web/                   Public explorer (Next.js + MapLibre)
│   ├── merchant-dashboard/    Managed-account merchant UX (server actions → chain)
│   └── protocol-admin/        Foundation console (moderation, freeze, pause, params)
├── packages/
│   ├── mesh-engine/           CANONICAL Rust geometry + golden/golden_vectors.tsv + C FFI
│   ├── validation-rules/      Deterministic claim pipeline + fraud + crypto (Rust) + examples/gen_vector
│   ├── shared-types/          TS protocol types + canonical crypto + abis.ts (generated)
│   ├── proof-protocol/        TS claim building/signing (e2e + web miner)
│   ├── api-client/            Typed REST clients
│   └── schemas/               JSON Schemas + cross-language-vector.v1.json (conformance contract)
├── contracts/                 Foundry: src/ test/ script/ deployments/{chainId}.json
├── services/
│   ├── validator-node/        Rust: validation + votes + mesh API + metrics
│   ├── gateway-api/           Nonces, fan-out, quorum, relayer (Hono + viem)
│   ├── indexer/               Event projection + explorer REST
│   ├── proof-storage/         Encrypted evidence vault (CIDs, key-destruction deletion)
│   ├── merchant-api/          Onboarding gates, POIs, rotating QR
│   ├── exchange-service/      Closed campaign credits ONLY (ADR-011)
│   └── campaign-worker/       Chain-driven expiry/refund
├── tests/
│   ├── e2e/                   Full-system suite (spawns anvil + validators + gateway)
│   ├── field-tests/           F1–F9 procedures (filled during pilot)
│   └── simulations/           (reserved: load/economic sims)
├── docs/                      This documentation set (see docs/README.md)
├── config/protocol-params.alpha.json   THE parameter registry — no constant lives in code
├── infra/docker/              Compose stack (postgres+postgis, kubo, anvil, redis, observability)
├── scripts/dev/extract-abis.mjs        forge out → shared-types ABIs
├── Cargo.toml / pnpm-workspace.yaml / tsconfig.base.json   workspaces
└── .github/workflows/ci.yml   rust · contracts · web · schemas · gitleaks
```

## Boundary rules (DEV §4.1, enforced shape)

Cross-language facts live in exactly one place: geometry in `mesh-engine` (+ committed vectors), wire shapes in `schemas`, ABIs generated never hand-written, parameters in `config/`. TS packages import `@step/shared-types[/abis]` only — no service reaches into another's sources. Rust crates depend upward only (`validator-node → validation-rules → mesh-engine`). Anything that would duplicate a constant across languages must instead become a registry entry or a committed vector.

## Verification map

`cargo test --workspace` (48) · `cd contracts && forge test` (31) · `pnpm -r test` (39) · `pnpm -r typecheck` (0 errors) · `cd apps/ios/StepCore && swift test` (8) · `pnpm --filter @step/e2e test` (5, spawns the full stack) · per-app `pnpm build` for the three Next.js apps.
