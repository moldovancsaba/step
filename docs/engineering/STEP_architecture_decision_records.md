# STEP Architecture Decision Records

**Version:** 0.1
**Date:** 2026-06-11
**Status:** Living ADR log. Statuses: `ACCEPTED` (adopted now), `ACCEPTED-ALPHA` (adopted for alpha, revisit before MVP/production), `PROPOSED` (default chosen, awaiting confirmation), `OPEN` (no safe default — blocked on owner decision).

Each ADR cites the controlling source documents:
**SYS** = STEP_complete_system_documentation.md, **DEV** = STEP_development_documentation_open_source_apple_first.md, **HARD** = STEP_hardening_system_documentation.md.

---

## ADR-001: Monorepo layout

**Status:** ACCEPTED
**Context:** The master delivery prompt §4.1, DEV §4, and HARD §16.1 each give a slightly different monorepo layout. They agree on monorepo-with-strict-boundaries; they differ in directory names (`apps/ios` vs `apps/ios-miner` vs `apps/mobile-app`; `packages/mesh-engine` vs `crates/mesh-core`).
**Decision:** Use the master prompt §4.1 layout as the contract (it is the delivery instruction), merged with DEV §4's necessary additions:

```text
step/
  apps/
    ios/                  # native Swift miner app (DEV "ios-miner")
    web/                  # public explorer (DEV "web-explorer")
    merchant-dashboard/
    protocol-admin/       # DEV "admin-console"
  packages/
    mesh-engine/          # canonical Rust crate (DEV "crates/mesh-core") + WASM + Swift bindings
    proof-protocol/       # claim/evidence schemas + signing logic (DEV "proof-core"/"proof-sdk")
    shared-types/         # generated TS/Swift/Rust types from schemas + ABIs
    wallet-core/
    api-client/           # typed client generated from OpenAPI
    validation-rules/     # deterministic validation checks shared by gateway and validator
  contracts/
    src/  test/  script/  deployments/
  services/
    validator-node/       # Rust
    indexer/
    proof-storage/        # IPFS pinning + encryption service (DEV "proof-bundler")
    exchange-service/     # closed campaign-credit accounting only in alpha
    gateway-api/          # claim intake + nonce challenge (alpha; DEV §6.1)
    merchant-api/
    campaign-worker/      # expiry/refund background jobs
  docs/
    product/ architecture/ engineering/ tokenomics/ geography/ protocol/
    smart-contracts/ merchant/ privacy/ legal-risk/ operations/ testing/
  infra/
    docker/ localnet/ deployment/
  scripts/
  tests/                  # e2e, simulations, field-tests
```

Deviations from the literal master-prompt tree, with reasons (documented as required by master prompt §4.1):
- Added `services/gateway-api`, `services/merchant-api`, `services/campaign-worker` — required by DEV §4/§6.1 alpha architecture (nonce challenge, merchant CRUD, campaign expiry). Without them the documented flows cannot run.
- `packages/mesh-engine` is a Rust crate (with generated bindings) rather than a TS package — required by DEV §7.2 (canonical Rust, exported via FFI/WASM).
- Added `docs/geography`, `docs/protocol`, `docs/smart-contracts`, `docs/testing` to hold the master-prompt §4.2 document list.
**Consequences:** Strict package boundaries; shared types and golden test vectors are the cross-language contract; CI builds each package independently.

---

## ADR-002: MESH v1 specification freeze (alpha)

