# STEP Mesh ID v2 — dotted coordinate scheme

Status: canonical spec (supersedes the `STEP-{level}-F{face:02}-{base4path}` form).
This is the single source of truth for triangle identity, mining order, and
subdivision across the engine, contracts, services, and clients.

## 1. The mesh

The world starts as a spherical icosahedron: **20 base triangles ("faces"),
numbered 1–20**. Nothing is mined initially. A triangle subdivides only when it
is fully mined (see §4): connect the midpoints of its three edges → **4
self-similar quarter triangles** (standard midpoint subdivision). This repeats
down to **level 21**, the terminal (finest, ~6.7 m) level.

## 2. Triangle ID (geographic coordinate)

A triangle is identified by a **dotted path**, 1-indexed:

```
<face>[.<child>]*
face  ∈ 1..=20        the base icosahedron triangle
child ∈ 1..=4         which quarter at each subdivision
```

- **Level = number of segments.** `7` is level 1; `7.3` is level 2; `7.3.2` is
  level 3; a 21-segment id is the terminal level.
- **Shorter id ⇒ larger triangle. Longer id ⇒ smaller triangle.**
- The parent of `7.3.2` is `7.3`; its children are `7.3.1 7.3.2 7.3.3 7.3.4`.

### Child numbering (frozen)

Midpoint subdivision yields four triangles; they are numbered deterministically:

| child | triangle |
|-------|----------|
| 1 | corner at vertex A |
| 2 | corner at vertex B |
| 3 | corner at vertex C |
| 4 | centre (inverted) |

(Internally the engine stores faces 0–19 and children 0–3; the **1-indexed dotted
form is the only public/serialized representation**. Conversion is `+1` on
serialize, `−1` on parse.)

## 3. Slot / NFT ID (mining position)

Each triangle has **27 mining slots** (`collector_slots_per_triangle`). A mined
slot is one **NFT**. Its public ID is the triangle ID **plus the slot**, 1-indexed:

```
<triangleId>.<slot>          slot ∈ 1..=27
```

Examples: `1.1` = face 1, slot 1 (the very first mine on a virgin mesh).
`7.3.2` = triangle `7.3`, slot 2. `3.2.3.4.3.2.1` = triangle `3.2.3.4.3.2`
(level 6), slot 1.

> Note on parsing: an NFT ID is `<triangleId>.<slot>`; the **last** segment is
> the slot, the rest is the triangle. Because both a triangle ID and an NFT ID
> are dotted integers, callers must know which they expect (typed context). On
> chain an NFT is keyed by `(triangleIdHash, slot)`, so there is no ambiguity
> there; the dotted string is the human-facing coordinate.

## 4. Mining order & breakdown (the lifecycle)

For a given location, mining always targets the **finest un-exhausted triangle
covering that point** ("the current triangle"):

1. The current triangle's slots are handed out **in order 1 → 27**. The first
   miner gets slot 1, the next slot 2, … (one slot per miner — see §5).
2. When **slot 27** is taken, the triangle is **Exhausted** and **breaks down**
   into its 4 children (level + 1). Each child starts fresh at slot 1.
3. A miner now standing in child `k` mines `…​.k.1`, then `…​.k.2`, …
4. This continues until a **level-21** triangle is exhausted → it is a permanent
   **desert** (no further subdivision; only a merchant funding STEPs reopens
   activity there).

"Oasis" = a location whose current triangle still has free slots. "Desert" = a
location broken down and exhausted to level 21.

## 5. One mine per wallet per triangle

A wallet may mine **at most one slot of a given triangle**. It can mine that
location again only once the triangle exhausts and breaks down — then it mines
the (smaller) child triangle it stands in. This is the anti-sybil / fairness
rule and is enforced on chain (`minedByWallet[triangle][wallet]`).

## 6. Determinism & cross-language parity

- The engine is the one implementation of geometry; the dotted ID grammar above
  is implemented byte-identically in Rust, TypeScript, and Swift (golden
  vectors enforce parity, as before).
- Resolution `lat/lon + level → triangleId` is unchanged geometrically; the
  "current level" for mining is supplied by on-chain exhaustion state, not by
  the engine (the engine remains stateless).

## 7. Migration from v1

v1 (`STEP-21-F00-12203302320201032103`) is replaced everywhere. Key deltas:
faces 0-indexed→**1-indexed**, children base-4 `0–3`→**`1–4`**, the **slot is
part of the NFT id**, the **level is emergent** (driven by breakdown, not a
fixed 21), and the separator is `.` with no `STEP-`/`F` decoration. `MAX_LEVEL`
becomes **21**.
