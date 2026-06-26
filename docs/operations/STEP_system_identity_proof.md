# STEP system identity proof

This document defines the release proof for three claims:

1. Any full Trust Center system has the same baseline task capability.
2. The macOS installer installs that full baseline only when the full runtime is
   present and hash-verified.
3. The iOS app carries both mobile roles fully: normal mobile peer/miner and
   foreground Mobile Trust Center.

## Full Trust Center baseline

A full Trust Center must run these roles locally:

- `agent`: supervises the node, reports health, handles self-update and rollback.
- `validator`: validates proof-of-location claims and signs validator votes.
- `gossip`: exchanges claims/votes with peers without a central gateway.
- `chain`: exposes an independent chain RPC path.
- `gateway`: accepts claims and finalises quorum bundles.
- `fleet`: exposes the live fleet/quorum view.

The matching services are `agent`, `validator`, `gossip`, `chain_rpc`,
`gateway`, and `fleet`. A manifest with `recovery.disaster_survival.tier = full`
is invalid unless all are enabled.

## macOS installer proof

The macOS package builder refuses `--survival-tier full` unless
`--fullstack-dir` exists and contains:

- `node`
- `gateway-api.mjs`
- `fleet-api.mjs`
- `chain-rpc.mjs`
- `validator-node`
- `gossip-node`

The shell installer has the equivalent remote form:

```bash
scripts/node/install.sh \
  --survival-tier full \
  --fullstack-artifact <fullstack.tgz> \
  --fullstack-sha256 <sha256> \
  ...
```

The installer verifies the fullstack archive before extraction, writes a
full-role `trust-center.manifest.json`, and installs separate launchd services
for chain, gateway, fleet, gossip, validator, and agent.

## iOS proof

The iOS app exposes a choosable launcher with two modes:

- `mobile_peer`: mine/explore/wallet mode.
- `mobile_trust_center`: foreground iPhone/iPad trust-device mode.

It proves:

- self-custody wallet creation and signing;
- key backup export/import;
- signed proof-of-location claims;
- current mineable triangle resolution through the v2 level walk;
- App Attest-backed evidence on device, with honest unattested fallback on
  simulator/unsupported platforms;
- trusted-anchor capture for BLE/NFC/QR;
- Trust Center pairing payload signing;
- mesh/map, NFT, and marketplace client surfaces.
- a Mobile Trust Center launcher and operating surface that tells the user to
  keep the device powered, awake, connected, and running STEP;
- future reward positioning that is separate from location mining and does not
  require the owner to visit new triangles.

The iOS app is not a full Trust Center class because iOS cannot provide a
reliable unattended chain RPC, gateway, fleet API, validator daemon, and gossip
daemon after the app is backgrounded, terminated, or the device reboots.

## Release gate

Run:

```bash
pnpm release:system-identity:verify
```

The gate fails if:

- full installer paths do not require verified fullstack payloads;
- package/shell installers do not install the full launchd service set;
- full Trust Center manifests do not share the baseline capability profile;
- live fleet endpoints are unreachable, below quorum, or alerting;
- the iOS app is missing wallet, proof, attestation, pairing, endpoint,
  launcher, Mobile Trust Center, or permission surfaces;
- documentation fails to distinguish `mobile_trust_center` from
  `full_trust_center`.
