# @step/web-app — STEP mobile web app (GDS)

The primary STEP client, built **exclusively on `@sovereignsquad/gds`** (Mantine 8 +
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
| `VITE_MESH_URL` | `http://127.0.0.1:8081` | validator/gateway mesh `/v1/mesh/*` (#15) |
| `VITE_INDEXER_URL` | `http://127.0.0.1:8090` | indexer `/v1/mesh-states` (#16) |
| `VITE_NFT_URL` | `http://127.0.0.1:8092` | nft-indexer (#7/#10) |

## Zero-knowledge wallet

The password never leaves the browser. Argon2id derives `authKey` (sent) +
`wrapKey` (local); the wallet key is AES-256-GCM-encrypted client-side and held
**in memory only** for the session (`src/session.tsx`), cleared on sign-out.
See `docs/services/STEP_account_vault.md`.

## Production routing

Production builds use same-origin `/api/*` URLs from `.env.production`. The root
Cloudflare Worker (`/worker.js`) proxies those paths to the public account,
gateway, indexer, and NFT services, so browser login, cookies, and mesh calls do
not depend on cross-site CORS.

## Map behavior

The Map tab is the canonical STEP mesh globe. It uses MapLibre GL JS v5 globe
projection plus the custom WebGL layer `step-globe-mesh-custom`, which renders
the level-1 icosahedron mesh through MapLibre's `projectTile(a_pos)` shader path.
Earth, all visible spherical mesh edges, the GPS-locked mining triangle, and any
inspected triangle live on the same globe object.

`/?surface=ios-map` exposes the same globe as a public, map-only surface for the
iOS app's embedded Map tab. Normal browser users still enter through the full
GDS app shell.

## Run

```bash
pnpm --filter @step/web-app dev   # http://localhost:3020
```

## Deploy

This app is the **primary STEP site** and deploys to the Cloudflare `step`
worker at the short URL **https://step.moldovancsaba.workers.dev** via the repo
root `wrangler.toml` (static assets + SPA fallback; the root `[build]` command
builds this app). From the repo root:

```bash
pnpm dlx wrangler deploy            # builds apps/web-app + deploys the `step` worker
```

API base URLs are baked at build from `VITE_*` (see the table above). For
production keep them as same-origin `/api/*`; configure the actual public
backends in the root `wrangler.toml` `[vars]`.