**Status:** PROPOSED (defaults chosen; freeze required at M1 start)
**Context:** DEV §7.4 and HARD §5.8 require deciding icosahedron orientation, edge definition, ID encoding, precision/tolerance, antimeridian/pole handling. SYS §7.2 recommends a spherical Earth model for alpha.
**Decision (alpha defaults):**
1. **Earth model:** unit sphere; WGS84 lat/lon input converted to 3D unit vectors (HARD §5.8 recommendation). Authalic radius 6371.0088 km used only for area/length display.
2. **Orientation:** standard icosahedron orientation with one vertex at the geographic North Pole and a documented fixed rotation about the polar axis (exact rotation constant fixed in the mesh spec at implementation time and committed with golden vectors). Vertex-at-pole makes polar behaviour explicit and testable (DEV §7.3 pole tests).
3. **Edges:** great-circle arcs (SYS §6.7, HARD §5.8).
4. **Subdivision:** 4-way midpoint subdivision; midpoints normalised to the sphere; children numbered **1–4** in the public ID (internal 0–3). A triangle subdivides into these 4 quarters when its 27 mining slots are exhausted (the breakdown lifecycle).
5. **ID encoding (Mesh ID v2 — supersedes the old `STEP-{level}-F{face}-{base4path}` form):** a dotted, **1-indexed** path `<face 1..20>(.<child 1..4>)*`; the **level is the segment count**; a mined slot/NFT appends the slot `1..27` as the final segment (`<triangleId>.<slot>`). On-chain key is `keccak256(utf8(triangle_id_string))`. Canonical spec: `docs/geography/STEP_mesh_id_v2.md`.
6. **Containment:** sign tests against the three oriented great-circle edge planes; point exactly on an edge plane (within tolerance 1e-12 on the unit sphere) resolves by deterministic tie-break: lowest triangle ID wins (HARD §5.7 recommended rule).
7. **Antimeridian/poles:** handled naturally by 3D vector math — no lat/lon arithmetic in containment; explicit golden tests at ±180° and both poles.
**Consequences:** Spherical-by-design distortion documented (SYS §7.2). The v1 spec is versioned in `MeshRegistry`; a v2 may supersede it before mainnet without breaking alpha data (mesh version is part of on-chain state).
**Open residual:** exact rotation constant and bytes32 packing — fixed in `docs/geography/STEP_mesh_mathematics.md` at M1.1, then immutable for alpha.

---

## ADR-003: Mineable levels (alpha)

**Status:** ACCEPTED-ALPHA (protocol parameter, not a frozen constant)
**Context:** SYS §6.4 open decision; HARD §5.6 recommends parent levels as metadata only, with one or few issuance levels.
**Decision:** The mesh is enabled for every configured depth in scope (default **1–25**) as potential geometry. A child triangle becomes mineable only if all ancestors along its path are exhausted; mineability is therefore location and state-specific, not a global whitelist. The mineable-level set is still parameterised in `MeshRegistry` and currently defaulted to open over all available depths for this pilot.
**Consequences:** Supply and operational hardening is controlled by triangle state transitions (exhaustion + child-unlock) and by geometry state, not by a fixed global level gate.

---

## ADR-004: Canonical MESH implementation in Rust, bound everywhere

**Status:** ACCEPTED
**Context:** DEV §7.2 mandates Rust `mesh-core` exported to iOS (UniFFI/C FFI), web (WASM), validator (native). DEV §4.1 requires deterministic results across Rust/Swift/TypeScript.
**Decision:** One Rust implementation; UniFFI for the Swift XCFramework; `wasm-pack` for web; shared golden-test-vector file consumed by all three test suites in CI. No reimplementation in Swift or TypeScript.
**Consequences:** iOS build pipeline includes an XCFramework build step; web bundles WASM. Determinism is enforced structurally, not by parallel-implementation discipline.

---

## ADR-005: Alpha networking topology — gateway-mediated, libp2p-ready

**Status:** ACCEPTED-ALPHA
**Context:** SYS §12.1 prescribes progressive decentralisation ("Alpha: controlled services + testnet contracts"). DEV §6.1 says iOS networking is "URLSession for HTTP; libp2p integration via Rust FFI or gateway in alpha". DEV §9.5 limits alpha to foundation-operated validators.
**Decision:** In alpha, the iOS app talks HTTPS to `gateway-api` (claim intake, nonce challenge, status). The gateway fans claims out to validator nodes. Validator nodes carry a rust-libp2p gossip layer behind a feature flag, exercised in integration tests, so the MVP/V1 move to true P2P propagation is a topology change, not a rewrite. Claim and vote message formats are identical in both transports.
**Consequences:** Honest about alpha centralisation (it is documented and intended by SYS §12.1); no fake P2P claims in docs or marketing; the P2P path stays continuously tested.
**Update (M9):** the libp2p gossip transport is now delivered as `services/gossip-node` — see **ADR-019**.

---

## ADR-006: Chain environment for alpha

