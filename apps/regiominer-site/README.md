# regiominer.com site

Static public site for **RegioMiner** — landing page plus the **Privacy Policy**
and **Terms of Service** that the App Store requires at public URLs:

- https://regiominer.com/ — landing
- https://regiominer.com/privacy — Privacy Policy (App Store Connect "Privacy Policy URL")
- https://regiominer.com/terms — Terms of Service
- https://regiominer.com/support — Support contact (App Store Connect "Support URL")

## How it works

`build.mjs` renders the **canonical** legal markdown
(`docs/legal/STEP_privacy_policy.md`, `STEP_terms_of_service.md`) into styled
HTML — no duplication, no drift, and **zero dependencies** (a focused renderer
for the markdown subset those docs use). Edit the markdown, rebuild, redeploy.

```sh
cd apps/regiominer-site
node build.mjs            # → dist/{index,privacy,terms,support}.html
```

`dist/` is generated and gitignored.

## Deploy (Cloudflare Workers)

The domain is on Cloudflare. Deploy with a scoped API token (Workers Scripts +
Workers Routes + the regiominer.com zone):

```sh
cd apps/regiominer-site
CLOUDFLARE_API_TOKEN=*** npx wrangler deploy
```

`wrangler.toml` declares the apex + www custom-domain routes; wrangler
provisions the hostname on deploy. After the first deploy, verify:

```sh
curl -I https://regiominer.com/privacy   # expect 200, text/html
```

Alternatively connect this directory as a git-backed **Cloudflare Workers Build**
(build command `node build.mjs`, root `apps/regiominer-site`) so pushes
auto-deploy, mirroring the `step` worker.
