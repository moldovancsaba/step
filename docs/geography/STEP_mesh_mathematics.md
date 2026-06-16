# STEP MESH Mathematics — `step-mesh-v1`

**Version:** 1.0 (alpha freeze)
**Date:** 2026-06-11
**Status:** FROZEN for alpha. Any change requires a new mesh spec version registered in `MeshRegistry` and regenerated golden vectors.
**Implementation:** [`packages/mesh-engine`](../../packages/mesh-engine) (canonical Rust, ADR-004)
**Conformance contract:** [`packages/mesh-engine/golden/golden_vectors.tsv`](../../packages/mesh-engine/golden/golden_vectors.tsv)

---

## 1. Earth model

- **Protocol surface:** unit sphere. The MESH is *spherical by design* (SYS §7.2): WGS84 latitude/longitude are accepted as input and mapped to unit vectors; no ellipsoidal correction is applied inside the protocol. The resulting distortion (WGS84 flattening ≈ 1/298.257) shifts physical positions relative to a true ellipsoidal model by up to ~21 km in vertex placement but is **irrelevant to protocol correctness**, because every participant uses the identical spherical mapping — determinism, not geodetic fidelity, is the protocol requirement (HARD §5.2).
- **Metre conversions** (areas, side lengths, edge distances, accuracy thresholds) use the authalic mean radius **R = 6 371 008.8 m**. This constant appears only in display/threshold math, never in containment predicates.
- **Coordinate mapping:** `x = cos(lat)·cos(lon)`, `y = cos(lat)·sin(lon)`, `z = sin(lat)`.

## 2. Icosahedron orientation (OPEN-10 resolution)

The level-1 MESH is a spherical icosahedron with:

| Element | Position |
|---|---|
| Vertex 0 | geographic North Pole (0, 0, 1) |
| Upper ring (5 vertices) | latitude `atan(1/2)` ≈ 26.56505118°, longitudes 0°, 72°, 144°, 216°, 288° |
| Lower ring (5 vertices) | latitude `−atan(1/2)`, longitudes 36°, 108°, 180°, 252°, 324° |
| Vertex 11 | geographic South Pole (0, 0, −1) |

**Rotation constant about the polar axis: 0°** — the first upper-ring vertex lies exactly on the prime meridian. This resolves ADR OPEN-10 and is frozen for v1.

**Face indexing** (F00–F19):

| Faces | Band | Construction (i = 0..4, j = (i+1) mod 5) |
|---|---|---|
| F00–F04 | North polar cap | (North, Upper[i], Upper[j]) |
| F05–F09 | Upper-middle | (Upper[i], Lower[i], Upper[j]) |
| F10–F14 | Lower-middle | (Lower[i], Upper[j], Lower[j]) |
| F15–F19 | South polar cap | (Lower[i], South, Lower[j]) |

Every face's vertex triple is wound counter-clockwise viewed from outside the sphere (`det[A,B,C] > 0`); the constructor deterministically swaps B/C where the generation order would violate this. Tests assert the invariant.

## 3. Subdivision

Each triangle (A, B, C) splits into 4 children by **normalized edge midpoints** (`m_XY = normalize(X + Y)`), per SYS §7.4:

| Child digit | Vertices | Position |
|---|---|---|
| 0 | (A, m_AB, m_CA) | corner at A |
| 1 | (B, m_BC, m_AB) | corner at B |
| 2 | (C, m_CA, m_BC) | corner at C |
| 3 | (m_AB, m_BC, m_CA) | centre |

