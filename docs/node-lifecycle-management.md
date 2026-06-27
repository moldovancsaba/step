# STEP node lifecycle management

Status: active on Tribecca and Chappie as of 2026-06-25.

## Goals covered

- Nodes restart after service crashes through `launchd` `KeepAlive` plus watchdog timers.
- Validator child crashes recover through the node watchdog restarting `step-node-agent`.
- Client/validator updates are authorized by the on-chain `ReleaseRegistry` and fetched from the artifact service.
- Downloaded artifacts are never trusted by transport. The agent verifies the canonical manifest hash, manifest fields, chunk root, every chunk hash, assembled package hash, executable binary hash, protocol params hash, and config hash against on-chain release state before activation.
- Activation is atomic through the `current -> releases/<version>` symlink and `state.json`.
- Failed updates roll back to `last_good` through the node-agent update state machine.

## Current active release

- Platform: `darwin-arm64`
- Version: `1.0.0`
- Packed version: `4294967296`
- Registry: `ReleaseRegistry`
- Registry state: published and promoted as the platform default.
- Chappie agent status after deployment: `target_version=1.0.0`, `current_version=1.0.0`, `child_health=up`, `integrity=ok`.

## Tribecca services

LaunchAgents:

- `app.step.chain`
- `app.step.gossip-tribecca`
- `app.step.gateway-api`
- `app.step.fleet-api`
- `app.step.artifacts`
- `app.step.watchdog-tribecca`

Important local endpoints:

- Artifact service: `http://127.0.0.1:8078/healthz`
- Gateway API: `http://127.0.0.1:8080/healthz`
- Fleet API: `http://127.0.0.1:8099/healthz`

The watchdog runs every 30 seconds and restarts missing launchd jobs.

## Chappie services

LaunchAgents:

- `app.step.chain-chappie`
- `app.step.gossip-chappie`
- `app.step.node-agent-chappie`
- `app.step.chappie-tunnel`
- `app.step.watchdog-chappie`

The old direct validator LaunchAgent was removed from the active launchd path. The validator now runs as a child of `step-node-agent`.

Important Chappie-local endpoints:

- Agent: `http://127.0.0.1:9200/healthz`
- Agent status: `http://127.0.0.1:9200/v1/agent/status`
- Validator child: `http://127.0.0.1:9101/healthz`
- Local chain RPC: `http://127.0.0.1:8645`

Chappie validator identity:

- Address: `0xbb0b44e189c69357ac19b627b7d421968d2678bb`
- Bonded consensus validator status: active in the federation.

## Secret handling

Chappie uses the node-agent `keychain` secret backend with service `app.step.node`. The validator key and nonce secret are stored under the node address namespace expected by `step-node-agent`. The temporary fallback `~/step-node/secrets.json` file has been removed.

No secret values should be committed to documentation or logs.

## Recovery checks performed

- Artifact service was moved under launchd and verified healthy.
- Chappie was moved from bare validator launch to `step-node-agent` launch.
- Chappie resolved the promoted on-chain release target.
- Chappie integrity check returned `ok` against on-chain hashes.
- Controlled validator-child crash test passed: killing the child and running the watchdog restored `agent=ok` and `validator=ok`.
- Federation list showed 4 trust-center nodes, total active weight `200`, quorum threshold `100`, quorum reachable.

## Operational commands

Check federation:

```sh
node scripts/node/list.mjs
```

Check Chappie agent through the reverse SSH tunnel:

```sh
ssh -i "$HOME/.ssh/step_chappie_reverse_ed25519" -o IdentitiesOnly=yes -p 2222 \
  -o StrictHostKeyChecking=accept-new \
  -o UserKnownHostsFile=/tmp/step-chappie-reverse-known_hosts \
  chappie@127.0.0.1 'curl -fsS http://127.0.0.1:9200/v1/agent/status; echo'
```

Publish a future release:

```sh
node scripts/release/publish.mjs --version <semver> --platform darwin-arm64
node scripts/release/serve-artifacts.mjs --stage --version <semver> --platform darwin-arm64
```

The artifact service must remain reachable by nodes, but it is not trusted for correctness. On-chain hashes are the authority.

## Peer-first update fetch

Each Trust Center tries configured artifact sources in order. A source is usable only when it can serve a release manifest whose canonical hash matches `ReleaseRegistry.manifestHash` and chunks whose recomputed root matches `ReleaseRegistry.chunkRoot`.

The normal installer order is:

```text
local node-agent artifact cache -> configured peer artifact seeds
```

This lets already-updated nodes seed other nodes without giving the transport any authority. If all sources fail verification or are unreachable, the node keeps the current verified release and reports a degraded update state.

## Tribecca managed validator upgrade - 2026-06-25

Tribecca now runs all three local validator processes through `step-node-agent`, matching Chappie's managed lifecycle model.

Managed validator agents:

- `app.step.node-agent-tribecca-0`: agent `9201`, validator child `9101`
- `app.step.node-agent-tribecca-1`: agent `9202`, validator child `9102`
- `app.step.node-agent-tribecca-2`: agent `9203`, validator child `9103`

Each Tribecca agent:

- resolves the `darwin-arm64` target from `ReleaseRegistry`
- runs current release `1.0.0`
- verifies binary/params/config integrity against on-chain hashes
- uses macOS Keychain backend `app.step.node`
- supervises its validator as a child process from `.runtime/tribecca-validator-*/current`

The old direct `target/release/step-validator-node` processes were stopped. Validator ports `9101-9103` are now owned by agent-supervised child processes.

The Tribecca watchdog now covers:

- platform services: chain, gossip, gateway API, fleet API, artifact server
- validator agents: `app.step.node-agent-tribecca-0..2`
- validator child health ports: `9101-9103`

Recovery check performed:

- Killed validator child on `9101`.
- Ran the Tribecca watchdog.
- Agent and validator returned to healthy state.
- Agent status returned `child_health=up` and `integrity=ok`.

## macOS package bootstrap

The production Mac bootstrap path is the STEP Trust Center package described in `docs/install-macos-pkg.md`. The package installs `step-node-agent` and `step-trustcenter`, then provisioning creates the user LaunchAgent and Keychain-backed node identity.

This keeps runtime updates independent from package distribution:

- the package installs the agent and local operator CLI
- the agent activates only release artifacts authorized by `ReleaseRegistry`
- wallet pairing through `TrustCenterRegistry` owns reward routing but does not grant validator weight
- launchd restarts the agent after crashes and login/session restarts

A node is considered operational only when `step-trustcenter doctor --json`, fleet API status, and on-chain release authorization all agree.
