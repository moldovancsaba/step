# STEP — local-first node + trust-center federation

> Status: design + Phase 1 delivered. This document explains how STEP runs
> entirely on one machine today, and the concrete path to a federation of
> geographically-distributed **trust-center nodes** sharing one ledger of trust
> — the "P2P shared resource / blockchain trust service".

## 1. The vocabulary, in plain terms

You asked for three things. Here is what each maps to in STEP:

| You said | In STEP it is |
| --- | --- |
| "everything backend runs on this computer" | the **native stack** (`scripts/dev/up.mjs`): a local chain + contracts + validator nodes + APIs, all on this Mac |
| "add new nodes in different locations as trust centers" | additional **validator nodes** registered in the on-chain `ValidatorRegistry`, each a trust center that votes on claims |
| "a shared P2P resource system, a kinda blockchain trust service" | the **shared ledger** (the chain) that every node reads/writes, plus the **gossip layer** that lets nodes exchange claims/votes peer-to-peer |

The key idea: a STEP "node" is not just a server — it is a **trust center** that
holds a key, independently re-checks every mining claim against the deterministic
rules, and signs a vote. A claim only becomes real when **enough nodes' weighted
votes reach quorum** (recorded on-chain). No single node — not even this Mac —
can mint Trinity alone. That weighted-quorum-on-a-shared-ledger is the
"blockchain trust service".

## 2. What runs on this computer (Phase 1 — delivered)

`node scripts/dev/up.mjs` brings the whole backend up natively on this machine:

```
anvil (chain :8545)
  └─ deploy contracts (ValidatorRegistry, MiningClaimVerifier, NFT, Marketplace…)
  └─ register 3 validators on-chain (weight 50 each, quorum 100)
3× validator-node (Rust)        :9101 :9102 :9103   ← trust centers
gateway-api                     :8080               ← collects votes, submits to chain
indexer                         :8090               ← oasis/desert projection
proof-storage / exchange / merchant / campaign-worker
account-api                     :8091               ← wallet vault + login
nft-indexer                     :8092               ← NFT + marketplace
```

The web app (`apps/web-app`, `pnpm --filter @step/web-app dev` on :3020) reads
`apps/web-app/.env.development`, which points every `VITE_*` URL at this machine.
Result: register/login, the oasis/desert **map**, wallet, and marketplace all run
against this computer with no cloud dependency. (Verified end-to-end in-browser:
the map renders real triangles served by the local mesh engine.)

`down.mjs` stops it; `smoke.mjs` checks it. Secrets are generated per run into
`.runtime/.env.runtime` and never committed.

### Durability — this is a real backend, not a demo

The stack persists across restarts (nothing resets), which is what makes it a
working solution rather than a throwaway:

- **Accounts + encrypted wallet vaults** — SQLite (`ACCOUNT_DB_FILE`,
  `.runtime/account.db`) via Node's built-in `node:sqlite`. Registering and
  logging back in after a restart works.
- **Sessions** — a stable `SESSION_SIGNING_KEY` (in `.runtime/secrets.json`,
  generated once) so cookies stay valid across restarts.
- **The chain** — `anvil --state .runtime/anvil-state.json --state-interval 2`
  loads prior state on start and dumps periodically + on graceful shutdown;
  `down.mjs` stops anvil with SIGTERM so it flushes. Contracts are deployed once
  and **reused** on the next start (balances, NFTs, validator registrations
  survive).
- **Node identities** — validator keys live in `.runtime/secrets.json`; each
  joined node's key is saved under `.runtime/nodes/<name>.json`, so re-running
  `node join` keeps the same on-chain identity (idempotent — it skips
  re-registration if already active).

Everything under `.runtime/` is gitignored — secrets and the account DB are
never committed.

### Making this Mac reachable from the outside

`scripts/ops/run-mac-online.mjs` runs an **online gateway** (default :8070) in
front of the native stack — the seam for exposing this machine to the public app
and to remote nodes. How that exposure happens (tunnel vs. static IP vs. VPN) is
the open decision in §5.

## 3. A trust-center node, concretely

Every validator node is identical software (`services/validator-node`, Rust). A
node becomes a **trust center in the federation** through three facts:

