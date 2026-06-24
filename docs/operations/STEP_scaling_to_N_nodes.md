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

## Phase 2 — Reachability for joiners (peer-native, no DNS, no LAN requirement)
Joiners reach the network by **PeerId over the libp2p relay + DHT** — from any
network, behind any NAT. See `docs/operations/STEP_peer_network.md` for the full
model. LAN/WireGuard are an optional same-network fast-path, **not** the boundary.
- 🤖 **Consensus mesh (the network-independent path):** run ≥1 public relay
  (`GOSSIP_RELAY_SERVER=1`); it prints its dialable `…/p2p/<RelayPeerId>`. Joiners
  reserve a circuit on it and join the gossip mesh + DHT from anywhere.
- 🤖 **Chain replication (CometBFT):** peers are addressed by node-id too
  (`evmd comet show-node-id` → `<id>@<host>:26656`); a relay/bootstrap host or a
  port-forwarded peer carries it. Same PeerId/node-id principle — no DNS.
- 🤖 LAN/mDNS auto-connects co-located peers instantly (fast-path only).
- **Exit:** a joiner on a *different network* (e.g. cellular) reserves a relay
  circuit and appears in the mesh — no LAN, no DNS, no public bind of a dev-key chain.

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

### Onboard chappie (node #2) — filled-in, copy-paste

Run **on chappie** (tribecca = hub at `192.168.100.64`, chain node-id below). Same
LAN, so no WireGuard needed; cross-location swaps the IP for the WG tunnel IP.
```bash
# 1. build the chain binary (fetches Go itself)
cd /path/to/step && sh scripts/chain/build-evmd.sh

# 2. join + sync from tribecca (uses the shared genesis + tribecca as the seed peer)
STEP_GENESIS=/path/to/chain/genesis.devnet.sample.json \
STEP_SEED=f7029b25bb3c6464206f4bf58defeb6d606a9f88@192.168.100.64:26656 \
  sh scripts/chain/join.sh chappie
node scripts/chain/install-chain.mjs        # boot-persistent + start syncing

# 3. once `evmd q ... status` shows catching_up=false, become a validator
sh scripts/chain/become-validator.sh chappie    # prints chappie's address
```
```bash
# 4. ON TRIBECCA (funded): give chappie's validator gas/stake, then verify
node scripts/chain/faucet.mjs --to <chappie-address-from-step-3>
evmd q staking validators --home ~/.evmd | grep moniker   # chappie should appear
```
> The same 4 steps onboard node #3…#N — only the moniker changes. Local
> multi-validator BFT was proven with `scripts/chain/join-local.sh` (a 2nd node on
> tribecca synced the full chain over P2P and joined the active set).

#### Make the chain reachable on the LAN first (Phase 2, one-time on tribecca)
The chain's EVM RPC defaults to loopback. Expose it on the LAN so joiners can read it:
```bash
STEP_EVM_RPC_HOST=192.168.100.64 node scripts/chain/install-chain.mjs   # reinstall + restart
# P2P (:26656) is already on 0.0.0.0 — that's how node2 synced.
```

#### chappie's app layer (validator-node + agent), keyless — after it's a chain validator
Prereqs on **tribecca** (one-time): a published agent release + the artifact server:
```bash
node scripts/release/publish.mjs --version 1.0.0 --platform darwin-arm64       # authorizes the binary hash on-chain
node scripts/release/serve-artifacts.mjs --stage --version 1.0.0 --platform darwin-arm64
STEP_ARTIFACT_HOST=192.168.100.64 node scripts/release/serve-artifacts.mjs &   # serves on :8078
```
Then **on chappie**, the keyless install (node generates its own key — nothing secret travels):
```bash
curl -fsSL http://192.168.100.64:8078/install.sh | sh -s -- \
  --rpc http://192.168.100.64:8645 \
  --registry 0x6e7B8A754A8a9111F211bC8C8f619E462f8DdF5F \
  --platform-id 0x3bdd03393e221a1bbdac482d1ae2470a13d84a69452fd2a9d88a645036f90658 \
  --artifact http://192.168.100.64:8078/step-node-agent \
  --sha256 <hash printed by publish.mjs> \
  --nonce-secret <shared GATEWAY_NONCE_SECRET from tribecca .runtime/.env.runtime>
# it prints chappie's app address → on tribecca: node scripts/node/register.mjs <addr>
```

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