**Status:** ACCEPTED-ALPHA
**Context:** SYS §13.1 and DEV §10.5–10.6: EVM testnet first, never a new L1 for alpha. Public-testnet choice has cost/ops implications.
**Decision:** Development on **Anvil** (local). Alpha pilot on a **foundation-operated internal EVM testnet** (single geth/reth or OP-stack devnet in `infra/localnet`), because the pilot needs free, fast, controllable finality and no public-testnet faucet friction for 100–500 users. Public EVM testnet deployment happens at MVP. Production chain selection (L2/appchain/rollup) is explicitly deferred (SYS §13.1) — **OPEN** decision recorded for post-alpha.
**Consequences:** Pilot Trinity is unambiguously valueless testnet Trinity (supports LEG-004 compliance posture). Chain ID and addresses are config, never code (ENG-001).

---

## ADR-007: Collector slots and reward curve (alpha parameters)

**Status:** ACCEPTED-ALPHA (parameterised defaults; real values blocked on tokenomics constitution)
**Context:** SYS §8.5: the legacy 28-slot halving model can violate the ≥1-Trinity rule; "define Trinity first, then slots and curve." HARD §4.3: any formula producing <1 Trinity is invalid.
**Decision:**
- `TriangleMiningState` takes `totalSlots` and a reward-curve definition as constructor/registry parameters.
- Alpha defaults: **27 slots**, geometric halving from a per-triangle base reward, with the contract enforcing `reward >= 1 Trinity` as a hard invariant (mint reverts otherwise). 27 is chosen because with 1 STEP = 67,108,864 Trinity and halving, slot 27 of a base reward 67,108,864 Trinity (= 2^26) yields exactly 1 Trinity — an internally consistent default that demonstrates the invariant. These numbers are demonstration defaults, **not** tokenomics commitments.
- The parameter registry and all dashboards label these values `UNFROZEN — pending tokenomics constitution`.
**Consequences:** Contracts and tests are real and complete; economics remain honest about being undecided (master prompt §6.3).

---

## ADR-008: Foundation twin allocation (alpha parameter)

**Status:** ACCEPTED-ALPHA
**Context:** SYS §9.4 confirms the twin mechanism but leaves the schedule open; HARD §4.7 recommends bootstrap-high → declining → capped, and requires twin inclusion in supply maths from day one.
**Decision:** `FoundationTreasury` implements a **configurable basis-points twin rate with an optional cap**, settable only via `AccessController` (time-locked). Alpha default: **10000 bps (100%, the documented bootstrap phase rate)**, no cap, on testnet only. Every twin mint emits `FoundationTwinAllocated` and is shown on the public treasury dashboard. The permanent schedule is **OPEN**, owned by the tokenomics constitution.
**Consequences:** Mechanism proven in alpha; dilution-perception risk (HARD §20.1) addressed by transparency, not by silently picking a rate.

---

## ADR-009: Validator node language and storage

**Status:** ACCEPTED
**Context:** Master prompt §5.4 allows Rust/Go/TypeScript with documented reasoning; DEV §3.1/§9.1 recommend Rust.
**Decision:** **Rust.** Reasons: (a) the canonical mesh-engine is Rust — in-process containment checks with zero FFI; (b) rust-libp2p is the reference-quality libp2p implementation; (c) memory safety and determinism matter for a signing node; (d) one systems language across mesh-engine, proof-core, and validator reduces cross-language drift. Storage: **PostgreSQL** in alpha (already in the stack, easier ops/debugging than RocksDB for a handful of foundation nodes); RocksDB reconsidered for high-throughput open validators post-alpha (DEV §9.1 allows either by role).
**Consequences:** Slower initial velocity than TypeScript accepted in exchange for correctness and reuse.

---

## ADR-010: Indexer — custom, not The Graph (alpha)

**Status:** ACCEPTED-ALPHA
**Context:** DEV §14.1: "The Graph or custom indexer — custom gives more control and easier alpha." The alpha chain is a private internal testnet (ADR-006) where hosted Graph services don't reach.
**Decision:** Custom TypeScript indexer (`services/indexer`) reading contract events via viem, writing to PostgreSQL, with materialised views for dashboards. Event handling is organised per-contract so a later migration to The Graph subgraphs (or self-hosted graph-node) maps one-to-one.
**Consequences:** Full control of pilot analytics; revisit at MVP when on a public testnet.

---

## ADR-011: Alpha exchange path — closed campaign credits, no market

