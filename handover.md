# STEP handover

## Current delivery state

- `origin/main` was updated to commit `f79fdc8`.
- GitHub CI for the latest checked PR branch passed across Rust, contracts, web, e2e, Swift, iOS app, schemas, and secrets.
- TestFlight/App Store Connect has STEP `0.1.0 (2)` uploaded and processed as `VALID`.
- `dictionary.md` was added to establish shared STEP terminology.
- M12 GitHub milestone and production-grade issue decomposition were created for symmetric Trust Centers and independent P2P operation.
- M13 GitHub milestone and project-board sequence now cover P2P auto-update and swarm distribution issues `#102` through `#113`.
- M13 implementation hardening added contract-bound release manifests, signed release manifest output, node-agent manifest/chunk/package verification, peer artifact seeding endpoints, peer announcement directory behavior, macOS package self-update documentation, and Mobile Trust Center launcher documentation.
- Node-agent update fetch is now peer-first and fail-closed: each source must serve a canonical manifest matching `ReleaseRegistry.manifestHash`, chunks matching `ReleaseRegistry.chunkRoot`, and an assembled package matching package/binary hashes before staging.
- Focused verification passed for `cargo test -p step-node-agent`, `node --test scripts/release/lib.test.mjs`, `forge test --root contracts --match-contract ReleaseRegistryTest`, and `pnpm --filter @step/fleet-api test`.
- Local `swift build` for `apps/ios/StepCore` was started after the MapLibre update and stopped because SwiftPM blocked on downloading the external MapLibre binary artifact without progress; the authoritative iOS build remains the GitHub `ios-app` workflow on `macos-15`, which runs XcodeGen and `xcodebuild` after the push.
- M12 execution has started with the identity blocker: `scripts/node/join.mjs` now stores node validator keys in the OS secret backend and writes public runtime node metadata only.
- Legacy keyed remote bundles are disabled by default; `scripts/node/bundle.mjs` and `scripts/node/bundle-agent.mjs` now require explicit `STEP_ALLOW_KEYED_BUNDLE=1` for local-dev migration.
- The local `.runtime/nodes/chappie.json` record was migrated so it no longer contains `privateKey`; the Chappie validator identity exists in macOS Keychain service `app.step.node`.
- Trust Center role manifest contract exists at `packages/schemas/step.trust-center.manifest.v1.json`, with symmetric Tribecca and Chappie examples under `config/` and validation through `pnpm trust-center:manifest:validate`.
- The P2P independence release verifier now checks key custody, keyless packaging, quorum terminology, Chappie keychain migration, and Trust Center manifest validity.
- `step-trustcenter provision` and the shell Trust Center installer now generate `trust-center.manifest.json` beside the node runtime, so each installed Trust Center has a local role/service/update/recovery contract.
- Fleet peer announcements now use signed `step.peer-record.v1` records with monotonic `sequence`, HTTPS-only public URLs, bounded TTL, and stale-record rejection.
- Trust Center pkg and shell installer now accept configurable `bootstrap-peers`, `relay-peers`, `advertise-peers`, and explicit `transport`; peer-native installs persist `GOSSIP_BOOTSTRAP`, `GOSSIP_RELAYS`, `GOSSIP_ADVERTISE`, and write `node.transport = peer` into the local manifest.
- Trust Center manifests now include `recovery.disaster_survival`; `tier = full` requires independent gateway, fleet, chain RPC, validator, and gossip services, and `pnpm release:disaster-survival:verify` performs the destructive Tribecca-down drill.
- Chappie now runs the full survival stack: chain RPC, gateway, fleet, gossip, node agent, its own validator, and redundant protocol validator replicas for validator-0/1/2. The destructive drill passes with Tribecca gateway/fleet/validators stopped.
- Alpha quorum defaults now enforce `2/3 + 1 quorum`: three 50-weight protocol validators require threshold `101`, not `100`.

## Shared terminology

The common project dictionary is now in `dictionary.md`.

