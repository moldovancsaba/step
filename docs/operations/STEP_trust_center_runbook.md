# STEP trust-center operations runbook

> Authoritative operational guide for the hardened, self-maintaining trust
> centers (M8) and their reliable, **third-party-free** operation (M9). Covers
> install, automatic updates + failsafe rollback, integrity/tamper response, the
> kill-switch, secret/key custody, third-party-free transport (LAN/mDNS +
> self-hosted WireGuard), boot-persistence, outage resilience, one-command
> onboarding, and the roadmap to the P2P/DAO end-state. Each procedure lists
> prerequisites, exact commands, and verification.

Related: the on-chain trust layer is `contracts/src/ReleaseRegistry.sol` (#34/#35),
`contracts/src/IntegrityAttestation.sol` (#36); the agent is `services/node-agent`
(#40-#43); the fleet view is `services/fleet-api` (#45) + the GDS console (#46);
architecture is [STEP_local_node_and_trust_federation.md](../architecture/STEP_local_node_and_trust_federation.md).

## 0. Mental model (read first)

A trust center runs the **node-agent**, which supervises the validator. The agent
only ever runs code whose sha256 is **authorized on-chain** in `ReleaseRegistry`.
It updates itself from the hub, verifies each update against the chain, health-
checks, and **auto-rolls-back** on failure. It continuously re-measures its own
files; on tampering it **quarantines** (stops voting) and is auto-suspended from
quorum. Only `RELEASE_ROLE` (a timelock + Safe in production) can authorize code —
no third party can inject it.

## 1. Cut and publish a release (hub)

Prerequisites: hub running (`node scripts/dev/up.mjs`), `RELEASE_SIGNER_KEY` (or
the timelock) holds `RELEASE_ROLE`, clean git tree.

```bash
# build + hash + publish on-chain (the only way authorized code enters the system)
node scripts/release/publish.mjs --version 1.2.0 --platform darwin-arm64
# stage the built artifact for distribution and serve it over the tailnet
node scripts/release/serve-artifacts.mjs --stage --version 1.2.0 --platform darwin-arm64
node scripts/release/serve-artifacts.mjs     # runs the artifact server
```

Verify: `publish.mjs` prints the three hashes and asserts `isAuthorized` on-chain;
`GET /artifacts` lists the version with a matching `binary_sha256`.

Dry run (no publish): add `--dry-run`.

## 2. Install a trust center as a system service (node)

Prerequisites: the node registered on-chain (`scripts/node/join.mjs … --no-launch
--url …` on the hub), the run bundle delivered (`scripts/node/bundle.mjs` →
Taildrop/scp), the node's chain wiring in env.

```bash
# 1. store secrets in the keychain ONCE (no plaintext at rest, #43)
./provision-secrets.sh
# 2. install the agent as a boot-persistent, crash-restarting service (#44)
sudo AGENT_ROOT=~/step-node STEP_RPC_URL=http://<hub-tailnet>:8545 \
     RELEASE_REGISTRY=0x… NODE_ADDRESS=0x… PLATFORM_ID=0x… PLATFORM=darwin-arm64 \
     ARTIFACT_BASE_URL=http://<hub-tailnet>:8078 \
     node scripts/node/install-agent.mjs
```

Verify:
```bash
launchctl print system/app.step.node-agent | head      # macOS
curl -s http://127.0.0.1:9200/v1/agent/status            # agent status
node scripts/node/list.mjs                               # on the hub: node "up"
```

Uninstall: `sudo node scripts/node/install-agent.mjs --uninstall`.

## 3. How updates + failsafe rollback behave (automatic)

You normally do nothing. On each poll the agent resolves its target from
`ReleaseRegistry.effectiveTarget`, and if it differs from `current`:

1. downloads the artifact and **verifies sha256 vs the on-chain hash** (mismatch →
   aborts, stays on `current`);
2. runs a **functional canary** (fail → aborts);
3. **atomically activates** + restarts, then health-gates for a window;
4. on any failure → **auto-rolls-back to last-good** and records it.

Repeated rollbacks trip a **circuit-breaker** that pins `current` and pauses
auto-update (`status.last_action` shows `CIRCUIT OPEN`). To recover: fix the
release (or `revoke` it, §5), then clear the breaker by restarting the agent once
a good target is published.

Force a specific version (operator override): publish/promote it on-chain, or
`setNodeTarget(node, version)` to canary one node first.

## 3b. Transfer main-system responsibility between Trust Centers

Use this process to move operational primacy from one Trust Center to another
without redeploying binaries. The transfer is strictly on-chain and replay-safe:

1. Resolve source and target node addresses.
2. Confirm platform target version from `ReleaseRegistry`.
3. Pin the target node to that version with `setNodeTarget(target, version)`.
4. Optionally clear the source pin (`setNodeTarget(source, 0)`) so it falls back
   to platform target.
5. Optionally call `promote(platformId, version)` if the platform default must be
   moved too.

Use the hardened operator script:

```bash
pnpm release:main-system-handoff \
  --source-name tribecca \
  --target-name chappie \
  --platform darwin-arm64 \
  --version 1.0.15 \
  --promote
```

Dry-run first:

```bash
pnpm release:main-system-handoff \
  --source-name tribecca \
  --target-name chappie \
  --platform darwin-arm64 \
  --version 1.0.15 \
  --dry-run
```

Required env values:

- `STEP_RPC_URL`
- `RELEASE_REGISTRY` (or `.runtime/.env.runtime` equivalent)
- `RELEASE_SIGNER_KEY`

The script writes auditable evidence to `.runtime/handoff/*.json` with exact
before/after pins and rollback hints. Use that artifact during handoff review.

Rollback recipe:

1. set the previous source/target pins in reverse (from evidence `source.beforePin`
   and `target.beforePin`),
2. re-promote prior platform version if `--promote` was used.

## 4. Integrity / tamper response

The agent re-measures binary/params/config on a timer. On drift:
- it **quarantines** (stops the validator → stops voting),
- surfaces the finding in `/v1/agent/status` (`integrity: quarantined`),
- the hub attestor submits `IntegrityAttestation.reportTamper`, which sets the
  node `UnderReview` → its `activeWeight` drops to 0 (out of quorum).

In the console / `fleet-api` this shows as a **critical "suspended" alert**.

Remediate:
```bash
# 1. investigate (what changed, why); restore the authorized artifact if needed
# 2. once clean, clear the on-chain hold (VALIDATOR_ADMIN_ROLE):
cast send <IntegrityAttestation> "clearTamper(address)" <node> \
     --rpc-url <rpc> --private-key <admin>
# 3. restart the agent; it re-measures, passes, and rejoins quorum
```

## 5. Emergency kill-switch (revoke a bad release)

If a published version is bad, revoke it on-chain; every node falls back to the
last-known-good automatically.

```bash
cast send <ReleaseRegistry> "revoke(bytes32,uint64)" <platformId> <packedVersion> \
     --rpc-url <rpc> --private-key <release-signer-or-timelock>
```

`effectiveTarget` then resolves to the highest non-revoked version; agents
roll back on their next poll. In production this goes through the timelock unless
a shorter-delay emergency role is configured.

## 6. Secrets and key custody

- **Node secrets** (validator key, nonce secret) live in the OS keychain
  (`provision-secrets.sh`), never in run scripts or service units (#43). Rotate by
  re-provisioning and restarting the agent.
- **RELEASE_ROLE** is held by a timelock fronted by an M-of-N Safe (#37). Losing a
  signer below the threshold requires the documented Safe key-rotation; never
  hold `RELEASE_ROLE` on a bare CI key in production.
- **No secrets in logs**: the agent redacts known secret material.

## 7. Troubleshooting

| Symptom | Check | Action |
| --- | --- | --- |
| node `DOWN` in `node list` / console | `curl …:9200/v1/agent/status`; service logs | restart service; check tailnet reachability of its `--url` |
| node `suspended` (weight 0) | `integrity` field; `IntegrityAttestation.tamperState` | §4 remediate + `clearTamper` |
| stuck on old version | `status.last_action`; is the artifact served? | ensure `serve-artifacts` has the version; check `effectiveTarget` |
| `CIRCUIT OPEN` | repeated rollbacks | fix/revoke the release, restart the agent |
| wrong-arch binary on the node | bundle README arch line | build from source on the node (`cargo build -p step-validator-node --release`) |
| keychain locked / secret missing | `provision-secrets.sh` run? | re-provision; the agent is fail-closed until secrets resolve |
| fleet below quorum | `GET /v1/fleet/alerts` | bring nodes back up; quorum needs ≥ threshold active weight |

## 8. Operate with NO third parties (M9)

The whole update/supervise system is ours — the only thing that can be a third
party is the network transport. Two transport options, both third-party-free:

**Same LAN (no tunnel at all).** Point nodes at the hub by its mDNS name or a
reserved IP — no Tailscale:
```bash
node scripts/node/bundle-agent.mjs --name <node> --hub-host tribecca.local
# (or a router-reserved IP). Tailscale can be OFF on both machines.
```

**Different location (self-hosted WireGuard — our keys, no SaaS):**
```bash
node scripts/net/wg-gen.mjs --peer <node> --hub-endpoint <hub-public-or-lan>:51820
#   → .runtime/wg/<node>.conf   (install on the node as wg0)
#   → .runtime/wg/hub-<node>.peer (append to the hub's wg0.conf; `wg syncconf`)
node scripts/node/bundle-agent.mjs --name <node> --hub-host <hub-wg-tunnel-ip>
```

## 8c. Add a dedicated trust center — chappie or any new machine (#53)

Two steps: build the node's bundle on the hub, deliver it over a **trusted
channel**, run one command on the node. There is no npm/dmg/registry — the bundle
**carries the node's private key**, so it must never touch a public host (see
ADR-023 for the packaging rationale).

```bash
# 1. ON THE HUB (tribecca): register the node on-chain + build its self-contained
#    bundle. Same-network node → LAN/mDNS; different location → self-hosted WireGuard.
node scripts/node/onboard.mjs --name chappie --transport lan --advertise chappie.local
# cross-location instead:
#   node scripts/node/onboard.mjs --name vienna --transport wireguard --hub-endpoint <hub>:51820

# 2. DELIVER .runtime/agent-<node>.tgz over a trusted channel (scp/Taildrop/USB —
#    NOT a public link; it holds the node key).

# 3. ON THE NODE — one command (onboard prints it):
tar -xzf agent-chappie.tgz && cd agent-bundle-chappie \
  && ./provision-secrets.sh && ./install-service.sh
```

`provision-secrets.sh` stores the key + nonce secret in the OS keychain (run once);
`install-service.sh` makes the node **boot-persistent** (LaunchAgent/systemd: starts
at login, restarts on crash, #49). After this first install the agent **self-updates
from chain** (M8) — you never re-package or re-deliver.

**Every machine is always-on + self-recovering:**
- **Hub** (runs the chain + gateway + validators): install the supervisor daemon,
  baking the LAN address so trust centers can reach the chain after a reboot:
  ```bash
  sudo env STEP_ANVIL_HOSTS="127.0.0.1,<hub-LAN-IP>" node scripts/ops/install-hub.mjs
  ```
  LaunchDaemon `app.step.hub` (RunAtLoad + KeepAlive) brings the stack up at boot
  and re-asserts health every 60s, restarting it if anything dies.
- **Backend tunnel** (public web + iOS reach the backend): LaunchAgent
  `app.step.backend-tunnel` (`node scripts/ops/backend-tunnel.mjs --install`).
- **Each trust center**: the agent LaunchAgent above + the agent's own failsafe
  rollback/restart of the validator.
- **Disaster survival is a release gate, not a promise.** A Trust Center that
  claims `recovery.disaster_survival.tier = full` in
  `trust-center.manifest.json` must run independent gateway, fleet, chain RPC,
  validator, and gossip services. Verify it with:
  ```bash
  pnpm release:disaster-survival:verify
  ```
  The drill intentionally stops Tribecca gateway/fleet/validator launchd
  services, probes the remote Trust Center, and restores Tribecca before exit. If
  any remote endpoint is missing, the release fails and the deployment is not
  disaster-proof.
  Current Chappie deployment runs launchd services for chain RPC, gateway, fleet,
  gossip, node agent, its own validator, and redundant protocol validator
  replicas. The accepted release state is remote active weight `200`, quorum
  threshold `101`, and no remote fleet alerts while Tribecca gateway/fleet/
  validators are stopped.
- **Identical full-role installation is also a release gate.** The macOS package
  and shell installer refuse `--survival-tier full` unless a verified fullstack
  payload is supplied. That payload must contain the local Node runtime plus
  gateway, fleet, chain RPC, account, indexer, NFT indexer, validator, and
  gossip executables/bundles. The installer then writes a full-role manifest and
  installs launchd services for chain, gateway, fleet, gossip, validator,
  account, indexer, NFT indexer, and agent. Verify the invariant with:
  ```bash
  pnpm release:system-identity:verify
  ```
  This gate proves every full Trust Center has the same baseline capability
  profile. Bootstrap/relay/artifact mirroring can be added per topology, but the
  full survival baseline is non-optional.

> Optional P2P layer: a center that should also gossip claims/votes peer-to-peer
> runs `step-gossip-node` alongside the validator (#54) — see the architecture doc
> §4. Not needed for a standard trust center; the validator + agent are the system.

## 8d. Reliability behavior (M9)
- **Hub outage (#51):** a node keeps running its current *verified* version, sets
  `degraded` in `/v1/agent/status`, retries with exponential backoff, and recovers
  automatically when the hub returns. It never runs unverified code and never
  false-quarantines on an unreadable baseline.
- **RPC failover (#50):** set `STEP_RPC_URLS=url1,url2,…`; the agent fails over if
  one chain endpoint is down.
- **Artifact failover (#52):** set `ARTIFACT_BASE_URLS=url1,url2,…`; the agent tries
  each, hash-verifying against the chain — a dead/corrupt mirror is skipped.
- **Signed heartbeats (#56):** set `FLEET_URL=http://<hub>:8099`; each agent signs a
  periodic heartbeat with its node key and POSTs it. The hub verifies the signature
  against the node's registered on-chain address (no spoofing) and surfaces four
  states — **up / degraded / suspended / dark** — at `GET /v1/fleet/heartbeats`, with
  deduped alerts on missed-heartbeat, quarantine, drift, and below-quorum. A degraded
  (self-recovering) node is now distinguishable from a dead one.

## 8e. Roadmap to the P2P/DAO north star
Today is hub-and-spoke (a bootstrap). The single-hub dependency is removed by, in
order: **shared chain** (#50, replicated ledger), **libp2p gossip** (#54, no central
gateway), **DAO governance** (#55).

**DAO governance (#55) — delivered.** `StepGovernor` (`contracts/src/StepGovernor.sol`)
is an audited-OZ Governor that votes (weighted by `StepGovToken`, an `ERC20Votes`)
over privileged actions and executes them through the existing `TimelockController`
(#37), which holds RELEASE_ROLE / PARAM_ROLE / VALIDATOR_ADMIN_ROLE. A release is
authorized only after propose → vote → quorum+majority → queue → timelock delay →
execute — no single admin key. The emergency kill-switch (release `revoke`, §5)
stays on a guarded role outside the vote. See `test/StepGovernor.t.sol` for the
end-to-end flow.

**P2P gossip (#54) — delivered.** `step-gossip-node` (`services/gossip-node`) is a
libp2p gossipsub mesh where any node receives a claim, asks its co-located
validator to validate+sign, gossips the EIP-712 vote, aggregates peers' votes by
claim, and — at weighted on-chain quorum — submits the bundle. No central gateway
sits in the claim→finalise path. Peer identity is the validator's secp256k1 key;
discovery is mDNS on the LAN plus explicit self-hosted bootstrap peers (no
third-party signaling). Run alongside a validator with `VALIDATOR_URL`,
`STEP_QUORUM_THRESHOLD`, and optional `GOSSIP_BOOTSTRAP`. The protocol core
(message auth, weighted-quorum assembly, replay/dedup) is pure and unit-tested.

**Shared ledger (#50) — in progress (trust-minimised reads delivered).** Two slices
landed toward replacing the single-hub devchain: RPC failover (`STEP_RPC_URLS`,
agent) and **multi-endpoint read agreement** (gossip node) — a weight that affects
quorum is accepted only when a majority of independent chain endpoints agree on it,
and a lone divergent endpoint is flagged, not trusted (`STEP_RPC_URLS`,
`STEP_RPC_MIN_AGREE`). The full replicated-ledger migration (multiple consensus
nodes replacing the devchain) remains the open infrastructure track.

## 9. Quick reference

```bash
# hub
node scripts/release/publish.mjs --version X --platform P     # authorize code
node scripts/node/list.mjs                                     # fleet (CLI)
curl -s http://localhost:8099/v1/fleet | jq                    # fleet (API)
cast send <ReleaseRegistry> "revoke(bytes32,uint64)" …         # kill-switch

# node
./provision-secrets.sh                                         # store secrets
sudo node scripts/node/install-agent.mjs                       # install service
curl -s http://127.0.0.1:9200/v1/agent/status                  # agent status
```