Edges are **great-circle arcs** (the midpoint normalization guarantees children's edges lie on great circles through their endpoint pairs). Winding is preserved (tested to depth 5 over all faces).

Counts follow SYS §6.3 exactly:
`T(n) = 20 × 4^(n−1)`, cumulative `C(n) = 20 × (4^n − 1)/3`.
At level 21: `T(21) = 20 × 4^20 = 21 990 232 555 520` (~22.0 trillion — confirming the corrected figure in SYS §6.4/HARD §5.5, not the legacy 2.1 trillion).

## 4. Triangle identifiers

String form (SYS §7.3): `STEP-{level}-F{face:02}` for level 1; deeper levels append `-{path}` where `path` is exactly `level − 1` base-4 digits, digit *i* selecting the child at subdivision step *i*.

Examples from the golden vectors: `STEP-1-F00`, `STEP-5-F00-1220`, `STEP-21-F00-12203302320201…`.

**Ordering** ("lowest triangle ID wins", HARD §5.7): within a level, `(face, path)` lexicographic; implemented as the derived ordering on `(level, face, path)`.

Maximum level: **25** (level-25 sides ≈ 0.42 m; f64 unit-vector precision ≈ 10⁻⁹ m on Earth's surface leaves > 8 orders of magnitude of headroom).

An on-chain `bytes32` packing is defined in the contract layer: `keccak256(utf8(triangle_id_string))`. The hash form is used purely as an opaque key; the string is the canonical identity. (A bit-packed reversible encoding remains possible in a future spec version without breaking the string identity.)

## 5. Containment and resolution

A unit point **p** is inside triangle (A,B,C) iff its signed margin is non-negative, where

```text
margin(p) = min( p·n̂_AB, p·n̂_BC, p·n̂_CA ),  n̂_XY = normalize(X × Y)
```

Each term is the sine of the angular distance from p to the oriented edge great-circle plane.

**Resolution** (`latLonToTriangle`): among the 20 faces, then among the 4 children at each level, select the candidate with **maximum margin**; all candidates within `TIE_EPS = 10⁻¹²` of the best margin tie-break to the **lowest index** — which equals the lowest triangle ID, because candidates are enumerated in ascending ID order. This rule is total (a covering candidate set always yields a winner) and implements the HARD §5.7 recommended boundary rule.

**Tolerances (frozen):**

| Constant | Value | Meaning |
|---|---|---|
| `TIE_EPS` | 1e−12 | unit-sphere tie-break band (≈ 6.4 µm on Earth) |
| `CONTAINS_EPS` | 2e−12 | containment acceptance, ≥ worst tie-broken margin so `contains(resolve(p), p)` always holds |

**Poles:** the exact pole touches 5 faces; the tie-break assigns it to the lowest face ID at every level, and this is tested for multiple longitudes (all longitudes at lat ±90° are the same physical point and resolve identically).

**Antimeridian:** longitudes +180° and −180° map to the same unit vector, hence the same triangle, structurally. No lat/lon arithmetic exists in any predicate.

## 6. Derived quantities

- **Area:** l'Huilier's theorem — `E = 4·atan(√(tan(s/2)·tan((s−a)/2)·tan((s−b)/2)·tan((s−c)/2)))`, area = `E·R²` with side arcs a,b,c. The 20 base faces sum to the sphere area within 10⁻⁹ relative error (tested); children tile their parent within 10⁻⁶ (tested).
- **Centroid:** `normalize(A + B + C)`.
- **Side lengths:** icosahedron edge arc = `atan(2)` ≈ 1.1071487 rad → **S(1) ≈ 7 053.6 km**. The halving law `S(n) ≈ S(1)/2^(n−1)` (SYS §6.5) holds within spherical distortion (tested at 0.55–1.45 ratio band): **S(21) ≈ 6.7 m** — the documented human-scale presence level (SYS §6.4 table's "≈7.6 m" used the legacy 8 000 km estimate for S(1); the exact icosahedral value is 7 053.6 km, hence 6.7 m).

| Level | Approx. side | Triangles on level |
|---:|---:|---:|
| 1 | 7 053.6 km | 20 |
| 10 | 13.8 km | 5 242 880 |
| 15 | 430 m | 5 368 709 120 |
| 21 | 6.7 m | 21 990 232 555 520 |
| 25 | 0.42 m | 5.6 × 10¹⁵ |

## 7. Boundary and accuracy policy (MESH-007/008)

`boundaryPolicy(lat, lon, accuracy_m, level, max_fraction)` resolves the triangle deterministically, then classifies:

| Verdict | Condition | Protocol consequence |
|---|---|---|
| `Inside` | nearest-edge distance > accuracy radius | claim proceeds normally |
| `BoundaryAmbiguous` | accuracy circle overlaps an edge | deterministic assignment stands; sponsored campaigns may require stronger proof (HARD §5.7) |
| `RejectAccuracy` | accuracy radius > `max_fraction × min_side`, or invalid | reject or offer a lower (larger) level |

`max_fraction` is the protocol parameter `mesh.max_accuracy_fraction_of_side` (UNFROZEN, alpha default 10.0). Edge distance is measured to the edge great-circle plane (`asin(p·n̂)·R`), a lower bound on segment distance — conservative in the safe direction.

## 8. Neighbour computation

The three edge-adjacent triangles are found by resolving a probe point placed 25% beyond each edge midpoint along the centroid→midpoint direction, at the same level. Because resolution is global vector math, adjacency across base-face boundaries, the antimeridian, and near the poles requires no special cases. Symmetry and distinctness are tested.

## 9. Mineable levels

Geometry exists at all levels 1–25. **Economic issuance is restricted to the configured `mesh.mineable_levels` parameter (UNFROZEN, alpha default `[21]`)** per ADR-003/HARD §5.6: parent levels serve navigation, rarity grouping, and visualisation only.

## 10. Conformance and audit status

- **Golden vectors:** 341 committed rows (23 named locations × 6 levels + 200 area-uniform random points at levels 10/21), replayed by the Rust suite and required for every binding (Swift, WASM/TS).
- **Test coverage:** determinism, resolve→contains consistency, hierarchy (ancestor walk = direct resolve), child partition, pole determinism, antimeridian equality, exact-edge-midpoint stability, neighbour sanity/symmetry, area/side laws, performance bound (1 000 level-21 resolutions < 2 s; measured ~0.05 s debug build).
- **DGGS relationship (MESH-015):** step-mesh-v1 is an icosahedral aperture-4 triangular hierarchy — structurally aligned with OGC DGGS principles (hierarchical, global, addressable zones). Formal OGC-conformance documentation remains open research, not an alpha blocker.
- **Independent mathematical audit (MESH-014):** NOT yet performed. The supply-relevant numbers in §3/§6 are implementation-verified but must be independently audited before any whitepaper/investor use. This remains a tracked blocker.
