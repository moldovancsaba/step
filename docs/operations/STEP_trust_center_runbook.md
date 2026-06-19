# STEP trust-center operations runbook

> Authoritative operational guide for the hardened, self-maintaining trust
> centers (M8). Covers install, automatic updates + failsafe rollback,
> integrity/tamper response, the emergency kill-switch, and secret/key custody.
> Each procedure lists prerequisites, exact commands, and verification.

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

## 8. Quick reference

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
