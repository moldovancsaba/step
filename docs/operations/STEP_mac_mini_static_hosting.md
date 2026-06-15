# STEP Mac Mini Online Sandbox

**Purpose:** run the STEP backend on a local Mac mini and expose only the safe
browser-facing surfaces through a tunnel. This is for a valueless internal
testnet sandbox, not a production pilot.

## 1. Recommended Online Shape

Use one public hostname for the sandbox:

- `https://step.example.com` -> Cloudflare Tunnel -> local `127.0.0.1:8070`
- `127.0.0.1:8070` is `@step/online-gateway`
- `@step/online-gateway` serves the static frontend and proxies:
  - `/api/gateway/*` -> local gateway API `127.0.0.1:8080`
  - `/api/indexer/*` -> local indexer `127.0.0.1:8090`

This keeps raw validator ports, Anvil RPC, proof storage, admin surfaces, and
databases private.

## 2. One-command Mac runner

For the Mac mini sandbox, the simplest operator command is:

```sh
STEP_PUBLIC_BASE_URL=https://step.example.com \
STEP_ONLINE_CORS_ORIGINS=https://YOUR_GITHUB_USER.github.io \
  node scripts/ops/run-mac-online.mjs
```

The wrapper builds `apps/static-frontend`, starts the native STEP backend if it
is not already running, then runs the public online gateway on port `8070`.

Local health checks:

```sh
curl http://127.0.0.1:8070/healthz
curl http://127.0.0.1:8070/config.js
curl http://127.0.0.1:8070/api/gateway/healthz
curl http://127.0.0.1:8070/api/indexer/healthz
```

## 3. Local backend only

Prerequisites: Rust, Foundry, Node 22, pnpm.

```sh
pnpm install

# Include every static frontend origin that will call the APIs.
# Local preview only:
STEP_CORS_ORIGINS=http://127.0.0.1:3010,http://localhost:3010 \
  node scripts/dev/up.mjs

node scripts/dev/smoke.mjs
```

For a public static frontend, add its HTTPS origin:

```sh
STEP_CORS_ORIGINS=https://YOUR_GITHUB_USER.github.io,https://miner.example.com \
  node scripts/dev/up.mjs
```

The native stack intentionally runs validators with
`VALIDATOR_ALLOW_DEV_CLAIMS=true` so the browser miner can submit sandbox
claims. Do not use this mode for an attested TestFlight pilot.

## 4. Static frontend

The static frontend lives at `apps/static-frontend`. It signs claims in the
browser, calls the gateway for nonces/claim submission, uses the gateway mesh
proxy for triangle resolution, and reads explorer stats from the indexer.

Local preview:

```sh
pnpm --filter @step/static-frontend dev
# open http://127.0.0.1:3010
```

Static build:

```sh
pnpm --filter @step/static-frontend build
```

Runtime backend URLs are read from `config.js`, copied into the built artifact.
You can also edit them in the Settings tab; the browser stores overrides in
localStorage.

When served by `@step/online-gateway`, `config.js` is generated dynamically:

```js
window.STEP_CONFIG = {
  gatewayUrl: "/api/gateway",
  indexerUrl: "/api/indexer"
};
```

For GitHub Pages, configure the workflow with:

- `gateway_url`: `https://step.example.com/api/gateway`
- `indexer_url`: `https://step.example.com/api/indexer`

## 5. Cloudflare Tunnel

Use Cloudflare Tunnel when you want public HTTPS URLs without opening router
ports or exposing the Mac's home IP.

1. Create a tunnel in Cloudflare Zero Trust.
2. Copy [cloudflare-tunnel.example.yml](../../infra/tunnel/cloudflare-tunnel.example.yml)
   to your cloudflared config path and replace the tunnel ID, credentials path,
   and hostnames.
3. Publish:
   - `step.example.com` -> `http://127.0.0.1:8070`

Keep these private or protected by Cloudflare Access:

- Anvil RPC `8545`
- proof-storage `8095`
- raw validator ports
- Postgres, Redis, IPFS
- admin, merchant dashboard, Grafana

## 6. Launchd Autostart

Templates are in [infra/macos/launchd](../../infra/macos/launchd).

