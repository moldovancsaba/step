# STEP Spherical Triangle Engine

**Version:** 0.1 · **Date:** 2026-06-12 · **Crate:** [`packages/mesh-engine`](../../packages/mesh-engine) (Rust, dependency-free) · **Spec:** [MESH mathematics](STEP_mesh_mathematics.md)

## 1. Engine design

The canonical engine is a single dependency-free Rust crate (auditable, offline-buildable, portable to staticlib/WASM). All predicates run on 3D unit vectors — no lat/lon arithmetic — which makes antimeridian and pole handling structurally safe rather than special-cased. Resolution descends face→children picking the maximum containment margin with a lowest-ID tie-break inside a 1e-12 band; `contains(resolve(p), p)` holds by tolerance construction.

## 2. API (DEV §7.1 complete)

`lat_lon_to_triangle`, `triangle_to_vertices`, `contains_point`, `parent_triangle`, `child_triangles`, `neighbour_triangles` (probe-point method, works across face seams), `triangle_area_m2` (l'Huilier), `triangle_centroid`, `triangle_min_side_m`, `boundary_policy(lat, lon, accuracy, level, max_fraction)` → Inside / BoundaryAmbiguous / RejectAccuracy with edge-distance and side metrics.

## 3. Consumers (ADR-004: one implementation)

| Consumer | Binding | Status |
|---|---|---|
| Validator nodes | native crate | shipped (in-process containment) |
| TS services / web | HTTP mesh API on validator nodes (`/v1/mesh/resolve`, `/v1/mesh/triangle/{id}`) | shipped |
| iOS | mesh API via `GatewayClient.resolveTriangle` | shipped; C-FFI staticlib (`src/ffi.rs`, already exported) → XCFramework is the MVP on-device step |
| Web (offline) | WASM build of the same FFI | MVP step |

Conformance contract: `golden/golden_vectors.tsv` (341 rows — 23 named locations × 6 levels + 200 area-uniform random points at levels 10/21). Any binding must replay it bit-exactly.

## 4. Verification status

18 Rust tests: golden replay; determinism + resolve→contains; ancestor-walk == direct-resolve hierarchy; children partition parents; pole determinism (all longitudes at ±90° → one lowest-ID triangle, multiple levels); ±180° equality; exact-edge-midpoint stability; neighbour distinctness/symmetry; 20-face area sum = sphere within 1e-9; child areas tile parent within 1e-6; side-halving law within spherical distortion; level-21 ≈ 6.7 m confirmed; 1000 level-21 resolutions ≈ 0.05 s debug (<2 s CI bound); input validation. fmt + clippy(-D warnings) clean.

## 5. Performance and precision envelope

f64 unit vectors give ~1e-9 m positional precision; MAX_LEVEL 25 (~0.42 m sides) keeps >8 orders of headroom. Resolution is O(20 + 4·(level−1)) margin tests — microseconds natively; fine for per-claim validator use and the HTTP mesh API at pilot scale.