Important correction:

`2/3 + 1 quorum` - The validator approval threshold where more than two-thirds of validator weight must approve before a claim can be finalized.

## Why M12 exists

Tribecca and Chappie are operationally equivalent Trust Centers at this stage.

Observed state:

- Tribecca currently runs the practical hub stack: chain, gateway, fleet, artifacts, node agents, validators, gossip, and watchdog.
- Chappie is a supervised Trust Center with the same survivor stack and quorum participation path; primary responsibility transfer is now an explicit, auditable handoff action.
- A real STEP P2P network must not depend permanently on one local machine, one LAN address, one local runtime file, or plaintext remote node keys.

Correct target:

- Tribecca is a Trust Center.
- Chappie is a Trust Center.
- Future Macs can become Trust Centers from the same package and runtime contract; any third system installed with peer transport must expose libp2p multiaddrs and can be counted in quorum the same way as Chappie.
- A system is not called disaster-proof unless the destructive survival drill passes with Tribecca gateway/fleet/validators stopped and a remote Trust Center still serving gateway, fleet, chain RPC, validator, and gossip.
- Current disaster drill result: Chappie survives Tribecca gateway/fleet/validator shutdown with remote active weight `200`, quorum threshold `101`, and remote fleet alerts `[]`.
- Roles such as bootstrap, relay, chain, gateway, indexer, validator, and artifact server are movable configuration, not hardcoded machine identity.

## GitHub artifacts created

Repository:

`moldovancsaba/step`

Canonical quality standard:

`https://github.com/sovereignsquad/general-design-system/issues/81`

Project board:

`https://github.com/users/moldovancsaba/projects/40`

Milestone:

`M12 — Symmetric Trust Centers & Independent P2P Operation`

Milestone number:

`12`

## M12 issue sequence

`1201` - `#90` - `Identity: Node key custody - remove plaintext remote keys`

`1202` - `#91` - `Trust Center Runtime: role manifest - symmetric service contract`

`1203` - `#92` - `Chappie Runtime: supervised Trust Center install - agent validator gossip health`

`1204` - `#93` - `Peer Directory: signed records - replace local nodes file authority`

`1205` - `#94` - `Bootstrap and Relay: replaceable peer seeds - no single hub dependency`

`1206` - `#95` - `Chain Participation: independent sync verification - Chappie as real chain peer`

`1207` - `#96` - `Quorum Governance: 2/3 + 1 active weight - enforce chain and gossip threshold`

`1208` - `#97` - `macOS Package: STEP Trust Center pkg - one-command install`

`1209` - `#98` - `Update and Recovery: signed release convergence - rollback watchdog and self-healing`

`1210` - `#99` - `Fleet Observability: Trust Center parity dashboard - GDS status and operator actions`

`1211` - `#100` - `Security Gate: production secret and localhost scanner - fail closed release policy`

`1212` - `#101` - `Release Gate: two-node independence proof - Tribecca down Chappie alive`

## Dependency map

`#90` - Entry point.

`#91` - Depends on `#90`.

`#92` - Depends on `#90`, `#91`.

`#93` - Depends on `#90`, `#91`.

`#94` - Depends on `#93`.

`#95` - Depends on `#92`, `#94`.

`#96` - Depends on `#95`.

`#97` - Depends on `#90`, `#91`, `#93`.

`#98` - Depends on `#97`.

`#99` - Depends on `#92`, `#93`, `#98`.

`#100` - Depends on `#90`, `#94`, `#97`, `#98`.

`#101` - Depends on `#92`, `#93`, `#94`, `#95`, `#96`, `#97`, `#98`, `#99`, `#100`.

## Labels created or used

Existing labels used:

- `P0`
- `P1`
- `security`
- `type:feature`
- `type:hardening`
- `type:operations`
- `type:release`
- `area:trust-center`
- `area:node-agent`
- `area:p2p`
- `area:transport`
- `area:ops`
- `area:fleet`
- `area:edge-gateway`
- `area:chain`
- `area:gateway`
- `area:indexer`
- `area:contracts`
- `area:frontend`
- `area:validator`
- `area:release-pipeline`
- `observability`
- `gds-required`
- `accessibility`
- `dependency:blocked-by`
- `dependency:blocks`

New labels added:

- `area:macos-installer`
- `area:identity`
- `area:recovery`

## Issue quality requirements embedded in M12

Every M12 issue includes, where relevant:

- executive summary
- business/product context
- current state
- problem statement
- functional goals
- technical goals
- UX/operator goals
- non-goals
- mandatory technical constraints
- architecture
- runtime flow
- data model/contracts
- API/CLI contracts
- pseudo-code
- mathematical logic where relevant
- UX/operator behavior
- accessibility requirements
- edge cases
- performance expectations
- security/privacy requirements
- binary acceptance criteria
- testing requirements
- documentation requirements
- handover requirements
- rollback/recovery expectations
- dependencies
- execution order

## Design system rule

All UI, UX, frontend, and operator dashboard work must exclusively use:

`https://github.com/sovereignsquad/general-design-system`

Accessibility is mandatory.

This applies directly to:

- `#99` Fleet Observability dashboard
- any future Trust Center pairing/status UI
- any web/mobile/admin/operator surface created under M12

## Project board status

The target board is:

`{step} - From IDEA to LIVE`

Board URL:

`https://github.com/users/moldovancsaba/projects/40`

Repository issue/milestone/label mutation succeeded.

M12 project board field mutation could not be completed in that run because GitHub GraphQL quota for the account was exhausted.

Observed quota:

- REST core remaining: available
- GraphQL remaining: exhausted
- GraphQL reset: `2026-06-26 09:36:38 CEST`

Reason this matters:

GitHub Projects v2 item insertion and field mutation require GraphQL. REST cannot fully mutate Projects v2 fields.

## M13 issue sequence

`1102` - `#102` - `P2P Update: release manifest contract for content-addressed Trust Center packages`

`1103` - `#103` - `P2P Update: release publisher creates signed pkg manifests and chunk indexes`

`1104` - `#104` - `P2P Update: node agent verified artifact seeding API`

`1105` - `#105` - `P2P Update: signed peer release announcements and seed directory`

`1106` - `#106` - `P2P Update: peer-first artifact resolver with contract verification`

`1107` - `#107` - `P2P Update: resumable chunk transfer for torrent-style seed/leech distribution`

`1108` - `#108` - `P2P Update: macOS Trust Center self-update, launchd restart, and rollback`

`1109` - `#109` - `P2P Update: wallet-paired Trust Center admission and validator weight request flow`

`1110` - `#110` - `P2P Update: iOS/iPadOS optional Trust Center launcher and seeding mode`

`1111` - `#111` - `P2P Update: swarm telemetry, alerts, and operator status model`

`1112` - `#112` - `P2P Update: destructive independence drill for Tribecca-offline update survival`

`1113` - `#113` - `P2P Update: production release gate for self-updating peer-native Trust Centers`

M13 project board fields were set to `Backlog (SOONER)`, phase `M6 Proof`, and order `1102..1113`. The board does not currently expose an `M13` phase option, so the closest existing phase field remains `M6 Proof` while the milestone carries the actual M13 identity.

Required board mutation after reset:

- Add issues `#90` through `#101` to project `40`.
- Set status:
  - `#90` = `Todo`
  - `#91` through `#101` = `Backlog`
- Set sequence/order field if available:
  - `#90` = `1201`
  - `#91` = `1202`
  - `#92` = `1203`
  - `#93` = `1204`
  - `#94` = `1205`
  - `#95` = `1206`
  - `#96` = `1207`
  - `#97` = `1208`
  - `#98` = `1209`
  - `#99` = `1210`
  - `#100` = `1211`
  - `#101` = `1212`
- Set dependency/sequencing notes according to the dependency map above if the board has a dependency field.

