# STEP — v1 First Working Version (go-live cut line & DoD)

**Status:** active · **Created:** 2026-07-01 · **Owner:** foundation (moldovancsaba)

This is the binding, Definition-of-Done-gated plan to ship STEP's **first working
version**: *a stranger on the public internet installs the iOS app, mines a real
triangle, sees it finalise on the replicated ledger, and one merchant funds one
real oasis — with no LAN assumption and no dishonest attestation.*

It exists because the engineering is ~90% done and already well sequenced on the
board (M1–M13). The remaining work is not "build more system"; it is **close the
public-edge gate (M11), submit the iOS app (M7 #33), and supply the business/
secret inputs only the foundation holds.** The elaborate P2P auto-update swarm
(M13, #102–#113) is explicitly **deferred** — the node agent already self-updates
from `ReleaseRegistry`, which is sufficient for the two-node bootstrap.

## What already works (do not rebuild)

- Replicated **CometBFT+EVM sovereign chain** (`evmd`), chain-id 262144; 20
  Solidity contracts deployed; `forge test` green. Multi-validator BFT proven
  locally (2 bonded validators co-producing blocks).
- **Two independent Trust Centers** (Tribecca + Chappie) reach consensus over P2P
  and survive each other going offline (`pnpm release:disaster-survival:verify`).
- **Genesis-ceremony + governed-handover tooling delivered** (#58/#59 closed):
  `contracts/script/HandoverToGovernance.s.sol` + secret-key genesis scripts.
  ⚠️ The **live chain still runs public dev keys** — executing the ceremony on the
  live chain is owner-gated and is ON the cut line below, not yet done.
- **Backend edge tunnel `step-backend` is live + boot-persistent** (LaunchAgent
  `app.step.backend-tunnel`, id `329b02b6-46bb-4273-8751-a4909f9b900f`). The four
  `*.step.regiominer.com` CNAMEs are the one missing owner DNS step.
- **Web app** (`@step/web-app`, Vite SPA) live at `step.moldovancsaba.workers.dev`,
  served by the root `worker.js` edge with a fail-closed HTTPS/localhost guard.
- **iOS app** (`com.regiominer.miner`, App ID 6781713930) — TestFlight build
  0.1.0 already live; App Store Connect API key **on disk** (`AuthKey_24882Q9AM6`,
  Team `GZE5C5C4L8`) so iOS is **not** blocked on the key.

## The cut line

### IN — v1 "First Working Version" (milestone: `v1 — First Working Version`)

| Item | Issue | Owner | Definition of Done |
|---|---|---|---|
| Fail-closed production-safety scanner | #100 | **✅ delivered** (this branch) | `node scripts/release/scan-production-safety.mjs` exits 0 on a clean tree, non-zero on any localhost/private/plaintext URL in deploy config or key on a secret field; unit-tested; wired into CI `secrets` job + `web` job. |
| Commit the deployed `worker.js` to VCS | — (new) | foundation | Root `worker.js` (the deployed edge proxy, per `wrangler.toml main`) is **currently untracked**. It is hand-written source with no secrets → it must be committed, not left on one machine. DoD: `git ls-files worker.js` returns it; `scan-production-safety.mjs` then covers it. |
| Public-edge E2E, no localhost | #89, #80, #87 | foundation | Browser → root Worker → gateway → validators/peers → chain, exercised against the **public** `*.step.regiominer.com` endpoints with zero localhost fallback. DoD: `pnpm release:public-edge:verify` updated to assert the **root** `worker.js` + `wrangler.toml` surface (it currently checks the retired `apps/static-frontend/` surface — see Debt below) and passes; a real device on cellular completes a claim. |
| Internet-reachable backend (DNS) | #50 | foundation | The `step-backend` tunnel is already live + boot-persistent; the missing step is **4 PROXIED CNAMEs** in the regiominer.com zone (`gw`/`idx`/`acc`/`nft`.step.regiominer.com → `329b02b6-46bb-4273-8751-a4909f9b900f.cfargotunnel.com`) — the CF API token can't edit DNS. DoD: a claim finalises from a network with no route to the LAN. Runbook R1. |
| Live-chain genesis ceremony + handover | #58, #59 | foundation | Tooling is delivered/closed, but the live chain still runs public dev keys. **Execute on the live chain**: real secret validator keys, then `contracts/script/HandoverToGovernance.s.sol` (asserts no-EOA admin). DoD: live chain runs non-dev keys; STEP admin is Timelock+Governor. Runbook R4. |
| iOS App Store submission | #33 | foundation | Key is **on disk** (`AuthKey_24882Q9AM6`, Team `GZE5C5C4L8`) and build 0.1.0 is live on TestFlight — iOS is not blocked on the key. Remaining: backend reachable (the CNAMEs above), confirm the build points at `*.step.regiominer.com` (not `*.step.example`), upload 0.1.0(2) via `altool`, pass external Beta App Review. Legal metadata below. Runbook R2. |
| Legal metadata fill | part of #33 | foundation + counsel | Replace `[PLACEHOLDER]`s (legal entity, jurisdiction, contact, category) noted in `apps/ios/App/README.md:100`. Known: publisher **Moldovan Csaba Kft**, domain **regiominer.com**. Needs counsel: jurisdiction, App Store category, support/privacy/legal mailboxes. DoD: no `[PLACEHOLDER]` tokens remain in shipped legal text. |
| Pilot city + first merchant (OPEN-7) | — (new) | foundation | Choose **one** district and line up **one** merchant with a signed pilot agreement. This is a business decision, not code; M6 cannot close without it. DoD: district config committed, one merchant campaign funded on testnet. |

### DEFERRED — post-launch "Decentralization Hardening" (keep on M11→M12→M13, downgrade later)

- **Entire P2P auto-update swarm: M13 / #102–#113** (content-addressed packages,
  torrent chunk transfer, seed/leech, swarm telemetry, offline-independence
  drills, production release gate). None started; none needed to ship. The node
  agent already self-updates from `ReleaseRegistry`.
- Governed validator handover / wallet-paired admission (#109) — single operator
  admin key is acceptable for a bootstrap you run.
- iOS Trust Center launcher / light-client quorum signer (#110) — iOS stays
  `mobile_peer`.
- Relay-first public bootstrap / DHT-as-default, CometBFT state pruning,
  KMS/Vault secret management, formal slashing.

### Hardening fast-follow (P1, not go-live-blocking)

- **App Attest server-side verification (#21, #31).** The pipeline is *honestly*
  labeled today: claims carry `integrity_mode: "dev-unattested"`
  (`services/validator-node/src/server.rs`), so nothing is misrepresented. Full
  verification is real work and must not be certified against invented vectors.
  Capture procedure before enabling enforcement:
  1. On a physical device, run the app's App Attest flow and log the raw
     attestation object (CBOR) + the assertion for one claim.
  2. Commit it as a golden test vector under a `test/` path (excluded from the
     secret scanner).
  3. Implement verification in `services/gateway-api` (attestation: verify x5c
     chain to Apple's App Attest root, nonce = `SHA256(authData ‖ SHA256(clientData))`,
     rpId hash, AAGUID, extract pubkey; assertion: signature + counter), keyed on
     the Team ID from config.
  4. Gate enforcement behind a flag; flip only after the golden vector passes.

## Runbooks (foundation-owned steps)

### R1 — Internet-reachable backend, no LAN (#50)
The `step-backend` tunnel is already live and boot-persistent (LaunchAgent
`app.step.backend-tunnel`). Only DNS remains — the CF API token cannot edit it:
1. In the regiominer.com zone add **4 PROXIED CNAMEs** →
   `329b02b6-46bb-4273-8751-a4909f9b900f.cfargotunnel.com`:
   `gw`, `idx`, `acc`, `nft` `.step.regiominer.com` (ingress already mapped to
   the local gateway/indexer/account/nft ports).
2. Redeploy the worker: `set -a; . ./.env.cloudflare; set +a; pnpm run deploy:cloudflare-worker`.
3. Verify from a network with **no LAN route**: submit a claim; confirm it
   finalises. Then the updated `pnpm release:public-edge:verify` must pass.

### R2 — iOS App Store submission (#33)
The key is on disk; do not re-issue it. Key ID `24882Q9AM6`, Issuer
`50da2e06-9a19-4a5f-a183-13f82dff3137`, Team `GZE5C5C4L8`, App ID `6781713930`.
1. Confirm `apps/ios/App/project.yml` + `StepApp.swift` point at
   `gw|idx|acc|nft.step.regiominer.com` (not `*.step.example`); bump the build.
2. Fill legal metadata (see Legal row) — no `[PLACEHOLDER]` may remain.
3. `xcodegen generate` → archive → `altool --upload-app --apiKey 24882Q9AM6
   --apiIssuer 50da2e06-9a19-4a5f-a183-13f82dff3137`.
4. App Store Connect → TestFlight → submit for external Beta App Review (internal
   testers are instant; external needs review). App Store production submission
   is the App Attest entitlement `development`→`production` flip **at that point**.

### R3 — Commit worker.js
`worker.js` is the deployed edge (`wrangler.toml` `main = "./worker.js"`) and is
untracked. Review it, then `git add worker.js` and commit. The production-safety
scanner already recognises it as production config and will cover it.

### R4 — Live-chain genesis ceremony + governed handover (#58, #59)
Tooling is committed; this is the owner-run *execution* on the live chain, which
still runs public dev keys:
1. Run the secret-key genesis ceremony so validators use real (non-dev) keys;
   distribute `chain/genesis.json` to peers.
2. Run `contracts/script/HandoverToGovernance.s.sol` to move STEP admin to
   Timelock+Governor and renounce EOA admin (the script asserts no EOA admin
   remains).
3. Verify: chain identity proof (`pnpm release:system-identity:verify`) passes on
   the live, non-dev-key chain.

## Board structure

A **`v1 — First Working Version`** milestone groups the IN issues above without
changing their P0/P1 labels. The swarm stays on **M13** until v1 ships, then bulk
downgrades P0→P2. Rule: *if no live user or shipped surface depends on it, it is
not P0.*

## Debt discovered (surface for a follow-up, not fixed here)

- `scripts/ops/verify-public-edge.mjs` still validates the **retired**
  `apps/static-frontend/` surface, not the deployed root `worker.js` +
  `wrangler.toml` edge. Update it as part of #89 so the go-live gate checks what
  actually ships.
- `apps/web-miner` (`@step/web-miner`) and `apps/web` (`@step/web-explorer`) are
  still in the pnpm workspace and wired into `scripts/dev/start-full-stack.mjs`,
  while docs describe them as primary. They are **local-dev surfaces**, not dead —
  decide whether to keep them as dev tooling or retire them; do not delete blindly.
