# STEP Trust Center macOS package install

This document defines the production macOS installer path for a STEP Trust Center node. The package installs the local node runtime and the `step-trustcenter` operator command. It does not auto-enroll the computer as a validator and it does not embed private keys.

## Install

Build the package from the repository root:

```bash
pnpm release:macos-pkg -- --version 1.0.0 --platform darwin-arm64
```

Install the generated package:

```bash
sudo installer -pkg .runtime/dist/STEP-TrustCenter-1.0.0-darwin-arm64.pkg -target /
```

The installer writes:

```text
/usr/local/bin/step-node-agent
/usr/local/bin/step-trustcenter
```

The installer deliberately does not provision identity during `postinstall`. Provisioning is explicit:

```bash
step-trustcenter provision
```

For the current pilot nonce validator path, pass the nonce secret at provision time instead of storing it in the installer:

```bash
step-trustcenter provision --nonce-secret "$STEP_NONCE_SECRET"
```

## Runtime files

Provisioning creates local user runtime state:

```text
~/.step/agent/node.env
~/Library/LaunchAgents/app.step.node-agent.plist
```

The node identity private key is stored in the macOS Keychain service `app.step.node`. It is not written to `node.env`.

## Commands

```bash
step-trustcenter provision [--nonce-secret VALUE] [--json]
step-trustcenter start
step-trustcenter stop
step-trustcenter restart
step-trustcenter status [--json]
step-trustcenter doctor [--json]
step-trustcenter logs [--tail 200]
step-trustcenter uninstall --yes [--delete-keychain]
```

## Wallet pairing

`step-trustcenter provision --json` emits a pairing payload with type `step.trustcenter.pair`. The mobile wallet signs that payload and submits it to the gateway. Pairing records wallet ownership and reward routing for the desktop node. Pairing does not grant validator voting weight.

## Recovery

To recover a failed node on the same Mac:

```bash
step-trustcenter restart
step-trustcenter doctor --json
```

To reprovision after a corrupted local runtime file while preserving identity:

```bash
rm -f ~/.step/agent/node.env ~/Library/LaunchAgents/app.step.node-agent.plist
step-trustcenter provision
```

To fully wipe local node identity:

```bash
step-trustcenter uninstall --yes --delete-keychain
```

After a full wipe, the node has a new identity and must be paired again.

## Auto-update and seeding

The installed node agent is responsible for release convergence after provisioning. It polls `ReleaseRegistry`, fetches release manifests and chunks from configured artifact peers, verifies every byte against on-chain commitments, and stages only contract-matching releases.

The default artifact source order is local first, then configured peers:

```text
http://127.0.0.1:{agent_port},<configured artifact peers>
```

That means a freshly installed Trust Center can become an update seed after it has a verified release staged locally. A peer can serve bytes, but it cannot authorize bytes.

## Full Trust Center package mode

The package builder supports `--survival-tier full` for a self-contained Trust Center payload that carries local chain RPC, gateway, fleet, validator, gossip, and agent launch payloads. A full package must pass `step-trustcenter doctor --json` and the destructive disaster-survival drill before it can be called production-ready.
