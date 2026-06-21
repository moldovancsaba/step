# Scaling STEP to N sovereign trust centers

> The sequenced path from "one machine" to "chappie joins as node #2, then #3 … #N",
> on the **sovereign chain** (CometBFT + EVM, ADR-024) — not the dev anvil. Each
> phase lists who does it (🤖 = automatable / already scripted; 👤 = owner action)
> and the exit criterion. Run phases in order; a node is "real" once it reaches
> Phase 4.

## Phase 0 — Foundation on the hub (tribecca) · DONE / hardening
- 🤖 evmd built; STEP's 13 contracts deployed (chain-id 262144); state persists.
- 🤖 **Boot-persistent chain:** `node scripts/chain/install-chain.mjs` (LaunchAgent
  `app.step.chain`, RunAtLoad+KeepAlive). Survives reboot/crash.
- **Exit:** the chain is up after a reboot; `cast call <TrinityToken> "symbol()"` → `TRIN`.

## Phase 1 — Cut the app stack over to the sovereign chain
The gateway/validators/agent currently talk to anvil (31337). Re-point them at
evmd (8645) so the app actually *uses* the sovereign chain.
- 🤖 Set `STEP_RPC_URL(S)=http://<hub>:8645`, `STEP_DEPLOYMENTS_FILE=…/262144.json`,
  `STEP_CHAIN_ID=262144` for gateway + validators + agent; restart.
- 🤖 Re-verify the **full mine→reward** flow on evmd (frontier → claim → finalise →
  Trinity + twin), since gas/precompiles differ from anvil.
- **Exit:** `scripts/dev/smoke.mjs` (pointed at evmd) finalises a mine and mints Trinity.

## Phase 2 — Reachability for joiners (no DNS)
A second machine must reach the hub's chain P2P (26656) + RPC.
- 🤖 Chain P2P already binds `0.0.0.0:26656`; expose it on the LAN/WireGuard (same
  net-guard rules as elsewhere — never a public bind of a dev-key chain).
- 🤖 Capture the hub's seed: `evmd comet show-node-id` → `<id>@<hub-ip>:26656`.
- 👤 (cross-location only) self-hosted WireGuard between machines (scripts/net/wg-gen.mjs).
- **Exit:** the joining machine can `nc -z <hub-ip> 26656`.

## Phase 3 — Join node #2 (chappie) as a synced node
On chappie (one-time per machine):
- 🤖 `sh scripts/chain/build-evmd.sh` — build the binary (fetches Go itself).
- 🤖 `STEP_GENESIS=<shared genesis> STEP_SEED=<id>@<hub-ip>:26656 sh scripts/chain/join.sh chappie`
  — installs the home from the shared genesis + peer.
- 🤖 `sh scripts/chain/start.sh` (then `install-chain.mjs` to make it persistent).
- **Exit:** chappie's `eth_blockNumber` tracks the hub's (synced).

## Phase 4 — Make node #2 a BFT validator
- 🤖 On chappie: `sh scripts/chain/become-validator.sh chappie` — prints chappie's
  address, then submits create-validator.
- 🤖 On the hub (funded): `node scripts/chain/faucet.mjs --to <chappie-addr>` so it
  has gas/stake. (Devnet uses `dev0`; production uses the designated funding key.)
- 🤖 Run the STEP app on chappie pointed at the chain: validator-node + node-agent
  (keyless install) + optional gossip node, all with `STEP_RPC_URLS=http://<hub>:8645`.
- **Exit:** `evmd q staking validators` lists chappie in the active set; the fleet
  console shows it `up` (signed heartbeats).

## Phase 5 — Node #3 … #N (repeat, identical)
Every further machine is **the same Phase 3 + 4 commands** — that is the whole
point of the sovereign design. For genuine BFT fault tolerance you want **≥4
validators** (tolerates one failure). The bottleneck becomes coordination, not code.

## Phase 6 — Production hardening (before real value)
These replace the devnet shortcuts; sequence them once ≥4 nodes run reliably.
- 👤+🤖 **Secret-key genesis ceremony** (audit C1, issue #58): regenerate genesis
  with secret per-operator keys; `scripts/chain/genesis-check.mjs` must report clean.
  Distribute the new genesis + SHA-256; everyone re-joins it.
- 👤+🤖 **Governed redeploy** (audit C2, issue #59): redeploy STEP from a secret key,
  hand all roles to the Timelock+Governor, renounce the EOA (invariant proven in
  `test/GovernedHandover.t.sol`).
- 🤖 Non-zero gas floor (issue #63): drop `STEP_LOCAL_DEV`, set `STEP_MIN_GAS_PRICE`.
- 👤 Public bootstrap gossip peer (a port-forwarded node / VPS, addressed by PeerID).
- 👤 External security audit; legal/privacy gates; freeze protocol params.

## Phase 7 — Public surfaces (parallel, owner-gated)
- 👤 Web: add the `gw`/`idx` DNS CNAMEs → the tunnel; `pnpm run deploy:cloudflare-worker`.
- 👤 iOS: re-point from `*.step.example` to the live URL; upload TestFlight 0.1.0(2).

---

### Quick reference — onboard machine N
```bash
# on machine N
sh scripts/chain/build-evmd.sh
STEP_GENESIS=<genesis> STEP_SEED=<id>@<hub>:26656 sh scripts/chain/join.sh nodeN
node scripts/chain/install-chain.mjs            # persistent chain
sh scripts/chain/become-validator.sh nodeN      # prints nodeN address
# on a funded machine
node scripts/chain/faucet.mjs --to <nodeN-addr>
# on machine N: run the STEP app (keyless)
curl -fsSL <hub>/install.sh | sh -s -- --sha256 <hash> --rpc http://<hub>:8645 \
  --registry <ReleaseRegistry> --platform-id <id> --artifact <hub>/step-node-agent \
  --nonce-secret <shared>
node scripts/node/register.mjs <nodeN-validator-addr>   # hub grants quorum weight
```
