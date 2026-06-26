# STEP handover

## Current delivery state

- `origin/main` was updated to commit `f79fdc8`.
- GitHub CI for the latest checked PR branch passed across Rust, contracts, web, e2e, Swift, iOS app, schemas, and secrets.
- TestFlight/App Store Connect has STEP `0.1.0 (2)` uploaded and processed as `VALID`.
- `dictionary.md` was added to establish shared STEP terminology.
- M12 GitHub milestone and production-grade issue decomposition were created for symmetric Trust Centers and independent P2P operation.
- M12 execution has started with the identity blocker: `scripts/node/join.mjs` now stores node validator keys in the OS secret backend and writes public runtime node metadata only.
- Legacy keyed remote bundles are disabled by default; `scripts/node/bundle.mjs` and `scripts/node/bundle-agent.mjs` now require explicit `STEP_ALLOW_KEYED_BUNDLE=1` for local-dev migration.
- The local `.runtime/nodes/chappie.json` record was migrated so it no longer contains `privateKey`; the Chappie validator identity exists in macOS Keychain service `app.step.node`.
- Trust Center role manifest contract exists at `packages/schemas/step.trust-center.manifest.v1.json`, with symmetric Tribecca and Chappie examples under `config/` and validation through `pnpm trust-center:manifest:validate`.
- The P2P independence release verifier now checks key custody, keyless packaging, quorum terminology, Chappie keychain migration, and Trust Center manifest validity.
- `step-trustcenter provision` and the shell Trust Center installer now generate `trust-center.manifest.json` beside the node runtime, so each installed Trust Center has a local role/service/update/recovery contract.
- Fleet peer announcements now use signed `step.peer-record.v1` records with monotonic `sequence`, HTTPS-only public URLs, bounded TTL, and stale-record rejection.
- Trust Center pkg and shell installer now accept configurable `bootstrap-peers`, `relay-peers`, and `advertise-peers`, persist them as `GOSSIP_BOOTSTRAP` and `GOSSIP_RELAYS`, and write them into the local manifest.
- Alpha quorum defaults now enforce `2/3 + 1 quorum`: three 50-weight protocol validators require threshold `101`, not `100`.

## Shared terminology

The common project dictionary is now in `dictionary.md`.

Important correction:

`2/3 + 1 quorum` - The validator approval threshold where more than two-thirds of validator weight must approve before a claim can be finalized.

## Why M12 exists

Tribecca and Chappie are not currently equivalent Trust Centers.

Observed state:

- Tribecca currently runs the practical hub stack: chain, gateway, fleet, artifacts, node agents, validators, gossip, and watchdog.
- Chappie is represented as a registered peer/runtime artifact, but it is not yet proven to be an independently supervised Trust Center.
- A real STEP P2P network must not depend permanently on one local machine, one LAN address, one local runtime file, or plaintext remote node keys.

Correct target:

- Tribecca is a Trust Center.
- Chappie is a Trust Center.
- Future Macs can become Trust Centers from the same package and runtime contract.
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

Project board field mutation could not be completed in this run because GitHub GraphQL quota for the account was exhausted.

Observed quota:

- REST core remaining: available
- GraphQL remaining: exhausted
- GraphQL reset: `2026-06-26 09:36:38 CEST`

Reason this matters:

GitHub Projects v2 item insertion and field mutation require GraphQL. REST cannot fully mutate Projects v2 fields.

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