```sh
mkdir -p ~/.cloudflared ~/Library/LaunchAgents .runtime/logs

# After editing the placeholders:
cp infra/macos/launchd/com.step.online.plist.example \
  ~/Library/LaunchAgents/com.step.online.plist
cp infra/macos/launchd/com.step.cloudflared.plist.example \
  ~/Library/LaunchAgents/com.step.cloudflared.plist

launchctl load ~/Library/LaunchAgents/com.step.online.plist
launchctl load ~/Library/LaunchAgents/com.step.cloudflared.plist
```

Use `launchctl unload ...` to stop them. Logs are written under
`.runtime/logs`.

## 7. GitHub Pages

The workflow [static-frontend-pages.yml](../../.github/workflows/static-frontend-pages.yml)
builds and deploys `apps/static-frontend/dist` to GitHub Pages.

Manual deploy:

1. In GitHub repository settings, enable Pages with "GitHub Actions" as source.
2. Run the `static-frontend-pages` workflow manually.
3. Provide:
   - `gateway_url`: `https://step.example.com/api/gateway`
   - `indexer_url`: `https://step.example.com/api/indexer`
4. Start `@step/online-gateway` with `STEP_ONLINE_CORS_ORIGINS` containing the
   GitHub Pages origin.

If using repository Pages under `/repo-name/`, the frontend still works because
the Vite build uses relative asset paths.

## 8. Cloudflare Pages

For Cloudflare Pages connected to GitHub, do not run the monorepo root build
and do not use `npx wrangler deploy` from the repository root. That deploy
command targets Workers/app auto-detection and fails in this workspace.

Use these Pages settings:

- Framework preset: `None`
- Root directory: `/`
- Build command: `pnpm build:cloudflare-pages`
- Build output directory: `apps/static-frontend/dist`
- Deploy command: leave empty

Set these Cloudflare Pages environment variables:

- `STEP_BACKEND_GATEWAY_URL`: `https://YOUR_MAC_GATEWAY_HOST/api/gateway`
- `STEP_BACKEND_INDEXER_URL`: `https://YOUR_MAC_GATEWAY_HOST/api/indexer`

The frontend loads same-origin `/api/gateway` and `/api/indexer`; Cloudflare
Pages Functions proxy those routes to the Mac-hosted online gateway. If you
instead expose gateway and indexer directly, set the variables to those direct
origins, for example `https://gateway.example.com` and
`https://indexer.example.com`.

If the Cloudflare UI requires a deploy command for a direct-upload style
project, use this instead:

```sh
pnpm deploy:cloudflare-pages
```

The static app includes `apps/static-frontend/wrangler.pages.toml` with
`pages_build_output_dir = "./dist"` for Wrangler-based Pages deploys.

## 9. Cloudflare Workers (`workers.dev`)

For `https://step.moldovancsaba.workers.dev`, deploy the Worker named `step`.
The repository root now has `wrangler.toml`, so Cloudflare's root-level
`npx wrangler deploy` command has an explicit target.

Recommended Workers settings:

- Build command: `pnpm build:cloudflare-pages`
- Deploy command: `npx wrangler deploy`
- Output directory: not used by Workers deploy

Set these Worker variables:

- `STEP_BACKEND_GATEWAY_URL`: `https://YOUR_MAC_GATEWAY_HOST/api/gateway`
- `STEP_BACKEND_INDEXER_URL`: `https://YOUR_MAC_GATEWAY_HOST/api/indexer`

The Worker serves `apps/static-frontend/dist` as static assets and proxies:

- `/api/gateway/*` -> `STEP_BACKEND_GATEWAY_URL`
- `/api/indexer/*` -> `STEP_BACKEND_INDEXER_URL`

Do not include a `_redirects` file in this Worker deployment. The Worker
static-assets config already sets
`not_found_handling = "single-page-application"`, and Wrangler rejects the
Pages-style `/* /index.html 200` rule as an infinite redirect loop for Workers.

## 10. Reliability checklist

- Mac on power and Ethernet.
- Disable sleep while plugged in.
- Use a dedicated macOS user for the sandbox process.
- Store `.runtime/.env.runtime` privately; it contains generated secrets.
- Restart with `node scripts/dev/down.mjs` then `node scripts/dev/up.mjs`.
- Treat all chain state as disposable unless you add backups for `.runtime`,
  contract deployments, and service state.

## 11. When to move off the Mac

Move to a VPS/internal pilot host when you need any of:

- always-on public availability;
- App Attest pilot claims (`VALIDATOR_ALLOW_DEV_CLAIMS=false`);
- persistent Postgres/IPFS backends;
- multisig admin custody;
- audit/legal/field-test gates.