1. **It has a key.** `VALIDATOR_PRIVATE_KEY` — its identity. Its address is what
   signs votes (EIP-712) and what gets registered on-chain.
2. **It is registered on-chain.** An admin calls
   `ValidatorRegistry.registerValidator(address, type, weight)`. `type` is a
   weight class (`Foundation`, `Independent`, `MobilePeer`, …); `weight` is its
   say in quorum. This registration *is* the act of granting trust to a new
   location.
3. **It re-checks everything.** On each claim it independently runs
   `step-validation-rules` (geometry, nonce, rate limits, attestation) and signs
   approve/deny. It trusts no other node's word — it re-derives the verdict.

Adding "a node in another location as a trust center" therefore means: run the
same binary there with its own key, point it at the shared chain + mesh params,
and register its address with a weight. Quorum then requires that node's
participation in proportion to its weight.

```
                       shared ledger (chain)
                ┌───────────────┴───────────────┐
        ValidatorRegistry              MiningClaimVerifier
        (who is trusted,                (quorum of weighted
         at what weight)                 votes → finalised)
                ▲                                ▲
   ┌────────────┼─────────────┐                  │ submit accepted claim
   │            │             │                  │
node A        node B        node C   …      gateway / relayer
(Budapest)   (Vienna)     (your Mac)
  re-check + sign votes; gossip claims & votes peer-to-peer
```

## 4. The "shared P2P resource" / blockchain trust service

Two layers make the resource *shared*:

- **Shared state = the chain.** The chain is the single source of truth every
  node reads and writes: who is a validator (`ValidatorRegistry`), which claims
  finalised (`MiningClaimVerifier`), who owns which triangle NFT. This is the
  "blockchain" in "blockchain trust service". Today it is a local `anvil`
  devchain; a real federation runs a shared chain (see §5).
- **Shared transport = gossip (the P2P upgrade).** Today the gateway is a hub: it
  fans a claim out to validators and collects votes. The documented next step
  (already noted in `validator-node/src/main.rs`) is a **libp2p gossip** mesh so
  nodes exchange claims and votes **peer-to-peer**, with no central hub — any
  node can receive a claim, gossip it, collect signed votes from peers, and once
  weighted quorum is met, submit the bundle to the chain. The vote/claim message
  shapes are already transport-independent, so this is an additive transport, not
  a rewrite.

Net trust property (unchanged by transport): **a claim is real iff a weighted
quorum of registered trust centers independently signed it.** Compromising one
location cannot mint Trinity or forge ownership.

## 5. The one decision that's yours: how locations connect

Everything above is software we control. The remaining choice is **physical
networking + where the shared chain lives**, because it touches your machines and
your security exposure. The options (Phase 2):

1. **Hub-and-spoke over secure tunnels (recommended first step).** This Mac stays
   the canonical node and runs the shared chain; each new location runs a
   validator that dials in over an authenticated tunnel (WireGuard or a managed
   tunnel like Cloudflare Tunnel/Tailscale). Simplest, no public IP needed, you
   keep one chain. Add nodes one at a time.
2. **Public endpoints.** Each node (incl. this Mac) is reachable at a public
   address/domain; nodes talk directly. More "real P2P" but exposes each machine
   and needs ops hygiene (TLS, firewalling, DDoS).
3. **Full libp2p gossip mesh + shared/public chain.** The end-state: no hub,
   nodes discover and gossip peer-to-peer, anchored to a shared public testnet.
   Most decentralised, most work.

These differ in how much of your home machine gets exposed and how much new
infrastructure you stand up — which is why it's your call, not a default.

## 6. Adding a trust-center node (delivered)

A node joins the federation with one command:

```bash
# Add a node (here on this machine at :9104; on another machine it's the same
# command pointed at the shared chain — see the remote env vars below).
node scripts/node/join.mjs --name vienna --port 9104 --weight 50 \
     --type Infrastructure --location "Vienna, AT"

# See the whole federation: directory ∪ on-chain weight ∪ live health.
node scripts/node/list.mjs
```

