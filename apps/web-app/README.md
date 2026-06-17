# @step/web-app — STEP mobile web app (GDS)

The primary STEP client, built **exclusively on `@doneisbetter/gds`** (Mantine 8 +
React 18). Delivers the GDS app shell (#3), the zero-knowledge login wall (#13),
and the oasis/desert mesh map (#17). Mine (#21) and Marketplace (#11) surfaces
have shell entries wired to placeholders pending their own issues.

## GDS adoption (#2)

`GdsProvider` is the single root provider (`src/main.tsx`). UI uses GDS surfaces
(`AppShell`, `AuthShell`, `FormField`, `MapPanel`, `MetricCard`, `EmptyState`)
themed over Mantine primitives. Install + production build are verified:

```bash
pnpm --filter @step/web-app build   # tsc --noEmit && vite build — passes
```

## What it talks to

| Env var | Default | Service |
|---------|---------|---------|
| `VITE_ACCOUNT_URL` | `http://127.0.0.1:8091` | account-api (#12) |
| `VITE_MESH_URL` | `http://127.0.0.1:8081` | validator mesh `/v1/mesh/cover` (#15) |
| `VITE_INDEXER_URL` | `http://127.0.0.1:8090` | indexer `/v1/mesh-states` (#16) |
| `VITE_NFT_URL` | `http://127.0.0.1:8092` | nft-indexer (#7/#10) |

## Zero-knowledge wallet

The password never leaves the browser. Argon2id derives `authKey` (sent) +
`wrapKey` (local); the wallet key is AES-256-GCM-encrypted client-side and held
**in memory only** for the session (`src/session.tsx`), cleared on sign-out.
See `docs/services/STEP_account_vault.md`.

## Known limitations

- Cross-device sign-in needs the (non-secret) KDF salt; the pilot caches it
  locally at register. A `GET /v1/kdf/:identity` salt endpoint is hardening #14.
- Map is an SVG overlay over a fixed viewport with lat/lon/level controls; a
  full slippy basemap (MapLibre) integration is a later enhancement.

## Run

```bash
pnpm --filter @step/web-app dev   # http://localhost:3020
```