## Commands already run

Push to main:

```bash
git push origin HEAD:main
```

GitHub CI status check:

```bash
gh pr checks 23 --repo moldovancsaba/step --json name,state,bucket,link,workflow,startedAt,completedAt
```

TestFlight/App Store Connect build status:

```bash
xcrun altool --generate-jwt ...
curl https://api.appstoreconnect.apple.com/v1/builds...
```

M12 labels and issues:

```bash
gh api repos/moldovancsaba/step/labels ...
gh api repos/moldovancsaba/step/milestones ...
gh api repos/moldovancsaba/step/issues ...
```

## TestFlight status

App:

`STEP — Proof of Presence`

Bundle:

`com.regiominer.miner`

Current build:

`0.1.0 (2)`

Processing state:

`VALID`

Uploaded:

`2026-06-25T10:19:20-07:00`

Expired:

`false`

Minimum iOS:

`17.0`

Known TestFlight group:

`Friendly Pilot`

Public TestFlight link:

Disabled.

Limitation:

The current App Store Connect API key can read app/build status, but returned `403` when checking whether build `2` is attached to the beta group. Confirm group attachment in App Store Connect UI or use a higher-permission API key.

## Immediate next execution order

1. Finish `#90` by adding CI/release assertions that production runtime node files cannot contain plaintext `privateKey` and by updating any remaining docs that describe keyed remote bundles as normal operation.
2. Execute `#92` to make Chappie a real supervised Trust Center.
3. Execute `#95` to make independent chain participation/reconciliation real.
4. Execute `#97`, `#98`, and `#100` to package, update, recover, and block unsafe production releases.
5. Execute `#99` for GDS-only operator visibility.
6. Execute `#101` as the final two-node independence release proof.

## Operational acceptance target

The system is acceptable only when:

- Tribecca can go down and Chappie remains a healthy Trust Center where quorum/roles permit.
- Chappie can go down and Tribecca remains healthy.
- A fresh Mac can install `STEP Trust Center.pkg` and join as a candidate.
- No production runtime contains plaintext node private keys.
- No production peer relies on localhost or LAN-only identity as network authority.
- Peer records are signed, verified, cached, and expired.
- Updates are signed and rollback-safe.
- Recovery works after crash or failed update.
- Quorum is consistently `2/3 + 1`.
- UI/operator surfaces are GDS-only and accessible.
- Release gates fail closed on fake data, sandbox fallback, unsafe secrets, or hub-only assumptions.

## 2026-06-26 system identity proof update

Implemented proof gates for the current delivery request:

- `pnpm release:system-identity:verify` proves the installer contract, full Trust Center manifest parity, iOS mobile peer/client capability, and live fleet quorum on Tribecca and Chappie.
- `scripts/release/build-macos-pkg.mjs` now refuses `--survival-tier full` unless `--fullstack-dir` exists and contains `node`, `gateway-api.mjs`, `fleet-api.mjs`, `chain-rpc.mjs`, `validator-node`, and `gossip-node`.
- The generated `step-trustcenter provision` command writes a full-role manifest and installs launchd services for `app.step.chain`, `app.step.gateway`, `app.step.fleet`, `app.step.gossip`, `app.step.validator`, and `app.step.node-agent`.
- `scripts/node/install.sh` now has the same fail-closed contract through `--fullstack-artifact` and `--fullstack-sha256`.
- `docs/operations/STEP_system_identity_proof.md` is the canonical proof contract.
- `apps/ios/README.md` now states the iOS app role precisely: mobile peer/client, not an always-on full Trust Center.
- New operator handoff path added: `scripts/ops/main-system-handoff.mjs` with script entry
  `pnpm release:main-system-handoff` for explicit source/target transfer across nodes.

Verification results recorded from this machine:

```bash
pnpm release:system-identity:verify
# passed: local fleet active=200 threshold=101 nodes=4
# passed: chappie fleet active=200 threshold=101 nodes=4

pnpm release:disaster-survival:verify
# passed: Chappie agent/gateway/fleet/chain_rpc/validator/gossip survived while Tribecca gateway/fleet/validators were stopped

pnpm release:p2p-independence:verify
# passed: peer-native/keychain/runtime-manifest/quorum invariants

pnpm release:live-federation:verify
# passed: local gateway healthy, fleet active=200 threshold=101, chappie peer-native and in quorum

cd apps/ios/StepCore && swift build
# passed: StepCore builds successfully

node --check scripts/release/build-macos-pkg.mjs
sh -n scripts/node/install.sh
node --check scripts/ops/verify-system-identity.mjs
# passed: release script syntax
```

Remaining truth boundary:

- The iOS app is fully updated for its mobile peer/client responsibilities: wallet, proof signing, attestation path, Trust Center pairing, mesh/map, NFT, and marketplace client surfaces.
- The iOS app is intentionally not treated as a full Trust Center because iOS cannot honestly guarantee always-on chain/gateway/fleet/validator/gossip services while backgrounded or terminated.
- A full macOS install now requires a verified fullstack payload. A package without that payload cannot claim `survival-tier full`.
- **Handoff acceptance evidence:** a deterministic handoff can be executed with

```bash
pnpm release:main-system-handoff --source-name tribecca --target-name chappie --platform darwin-arm64 --version <version>
```

Use `--dry-run` to validate intent and `--promote` when moving the platform default.
The script writes post-action evidence to `.runtime/handoff/*.json` for audit/rollback checks.

## 2026-06-26 iOS Mobile Trust Center launcher update

The iOS app now has a choosable launcher after wallet/login:

- `Mine & explore`: normal mobile peer/miner mode.
- `Mobile Trust Center`: foreground iPhone/iPad trust-device mode for users who keep a device powered, awake, connected, and running STEP continuously.

The Mobile Trust Center mode is designed for future protocol enrollment, vote signing, uptime/participation accounting, and trust-center rewards that do not require the owner to visit new triangles. It is a real trust-center class, but it is not the same class as a full macOS/Linux Trust Center because iOS cannot guarantee boot-daemon startup, unattended executable self-update, public chain/gateway/fleet servers, or launchd-style crash restart after background/termination/reboot.

Canonical role names:

- `mobile_peer`: normal miner/user app.
- `mobile_trust_center`: iPhone/iPad kept running as an attested mobile trust device.
- `full_trust_center`: macOS/Linux infrastructure node running agent, validator, gossip, chain RPC, gateway, and fleet continuously.

## 2026-06-26 TestFlight and Mobile Trust Center delivery update

- iOS build `0.1.0 (3)` was generated from the Mobile Trust Center launcher implementation.
- Archive path: `apps/ios/App/build/StepApp-0.1.0-3.xcarchive`.
- Export path: `apps/ios/App/build/export-0.1.0-3/StepApp.ipa`.
- App Store Connect upload succeeded with delivery/build id `341038d6-3b1b-4174-b8e6-4e7b427cbe87`.
- App Store Connect processing state for build `3` is `VALID`.
- Build `3` is attached to TestFlight group `Friendly Pilot` (`7f2f4147-1cd1-404b-8d3c-5af2bab17e80`).
- Tester `moldovancsaba@gmail.com` remains attached to `Friendly Pilot`.
- External TestFlight review submission for build `3` is blocked by Apple with `ENTITY_UNPROCESSABLE.ANOTHER_BUILD_IN_REVIEW` because another build in the same train is already in Beta App Review. Submit build `3` again after the existing review completes.

## M13 — P2P Auto-Update & Swarm Distribution delivery update

Repository artifacts were created for M13 on GitHub:

- Project board: `https://github.com/users/moldovancsaba/projects/55`
- Milestone: `M13 — P2P Auto-Update & Swarm Distribution`
- Issues: `#102` through `#113`

Implementation state in this handover update:

- `ReleaseRegistry` now authorizes full package-level metadata: binary hash, params hash, config hash, package hash, manifest hash, chunk root, package size, and minimum agent version.
- The release publisher now creates a canonical `step.release-manifest.v1` manifest, deterministic chunk index, package hash, manifest hash, and chunk root before publishing release metadata on-chain.
- The node-agent artifact API now exposes `/artifacts/status`, `/artifacts/{platform}/{version}/package`, `/artifacts/{platform}/{version}/manifest.json`, and `/artifacts/{platform}/{version}/chunks-{index}` while keeping the original `/artifacts/{platform}/{version}` package endpoint.
- The hub artifact server exposes the same package/manifest/chunk-compatible endpoint shape as peer node agents.
- `scripts/ops/verify-p2p-update-swarm.mjs` was added as the release-gate verifier for peer update readiness across Tribecca, Chappie, and future Trust Centers.
- `docs/p2p-auto-update.md` documents the operational model, release contract, artifact API, publisher command, installer behavior, and definition of done.

New verification command:

```bash
pnpm release:p2p-update-swarm:verify -- --peers http://tribecca.local:9200,http://chappie.local:9200
```

Release principle:

Any byte source is allowed. Only on-chain release metadata plus manifest/hash verification is trusted.

## M13 local deployment evidence — 2026-06-26

Built installer:

```text
.runtime/dist/STEP-TrustCenter-1.0.15-darwin-arm64.pkg
sha256 5f9ce39e9bf4490c23c518066a68812b4ec10882e2a37ac2bd8ad86bd87d5af9
```

Validation completed in this delivery pass:

```text
forge test -vvv: 95 passed, 0 failed
cargo test -p step-node-agent: 33 passed, 0 failed
cargo build -p step-node-agent --release: passed
node --check scripts/release/publish.mjs: passed
node --check scripts/release/serve-artifacts.mjs: passed
node --check scripts/ops/verify-p2p-update-swarm.mjs: passed
```

Installer deployment completed:

- Tribecca installed `STEP-TrustCenter-1.0.15-darwin-arm64.pkg` successfully.
- Tribecca provisioned with `step-trustcenter provision`.
- Tribecca `step-trustcenter status --json` reports launch agent loaded, agent health up, validator health up.
- Chappie received the same package over SSH and upgraded successfully.
- Chappie provisioned with `/usr/local/bin/step-trustcenter provision`.
- Chappie `step-trustcenter status --json` reports launch agent loaded and agent health up.

P2P update swarm evidence:

```bash
pnpm release:p2p-update-swarm:verify -- --platform darwin-arm64 --version 1.0.15 --peers http://tribecca.local:9200,http://chappie.local:9200
```

Result:

```text
ok true
healthyPeers 2
totalPeers 2
tribecca.local: package true, manifest true, chunks 3
chappie.local: package true, manifest true, chunks 3
packageHashHeader 0xde94e566eee0f588531b8b16dca21a8f5dd8c41c291c5a47cd38cd75f99cf100
```

Operational note:

- Chappie is upgraded and now has the same on-chain transfer mechanism as Tribecca for moving operational responsibility.
- A main-system transfer is no longer implicit; it is now explicit and auditable through `scripts/ops/main-system-handoff.mjs`.
- Evidence artifacts in `.runtime/handoff` include both preflight pins and rollback commands for any transfer.

## 2026-06-27 MapLibre and gap elimination execution plan

Status snapshot:

- `MapView.swift` is compiled as `MapLibre` on iOS and no longer advertises a placeholder map implementation in the normal app path.
- The only fallback is a non-interactive `ContentUnavailableView` for non-MapLibre/iOS build contexts, which is expected for macOS/CI toolchain paths.
- Remaining blockers are not map rendering itself; they are operational parity and shipping hardening.

Next implementation sequence (from highest risk to lowest risk):

### 1) Map tab hardening (release-critical)