`join.mjs` performs the three acts of §3: it mints (or accepts) the node's key,
**registers it on-chain** in `ValidatorRegistry` with a weight (the trust grant),
runs the validator, then appends it to the federation directory
(`.runtime/nodes.json`). The **gateway reads that directory live**
(`listValidatorUrls`), so the new node is fanned claims and its weighted vote
counts toward quorum **without a restart**. `list.mjs` cross-checks each node's
directory entry against its on-chain `activeWeight` and its live `/v1/node/info`
— a node is only trusted when all three agree.

Verified locally: a freshly joined node was registered on-chain (active weight
50), independently validated a real claim from the gateway, and signed an
approve vote — federation weight 150 → 200.

### Tailscale federation (this deployment)

The hub is **tribecca** (this machine); the first remote trust center is
**chappie** (`chappie.tailc0f646.ts.net`), both on the same tailnet. The flow,
which needs no repo/toolchain on the remote machine and no chain RPC for the
running node:

```bash
# On the hub (tribecca): expose the chain on the tailnet (up.mjs does this
# automatically — binds anvil to 127.0.0.1 + this machine's Tailscale IP).

# 1. Register the remote node on-chain + add it to the gateway directory, but
#    don't launch it here:
node scripts/node/join.mjs --name chappie --port 9104 --weight 50 \
     --type Infrastructure --location "chappie (tailnet)" \
     --no-launch --url http://chappie.tailc0f646.ts.net:9104

# 2. Build a self-contained run bundle (binary + params + run.sh with the node's
#    key baked in) and send it to the node over Taildrop (or scp):
node scripts/node/bundle.mjs --name chappie --port 9104 \
     --url http://chappie.tailc0f646.ts.net:9104
tailscale file cp .runtime/remote-chappie.tgz chappie:

# 3. On chappie (the only step that runs there): accept the Taildrop file, then
tar -xzf remote-chappie.tgz && cd bundle-chappie && ./run.sh

# 4. Back on the hub:
node scripts/node/list.mjs     # chappie flips DOWN → up, federation weight 150 → 200
```

The hub's gateway reaches the node at its tailnet hostname (MagicDNS) and fans
claims to it; the node re-checks and signs. The bundle's binary is built for the
hub's architecture (arm64 macOS here) — if the target differs, build the
validator from source there instead.

**Generic remote node (non-Tailscale).** Same `join` command; provide the shared
chain in the environment instead of reading `.runtime/.env.runtime`:

```bash
STEP_RPC_URL=https://<shared-chain-rpc> \
STEP_CHAIN_ID=<id> \
STEP_DEPLOYMENTS_FILE=/path/to/deployments.json \   # or VERIFIER_CONTRACT_ADDRESS + VALIDATOR_REGISTRY
GATEWAY_NONCE_SECRET=<shared-secret> \
STEP_PROTOCOL_PARAMS=/path/to/protocol-params.json \
STEP_ADMIN_KEY=<foundation-admin-key> \             # authorises registerValidator
  node scripts/node/join.mjs --name budapest --port 9104 --weight 50 --type Infrastructure
```

How the remote node reaches the shared chain + how the gateway reaches the remote
node (tunnel vs public endpoint) is the §5 networking decision.

> **Operations:** day-to-day procedures (install, update, rollback, tamper
> response, kill-switch, secrets) live in the
> [trust-center runbook](../operations/STEP_trust_center_runbook.md).

## 7. Remaining phases

- **Phase 3 — P2P gossip.** Replace/augment the gateway hub with libp2p gossip so
  nodes exchange claims/votes peer-to-peer; submit on quorum. (Message shapes are
  already transport-independent.)
- **Phase 4 — shared public chain.** Move off the local devchain to a shared
  chain so locations agree without trusting this Mac's chain; wire the chosen
  §5 transport so remote nodes connect.

## 7. Why this is honest about trust

- Adding a node is an **explicit on-chain grant** (`registerValidator`) — trust is
  never implicit or ambient. Removing/slashing is `setStatus`/`ValidatorSlashed`.
- Each node **re-derives** verdicts from deterministic rules; it never rubber-
  stamps a peer. Quorum is **weighted**, so a single location can't dominate.
- No raw GPS in logs; nodes log claim hashes + verdicts only (privacy invariant).
