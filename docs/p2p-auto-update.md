# STEP P2P auto-update and swarm distribution

## Purpose

STEP Trust Centers must be able to update, recover, and seed release artifacts without depending on one local machine or one hosted artifact server.

The production rule is simple:

- release authority comes from the on-chain `ReleaseRegistry`;
- bytes can come from any peer;
- every package, manifest, chunk, binary, params file, and config file is verified before use;
- failed verification fails closed;
- failed install rolls back to the last known-good release.

## Release authority

`ReleaseRegistry` now stores the full release package commitment:

- `binaryHash` - validator/node binary hash;
- `paramsHash` - protocol params hash;
- `configHash` - canonical runtime config hash;
- `packageHash` - installable package/bundle hash;
- `manifestHash` - canonical off-chain release manifest hash;
- `chunkRoot` - deterministic chunk index commitment;
- `packageSize` - exact package size in bytes;
- `minAgentVersion` - minimum local agent version allowed to install the release.

A peer can advertise or serve bytes, but it cannot authorize bytes. Authorization remains on-chain.

## Artifact API

Every Trust Center node agent exposes the same artifact surface:

```text
GET /healthz
GET /v1/agent/status
GET /artifacts/status
GET /artifacts/{platform}/{version}
GET /artifacts/{platform}/{version}/package
GET /artifacts/{platform}/{version}/manifest.json
GET /artifacts/{platform}/{version}/chunks-{index}
```

`/artifacts/{platform}/{version}` remains compatible with the original binary/package endpoint.

The response header `x-step-content-sha256` is returned for package/chunk responses so clients can log and compare transport bytes before final manifest/contract verification.

## Release publishing

The release publisher builds the validator, hashes the binary, generates a canonical release manifest, computes deterministic chunk metadata, and publishes the full package commitment to `ReleaseRegistry`.

Dry run:

```bash
node scripts/release/publish.mjs --version 1.0.15 --platform darwin-arm64 --dry-run
```

On-chain publish requires a clean worktree and release signer configuration:

```bash
STEP_RPC_URL=http://127.0.0.1:8645 \
RELEASE_REGISTRY=0x... \
RELEASE_SIGNER_KEY=0x... \
node scripts/release/publish.mjs --version 1.0.15 --platform darwin-arm64
```

## Artifact server compatibility

The hub artifact server and peer node-agent server now expose compatible package/manifest/chunk paths. This allows the resolver to treat local peer, remote peer, and object-store mirrors as untrusted byte sources behind the same verification model.

Stage a built validator artifact:

```bash
node scripts/release/serve-artifacts.mjs --stage --version 1.0.15 --platform darwin-arm64
```

Run the server:

```bash
node scripts/release/serve-artifacts.mjs
```

## Swarm readiness verifier

Use the verifier against any one or more Trust Centers:

```bash
pnpm release:p2p-update-swarm:verify -- --peers http://tribecca.local:9200,http://chappie.local:9200
```

For a specific release:

```bash
pnpm release:p2p-update-swarm:verify -- --platform darwin-arm64 --version 1.0.15 --peers http://tribecca.local:9200,http://chappie.local:9200
```

The verifier checks:

- agent health;
- agent status API;
- artifact status API;
- platform match;
- release availability when a version is supplied;
- package endpoint availability and content hash header.

## Installer behavior

The macOS package installs:

- `step-node-agent`;
- `step-trustcenter`;
- installer documentation shown during install.

After install, the user runs:

```bash
step-trustcenter provision
```

The Trust Center then:

- generates or reuses local node identity;
- stores identity in the OS secret backend;
- writes `trust-center.manifest.json`;
- starts launchd services;
- reports status with `step-trustcenter status` and `step-trustcenter doctor`;
- polls authorized releases and performs fail-closed updates through the node agent.

## Recovery model

The node-agent update state machine is:

```text
resolve active release -> fetch bytes -> verify hashes -> canary -> activate -> restart -> health gate -> mark good
```

If restart or health gate fails:

```text
rollback to last-good -> restart -> report rollback reason
```

If no last-good release exists, the agent holds rather than running unverified code.

## Operational definition of done

A release is not production-ready until:

- `forge test` passes for release registry changes;
- Rust node-agent build/tests pass;
- macOS package builds;
- at least one clean package install succeeds;
- Tribecca and Chappie expose the same artifact/status APIs;
- `pnpm release:p2p-update-swarm:verify` passes for both nodes;
- destructive Tribecca-offline survival drill passes;
- handover.md records package path, hash, node status, and drill evidence.
