# STEP independent P2P status

Last updated: 2026-06-25

## Current topology

STEP has an independent two-machine foundation:

- Tribecca/backend: sovereign chain node, gateway, fleet API, local validator set, and gossip relay.
- Chappie: independent sovereign chain node, bonded consensus validator, validator service, and gossip peer.

## Chain layer

The sovereign chain is not a single-machine state. The active bonded validator set includes:

- `localtestnet`
- `node2val`
- `chappie`

Chappie runs its own `evmd` node from the shared genesis and syncs over CometBFT P2P.

## RPC layer

Each peer uses its own local chain RPC:

- Tribecca gossip: `STEP_RPC_URLS=http://192.168.100.64:8645`
- Chappie gossip: `STEP_RPC_URLS=http://127.0.0.1:8645`

This is intentional for the independent model: RPC is local process access; agreement comes from the bonded BFT chain, not from one machine polling another machine's RPC.

## Gossip finalisation path

`step-gossip-node` now carries the full claim in quorum bundles and posts completed bundles to:

- Tribecca local submit URL: `http://127.0.0.1:8080/v1/gossip/finalise`
- Chappie submit URL: `http://192.168.100.64:8080/v1/gossip/finalise`

The gateway endpoint verifies the claim hash, vote consistency, on-chain validator weights, weighted quorum, evidence storage, and then submits to the contract. It does not trust the gossip node's reported weight.

## Peer-native node directory

`.runtime/nodes.json` marks Chappie with `transport: "peer"`.

Effects:

- Gateway HTTP fan-out ignores Chappie direct HTTP URLs; Chappie participates through gossip.
- Fleet API treats Chappie as peer-native and uses on-chain bonded weight as the trust/liveness source.
- `node scripts/node/list.mjs` shows Chappie as `peer / on-chain` instead of requiring hub-routable HTTP.

## P2P gossip layer

- Tribecca gossip relay listens on `/ip4/0.0.0.0/tcp/4001`.
- Chappie gossip peer listens on `/ip4/0.0.0.0/tcp/4002` and bootstraps through the Tribecca relay.
- Both gossip services are active through launch agents.

## Launch agents

On Tribecca:

- `app.step.gateway-api`: gateway + gossip finalise endpoint.
- `app.step.fleet-api`: fleet/status API with peer-native node support.
- `app.step.gossip-tribecca`: STEP P2P gossip relay/peer.
- `app.step.chain`: sovereign chain node.

On Chappie:

- `app.step.chain-chappie`: sovereign chain node.
- `app.step.validator-chappie`: STEP location validator service.
- `app.step.gossip-chappie`: STEP P2P gossip peer.
- `app.step.chappie-tunnel`: temporary/admin validator health reachability only; not required for local chain RPC, chain consensus, or gossip finalisation.

## Operational check results

- Tribecca and Chappie EVM RPC returned the same block height.
- Fleet API reported quorum reachable with active weight `200` against threshold `100`.
- Chappie is shown as reachable peer-native, in quorum, weight `50`.
- Chappie can reach Tribecca gateway `/healthz` and `/v1/gossip/finalise`.

## Remaining production hardening

The protocol path is independent across two machines. The remaining hardening is operational scale-out: add more external peers/relays and replace temporary admin tunnels with permanent peer-native observability.

## Lifecycle management update - 2026-06-25

- Tribecca now runs the artifact service under `app.step.artifacts` and a 30-second watchdog under `app.step.watchdog-tribecca`.
- Chappie now runs `app.step.node-agent-chappie`; the previous direct validator LaunchAgent is no longer the active validator path.
- Chappie's validator is supervised as a child of `step-node-agent` from `~/step-node/current`.
- The `darwin-arm64` `1.0.0` release is published and promoted in `ReleaseRegistry`.
- Chappie reports `current_version=1.0.0`, `target_version=1.0.0`, `child_health=up`, and `integrity=ok`.
- Chappie watchdog recovery was tested by killing the validator child and restoring it through the watchdog/agent path.
- Chappie now uses the `keychain` secret backend (`app.step.node`); the temporary file backend secret has been removed.
- See `docs/node-lifecycle-management.md` for operational details.

## Tribecca parity update - 2026-06-25

Tribecca is now at the same lifecycle level as Chappie for validator operation:

- `validator-0`, `validator-1`, and `validator-2` now run as children of `step-node-agent`.
- Active LaunchAgents: `app.step.node-agent-tribecca-0`, `app.step.node-agent-tribecca-1`, `app.step.node-agent-tribecca-2`.
- Agent ports: `9201`, `9202`, `9203`.
- Validator ports remain `9101`, `9102`, `9103`.
- All three report `current_version=1.0.0`, `target_version=1.0.0`, `child_health=up`, and `integrity=ok`.
- Tribecca watchdog now restarts validator agents and recovers dead validator children.
- Controlled child-crash recovery was tested on `validator-0` and passed.

## Trust Center package and identity status

The repository now contains the macOS `.pkg` delivery path for independent Trust Center nodes:

- `scripts/release/build-macos-pkg.mjs` builds the installer.
- `scripts/release/test-macos-pkg-e2e.mjs` performs local package acceptance checks.
- `scripts/release/notarize-macos-pkg.mjs` submits, staples, and assesses a production package.
- `TrustCenterRegistry` records wallet ownership and reward routing for node identities.
- Gateway onboarding endpoints expose `/v1/trust-centers/pair` and status polling.
- Fleet API output includes paired owner, reward recipient, Trust Center status, and validator active weight when registry data is available.

This is the foundation for an independently installable peer. Validator authority still remains explicit: wallet pairing never bypasses validator registry activation or release-registry artifact authorization.

## M11 public edge and no-localhost rule

Public STEP clients must not depend on `localhost`, `127.0.0.1`, or private LAN backends. The public access path is:

```text
Browser / Mobile
  -> same-origin STEP Worker /api
  -> signed peer directory or public bootstrap peers
  -> healthy Trust Center services
  -> chain-backed gateway, mesh, indexer, and fleet APIs
```

The Cloudflare Worker now exposes peer-aware routes:

```text
/api/gateway/*
/api/mesh/*
/api/indexer/*
/api/fleet/*
/api/trust-centers/*
/api/peers
/api/peers/healthy
/api/edge/health
```

Production deployment fails before upload if public backend configuration points to localhost, loopback, private LAN, or non-HTTPS endpoints. Local-only development must explicitly set `STEP_DEPLOY_ENV=local`.

The web miner is fail-closed: if indexer state is not reachable through the STEP edge gateway, mining is blocked because the app cannot prove the mineable frontier.