**Status:** ACCEPTED
**Context:** SYS §14.2, HARD §8.3, DEV §12.1 all mandate: alpha has **no** exchange. HARD §8.4 requires a declared reference price for campaign accounting. EXC-002 marks the exchange as the highest regulatory risk.
**Decision:** `services/exchange-service` in alpha implements only **closed campaign-credit accounting**: foundation grants pilot merchants campaign credits (off-market), credits convert to locked testnet Trinity in `RewardPool` at a fixed **reference price** stored in config and displayed everywhere with the HARD §8.4 disclaimer ("reference price for pilot campaign accounting, not a promise of market value"). No buy/sell between users. No fiat. The `Exchange` contract is specified (docs) but not deployed. Phase 2 (KYC-gated internal marketplace) and phase 3 (regulated exchange) are **BLOCKED on legal review** (LEG-002) by design.
**Consequences:** Pilot merchants never touch crypto purchase flows (supports MER-009, HARD §18.3); zero CASP surface in alpha.

---

## ADR-012: Wallet model for alpha

**Status:** ACCEPTED-ALPHA
**Context:** SYS §26.3 leaves custody model open (legal). The alpha runs on a valueless internal testnet (ADR-006), which removes custody-regulation exposure for the pilot itself.
**Decision:** **Self-custodial embedded wallet** in the iOS app: secp256k1 key generated on device, stored in Keychain (Secure Enclave-backed where the curve/usage allows; the EVM secp256k1 key itself is Keychain-protected with biometry, since Secure Enclave does not host secp256k1), with export and import. Merchants get **managed accounts** operated by the foundation (MER-009). Production custody model remains **OPEN — legal review required** (HARD §12.3).
**Consequences:** Simple pilot UX; honest documentation that Secure Enclave cannot hold the EVM signing key directly — this constraint is recorded in the privacy/security docs rather than over-claimed.

---

## ADR-013: Background jobs

**Status:** ACCEPTED-ALPHA
**Context:** DEV §3.1 offers Temporal OSS or Faktory/Redis for claim processing, fraud review, campaign expiry, indexing.
**Decision:** **BullMQ on Redis** for alpha (campaign expiry, retention deletion, notification fan-out). Rationale: the alpha job set is simple scheduled/queue work; Temporal's operational weight (separate server, workers, schema) isn't justified yet. Note: DEV names Faktory/Redis — BullMQ is the maintained Redis-queue option in the TypeScript ecosystem and satisfies the same open-source-first criterion. Revisit Temporal at V1 if long-running workflows (disputes, settlements) need durable orchestration.
**Consequences:** Redis added to Compose; jobs are idempotent by rule.

---

## ADR-014: Evidence encryption scheme

