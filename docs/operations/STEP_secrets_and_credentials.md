# STEP — Secrets & Credentials Registry (canonical)

**This is the single source of truth for every secret, where its real value
lives, and how each tool consumes it.** It contains **no secret values** — only
names, locations, scopes, and usage. Keep it current whenever a credential is
added, rotated, or moved.

## Golden rules

1. **Never commit a secret.** `.gitignore` enforces `.env`, `.env.*` (with the
   sole exception `!.env.example`). Verify with `git check-ignore .env`.
2. **The canonical local secrets file is `/.env`** (gitignored). Everything an
   operator needs to run/deploy is there. `/.env.example` is the committed,
   value-free template documenting every variable.
3. **`.env.cloudflare`** (gitignored) is a focused subset for `wrangler`
   (Cloudflare vars + R2 only). It duplicates the Cloudflare entries in `.env`;
   prefer `.env` and keep the two in sync, or source whichever the tool needs.
4. **The Apple `.p8` key is a true secret and lives OUTSIDE the repo** in the
   system locations Apple tooling reads (see below). Never copy it into the repo.
5. To **use** a secret in a shell:
   `set -a; . /Users/Shared/Projects/step/.env; set +a` then run the tool.

## Inventory

### Cloudflare (deploys the web app + regiominer.com docs site)
| Variable | Secret? | Where the value lives | Scope / notes |
|---|---|---|---|
| `CLOUDFLARE_API_TOKEN` | **yes** | `/.env`, `/.env.cloudflare` | Has Workers Scripts:Edit (deploys workers + workers.dev). **Lacks** `regiominer.com` zone Workers-Routes:Edit / DNS:Edit — see "Known gaps". |
| `CLOUDFLARE_ACCOUNT_ID` | no | `/.env`, `/.env.cloudflare` | `66ce3adbb96f6715f8cc2b04991c30e4` |
| `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` / `R2_ENDPOINT` | **yes/yes/no** | `/.env`, `/.env.cloudflare` | R2 (S3-compatible) object storage |

Usage: `cd apps/regiominer-site && set -a; . ../../.env.cloudflare; set +a && npx wrangler deploy`

### account-api (zero-knowledge wallet vault, #12)
| Variable | Secret? | Where | Notes |
|---|---|---|---|
| `SESSION_SIGNING_KEY` | **yes** | `/.env` | REQUIRED in prod; random in dev |
| `DATABASE_URL` | **yes** | `/.env` | unset → in-memory dev store |
| `ACCOUNT_PORT`, `SESSION_TTL_SECONDS`, `SECURE_COOKIES` | no | `/.env` | config |

### iOS app endpoint config (build settings, not secrets)
`STEP_GATEWAY_URL`, `STEP_MESH_URL`, `STEP_INDEXER_URL`, `STEP_ACCOUNT_URL`,
`STEP_NFT_INDEXER_URL`, and (marketplace) `STEP_RPC_URL`,
`STEP_MARKETPLACE_ADDRESS`, `STEP_NFT_ADDRESS`, `STEP_TRINITY_ADDRESS`.
Consumed by `apps/ios/App/Info.plist → AppConfig`. Set via an `.xcconfig` per
build configuration. Currently placeholders (`*.step.example`) until the backend
is deployed.

### Apple Developer / App Store Connect (signing + TestFlight/App Store upload)
| Item | Secret? | Where the value lives | Used by |
|---|---|---|---|
| App Store Connect API **`.p8` private key** | **yes** | `~/.appstoreconnect/private_keys/AuthKey_<KEYID>.p8` (mirror: `~/.private_keys/`) — **never in repo** | `xcodebuild -allowProvisioningUpdates`, `xcrun altool`, the ASC API JWT |
| `APPLE_ASC_KEY_ID` | no (identifier) | `/.env` | filename of the .p8; `--apiKey` |
| `APPLE_ASC_ISSUER_ID` | no (identifier) | `/.env` | `--apiIssuer`; ASC API `iss` |
| `APPLE_TEAM_ID` | no (identifier) | `/.env` | `DEVELOPMENT_TEAM` for signing |
| `APPLE_ASC_APP_ID` | no (identifier) | `/.env` | App Store Connect app record id |
| `APPLE_BUNDLE_ID` | no | `/.env`, `project.yml` | `com.regiominer.miner` |

Usage (sign + upload to TestFlight):
```sh
set -a; . /Users/Shared/Projects/step/.env; set +a
cd apps/ios/App
xcodebuild -exportArchive … -allowProvisioningUpdates \
  -authenticationKeyPath ~/.appstoreconnect/private_keys/AuthKey_$APPLE_ASC_KEY_ID.p8 \
  -authenticationKeyID $APPLE_ASC_KEY_ID -authenticationKeyIssuerID $APPLE_ASC_ISSUER_ID
xcrun altool --upload-app --type ios -f build/export/StepApp.ipa \
  --apiKey $APPLE_ASC_KEY_ID --apiIssuer $APPLE_ASC_ISSUER_ID
```
Mint an ASC API JWT (for direct API calls): `/tmp/ascjwt.rb` pattern —
ES256 over `{iss,iat,exp,aud:"appstoreconnect-v1"}`, `kid=APPLE_ASC_KEY_ID`.

## Known gaps / to fix

- **`regiominer.com` custom domain not bound.** The Cloudflare token lacks that
  zone's Workers-Routes:Edit / DNS:Edit, so the docs site currently serves from
  `https://regiominer.moldovancsaba.workers.dev`. To bind `regiominer.com`:
  either issue a token that includes `Zone:regiominer.com → Workers Routes:Edit`
  (then `wrangler deploy` with the route in `apps/regiominer-site/wrangler.toml`),
  or attach the `regiominer` worker to the domain in the Cloudflare dashboard
  (Workers & Pages → regiominer → Settings → Domains & Routes).

## Rotation

If any secret leaks: rotate at the provider (Cloudflare dashboard → API Tokens;
App Store Connect → Users and Access → Integrations → revoke the key), update
`/.env` (+ `/.env.cloudflare` for Cloudflare), and re-run the relevant deploy.
On-chain wallet keys are non-custodial and cannot be rotated server-side.