- **Architecture**: iOS map tab remains single source of truth; no simulator-only or placeholder code path in production iOS.
- **Runtime flow**: `MapView` -> `MeshMap` -> `MGLMapView` style/events -> `MeshCoverClient.overlay` -> polygon overlay source/layers.
- **Contracts / APIs**:
  - `MeshCoverClient.overlay(minLat/minLon/maxLat/maxLon/level)` unchanged.
  - Use style endpoints as configurable runtime values (app config or env), defaulting to MapLibre demo style only when explicit flag indicates public sandbox mode.
- **Pseudo-code**:

```swift
if os(iOS) && canImport(MapLibre) {
  render MGLMapView with overlay source redraw on every triangle batch
  emit viewport on region change and load
  debounce requests to avoid request storms
} else {
  show non-interactive unavailable view (non-prod surfaces only)
}
```

- **UX/accessibility**:
  - Keep VoiceOver labels for loading/truncation/retry states.
  - Keep legend state entirely text + semantic colors.
- **Retries/timeouts**:
  - Keep 300ms debounce and cancel stale requests.
  - Add retry budget for `MeshCoverClient` fetch failures (1 retry at 1.2s, then user retry).
- **Rollback/recovery**: if fetch repeatedly fails, hold stale overlay until TTL expiry and keep clear retry path.
- **Testing**:
  - Unit viewport/truncation tests.
  - UI tests for map availability/error states.
  - Device field smoke for pan/zoom + retry.
- **Acceptance**: no production iOS placeholder map text remains.

### 2) Mobile UX accessibility gate across all iOS screens

- **Architecture/runtime**: one accessibility policy in `StepAppUI`.
- **Plan**:
  - Add tests for dynamic type and VoiceOver for Map/Wallet/Launcher/Trust-Center.
  - Keep reduced-motion-safe map controls and explicit focus order.
- **Rollback**: if gate fails, no TestFlight upload.
- **Acceptance**: accessibility report + manual review for screen-reader critical journeys.

### 3) App Attest end-to-end verification unblock

- **Architecture**: client evidence remains stable; backend verifier accepts/rejects against Apple cert chain and nonce binding.
- **Flow**: claim → claim hash + attestation bundle → backend verification service → validator policy.
- **Contracts/APIs**: keep existing attestation wire format; add explicit attestation failure reason mapping.
- **Execution order**: backend verifier first, then validator policy migration.
- **Rollback**: preserve existing `devUnattested` for unsupported environments.
- **Acceptance**: device attested claims are accepted when policy is enabled.

### 4) Trust-center parity hardening (Tribecca = Chappie = new peers)

- **Architecture**: role manifests + peer records + release manifest are authoritative; no local-machine-only assumptions.
- **Current hardening status**: mostly complete via M12.
- **Remaining**:
  - harden bootstrap/reachability for 3+ offline-safe peers;
  - enforce package manifest constraints during initial enrollment.
- **Dependencies**: no single LAN dependency; bootstrap peers are HTTPS-capable first.
- **Acceptance**: destructive survival drill passes with other hub path down.

### 5) P2P update and rollout convergence

- **Architecture**: release registry + chunk manifest pipeline from M13.
- **Remaining**:
  - signature trust bundle check at install/upgrade;
  - health + manifest freshness policy for `release:p2p-update-swarm:verify`;
  - mobile trust-center path uses same signed update announcements.
- **Operational behavior**: disconnected nodes preserve service and auto-sync on reconnect.
- **Acceptance**: peer-to-peer rollout works from any newer node.

### 6) TestFlight and external release discipline

- **Current risk**: external review queue can block sequential uploads.
- **Action**: keep one active review-ready build, publish updates only after release queue clear; bundle release notes with evidence list.
- **Acceptance**: upload/review states are deterministic with rollback-ready prior version.

Execution order:

1. Complete item 1.
2. Complete item 2.
3. Complete item 3.
4. Complete item 4.
5. Complete item 5.
6. Complete item 6.

This is the concrete, non-placeholder path to remove the remaining delivery gaps.
