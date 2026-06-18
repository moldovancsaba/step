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

## 6. Phased plan

- **Phase 1 — local-first (DONE).** Whole backend on this Mac; web app wired to
  it; map/login/wallet work in-browser. CORS + session-cookie fixes landed.
- **Phase 2 — add a second trust-center node.** A `node join` operator script:
  generate a key, register on-chain with a weight, run the validator pointed at
  the shared chain, over the chosen transport (§5). Prove a 2-location quorum.
- **Phase 3 — P2P gossip.** Replace/augment the gateway hub with libp2p gossip so
  nodes exchange claims/votes peer-to-peer; submit on quorum.
- **Phase 4 — shared public chain + node onboarding docs.** Move off the local
  devchain to a shared chain so locations agree without trusting this Mac's chain.

## 7. Why this is honest about trust

- Adding a node is an **explicit on-chain grant** (`registerValidator`) — trust is
  never implicit or ambient. Removing/slashing is `setStatus`/`ValidatorSlashed`.
- Each node **re-derives** verdicts from deterministic rules; it never rubber-
  stamps a peer. Quorum is **weighted**, so a single location can't dominate.
- No raw GPS in logs; nodes log claim hashes + verdicts only (privacy invariant).
