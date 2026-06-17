# Working rules for this repository (non-negotiable)

These are hard quality gates for STEP. They are not aspirational — code that
violates any of them is not done. Apply them to every change, in every language
(Rust, Solidity, TypeScript, Swift), before committing.

## The five rules

1. **No obsolete.** No dead code, stale comments, leftover scaffolding, unused
   files, or superseded implementations. If you replace something, delete the
   old thing in the same change. Remove `*.tsbuildinfo`-style artifacts from VCS.
2. **No deprecated.** No deprecated APIs, libraries, language features, or
   patterns — not in code, not in dependencies. Use current, supported APIs. If
   an upstream marks something deprecated, migrate off it, don't suppress it.
3. **No warning.** Zero compiler/linter/build warnings. Treat warnings as
   errors: Rust `cargo clippy --workspace --all-targets -- -D warnings` must be
   clean; TS `tsc` must be clean under the strict config; Solidity must build
   without warnings; web builds must be warning-free. Don't silence with blanket
   `allow`/`ignore` — fix the cause.
4. **No error.** Everything builds and every test passes locally before you
   push. Run the **exact** CI steps (see below), never just a subset.
5. **No unwanted dependencies.** Add a dependency only when it is necessary and
   clearly the right tool. Prefer the standard library / existing workspace
   packages. No transitive bloat, no duplicate libraries doing the same job, no
   dev convenience packages shipped to prod. Justify every new dependency in the
   PR/commit.

## Before every commit/push — run the full gate (not a subset)

CI runs all of these; so must you, locally, first:

```bash
# Rust
cargo fmt --all --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace

# TypeScript (pnpm workspace)
pnpm -r typecheck
pnpm -r --filter '!@step/e2e' test
pnpm -r build

# Solidity
( cd contracts && forge test )
```

Green tests alone are NOT enough — fmt, clippy/lint, typecheck, and **build**
have caught failures that tests did not.

## Notes specific to this repo

- Protocol/economic constants are UNFROZEN params in
  `config/protocol-params.alpha.json` — never hardcode them.
- The mesh model is **Mesh ID v2** — see `docs/geography/STEP_mesh_id_v2.md`
  (dotted 1-indexed ids, level = segments, level 21 terminal, parent-exhaustion
  mining). Don't reintroduce the old `STEP-{level}-F{face}` form.
- Stage files individually; keep the working tree clean (no stray uncommitted
  cruft, no committed build artifacts).