**Status:** ACCEPTED-ALPHA
**Context:** POP-009/DEV §13.3: encrypt proof bundles before IPFS upload; retention/deletion must be possible (PRV-003) despite content-addressed storage.
**Decision:** Per-bundle random symmetric key (XChaCha20-Poly1305); bundle encrypted client-side or at `proof-storage` ingestion (alpha: at ingestion over TLS, client-side envelope at MVP); bundle key wrapped to the foundation evidence KMS key and (for the miner's own access/export) to the miner's wallet-derived key. **Deletion = key destruction**: destroying the wrapped keys renders the IPFS content permanently unreadable, satisfying retention rules for content-addressed storage. Key destruction events are logged for the privacy dashboard.
**Consequences:** GDPR deletion is implementable without claiming IPFS content removal; documented honestly in `docs/privacy/`.

---

## ADR-015: Attestation handling across environments

**Status:** ACCEPTED-ALPHA
**Context:** POP-003 requires app/device integrity "Yes for production"; App Attest is unavailable in the iOS simulator; the master prompt forbids fake flows.
**Decision:** Three explicit, claim-visible integrity modes: `attested` (real App Attest + DeviceCheck — required for TestFlight pilot claims), `dev-unattested` (simulator/local dev — accepted only by validators configured with `allow_dev_claims=true`, never enabled on pilot validators), and `failed`. The mode is part of the claim and the fraud score; there is no path where an unattested claim silently counts as attested.
**Consequences:** Development stays productive without faking attestation; pilot integrity is real.

---

## ADR-016: Web framework and map stack

**Status:** ACCEPTED
**Context:** DEV §11.1 and master prompt §5.2 align fully.
**Decision:** Next.js + TypeScript + Tailwind CSS; MapLibre GL JS with OSM-compatible vector tiles (self-hostable tile source for the pilot area to respect OSM tile-usage policy); TanStack Query; React Hook Form + Zod; Recharts; wagmi/viem only where wallet interaction is genuinely needed (admin/treasury), merchant auth via managed accounts.
**Consequences:** OSM attribution displayed per licence; tile serving for the pilot area is part of infra.

---

## ADR-017: Nonce challenge issuance in alpha

**Status:** ACCEPTED-ALPHA
**Context:** SYS §8.3 claim format allows "server_or_p2p_challenge". A P2P challenge protocol needs the open validator network that alpha explicitly does not have (DEV §9.5).
**Decision:** Gateway-issued nonces in alpha: single-use, short TTL (default 120 s, configurable), bound to wallet address and attestation key, persisted for replay rejection. Protocol-level challenge (validator-issued, threshold-style) is a documented MVP/V1 upgrade.
**Consequences:** Replay protection (POP-005) fully real in alpha; one more documented alpha-centralisation point per SYS §12.1's progressive-decentralisation model.

---

## ADR-018: Self-hosted, third-party-free trust-center transport (M9 #48)

**Status:** ACCEPTED
**Context:** Trust centers must be operable and supervisable by us with no SaaS in the path (the operator requirement: "maintained and updated and supervised easily without Tailscale and other 3rd parties"). Tailscale bootstrapped the first federation but is a third party.
**Decision:** Two transports, both self-hosted: (1) same LAN — point a node at the hub by mDNS name (`<host>.local`) or a reserved IP, no tunnel; (2) cross-location — self-hosted **WireGuard** with keys generated locally (`scripts/net/wg-gen.mjs`, Node X25519), no signaling SaaS. Tailscale is demoted to an optional fallback. `scripts/node/onboard.mjs` wires either transport in one command, producing a boot-persistent agent bundle (launchd/systemd).
**Consequences:** No third party can observe or gate the fleet; operators hold all keys. WireGuard peer config is a manual append on the hub side (documented in the runbook).

---

## ADR-019: P2P validator gossip via rust-libp2p (M9 #54)

**Status:** ACCEPTED
**Context:** ADR-005 committed to a libp2p-ready, transport-independent vote shape with the gateway as the alpha hub. The north-star requires removing the central coordinator from the claim→finalise path.
**Decision:** Deliver `services/gossip-node` (`step-gossip-node`), a rust-libp2p **gossipsub** mesh in its own crate (keeping libp2p out of the validator binary). Peer identity is the validator's secp256k1 key; discovery is mDNS (LAN) + explicit self-hosted bootstrap peers (no third-party signaling). Any node validates a gossiped claim via its co-located validator, signs the existing EIP-712 vote, gossips it, aggregates peers' votes by claim, and submits the weighted-quorum bundle itself. The protocol core (message auth, quorum assembly, replay/dedup, orchestration) is pure and unit-tested; libp2p is justified as the issue-mandated, right-tool dependency (ENG rule 5).
**Consequences:** The gateway becomes an optional edge for non-P2P clients (mobile); finalisation no longer has a single coordinator. libp2p enlarges the dependency tree, contained to one crate.

---

## ADR-020: DAO governance via audited OZ Governor (M9 #55)

**Status:** ACCEPTED
**Context:** ADR-003-era privileged powers (release authorization, params, validator admission) sat on admin keys; #37 put RELEASE_ROLE behind a TimelockController but the proposer was still a single key. The north-star DAO requires participant governance.
**Decision:** Add `StepGovernor` — a pure composition of audited OpenZeppelin Governor modules (Settings, CountingSimple, Votes, VotesQuorumFraction, TimelockControl) — as the sole proposer on the existing timelock, which holds RELEASE/PARAM/VALIDATOR_ADMIN roles. Voting weight comes from `StepGovToken`, a dedicated `ERC20Votes` token kept separate from the decimals-0 `TrinityToken` accounting unit (minting gated by a new `GOV_ROLE`). No bespoke governance crypto. The emergency revoke kill-switch stays on a guarded role outside the vote.
**Consequences:** Privileged actions execute only after propose → vote → quorum+majority → queue → timelock delay → execute. Token economics/weighting policy is deliberately left open (use validator weights and/or a gov token).

---

## ADR-021: Signed, hub-independent fleet heartbeats (M9 #56)

**Status:** ACCEPTED
**Context:** Supervision was a hub-side pull; if the hub was down the fleet was invisible, and a degraded-but-alive node looked identical to a dead one.
**Decision:** Agents sign a periodic heartbeat with the node key (EIP-191, reusing the workspace signer — no new crypto dependency) and POST it to the hub. The hub verifies the signature against the node's **registered on-chain address** (anti-spoof) and stamps its own receive time. State is derived as up / degraded / suspended / dark, with on-chain weight authoritative for `suspended`; alerts (missed-heartbeat, quarantine, drift, below-quorum) are deduped + rate-limited.
**Consequences:** A degraded node is distinguishable from a dead one; supervision no longer depends on the hub being the sole observer. The chain remains authoritative for quorum.

---

## ADR-022: Trust-minimised multi-endpoint chain reads (M9 #50, partial)

**Status:** ACCEPTED (read-side); ledger replication OPEN
**Context:** A single chain RPC endpoint is a single point of trust that can lie about state (e.g. a validator's weight) and skew quorum. Replacing the single devchain with a replicated ledger is a large infra effort.
**Decision:** As the read-side slice toward a shared ledger: the agent fails over across `STEP_RPC_URLS`, and the gossip node reads `activeWeight` from every configured endpoint and accepts only a value a majority agree on (`STEP_RPC_MIN_AGREE`), flagging a lone divergent endpoint and conservatively excluding an un-agreed weight. The full replicated/consensus-node ledger remains an open infrastructure track.
**Consequences:** Reads no longer trust a single chain node; the application layer is ready to consume a replicated ledger. Standing up the replicated chain itself is deferred and tracked on issue #50.

---

## ADR-023: Trust-center packaging — signed self-contained bundle, not npm/dmg

**Status:** ACCEPTED
**Context:** A new dedicated trust center (chappie or any machine) must install the
node software easily, anywhere. Candidate mechanisms considered: an npm package, a
downloadable macOS dmg, or the self-contained bundle already produced by
`scripts/node/onboard.mjs` + `bundle-agent.mjs`.
**Decision:** Keep the self-contained bundle (a tarball: static Rust
`step-node-agent` binary + protocol params + config + `provision-secrets.sh` +
`install-service.sh`). It is built per-node on the hub (which registers the node
on-chain), delivered over a TRUSTED channel, and self-installs as a boot-persistent
service that thereafter self-updates from chain (ADR-019/M8). **Reject npm and dmg:**
(1) the bundle carries the node's **private key**, so it can never sit on a public
registry or download URL — it must travel over a trusted channel only; (2) npm needs
Node on every node and is a third-party registry (against the no-3rd-party goal);
(3) a dmg is macOS-only (trust centers may be Linux), needs Apple notarization, and
is a GUI installer for a headless service — the wrong shape. The "package" is the
tarball; the "installer" is `install-service.sh`; updates come from the chain, not a
re-package.
**Consequences:** One enable path for every platform (`onboard.mjs` → deliver →
`install-service.sh`). No registry/notarization toolchain to maintain. The trusted-
channel delivery (scp/Taildrop/USB) is a deliberate, documented step, not a gap.

---

## OPEN decisions (no safe default — owner/legal input required)

| # | Decision | Blocks | Owner type |
|---|---|---|---|
| OPEN-1 | Final Trinity denomination (default 1 STEP = 67,108,864 Trinity is RECOMMENDED, unconfirmed) | Tokenomics constitution, whitepaper | Product/founder |
| OPEN-2 | Permanent twin schedule + cap | Tokenomics constitution, treasury docs | Product/founder + legal |
| OPEN-3 | Max total supply model | Whitepaper, investor material | Product/founder |
| OPEN-4 | Production chain (L2/appchain/rollup) | MVP deployment | Engineering + cost/legal review |
| OPEN-5 | Legal classification of Trinity; CASP analysis; custody model; KYC thresholds; fiat path | Exchange phases 2–3, cash-out, public launch | External counsel |
| OPEN-6 | Jurisdiction of foundation and operating company | Legal structure, merchant invoicing | Founder + counsel |
| OPEN-7 | Pilot city and first merchant category | M6 configuration (not code) | Business |
| OPEN-8 | Burn policy | Tokenomics constitution | Product/founder |
| OPEN-9 | Validator fee amounts and staking economics | V1 validator opening | Product + tokenomics |
| OPEN-10 | Exact icosahedron rotation constant + bytes32 ID packing (residual of ADR-002) | M1.1 — must be fixed first thing in M1 | Engineering (decidable internally) |
