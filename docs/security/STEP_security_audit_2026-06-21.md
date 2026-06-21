# STEP infrastructure security audit — 2026-06-21

> **Remediation status (M10):** all 15 findings (C1–C2, H1–H3, M1–M6, L1–L4) are
> **delivered and CI-green** on `feat/v2-mining-nfts` — decomposed into issues
> #58–#69 (milestone M10), each with code + tests + docs. Code controls (rate
> limits, hash-verify, secret-handling, relay bounds, fail-closed guards, the
> governed-handover invariant test, the genesis safety net) are in place. The two
> CRITICALs are *operational* gates the code now enforces/tests but that an
> operator must execute on the real chain (run the secret-key genesis ceremony,
> run the governed redeploy) before external validators join — the tooling and the
> proving tests now exist.


> Scope: the infrastructure delivered in M8/M9 + the sovereign-chain bring-up —
> trust-center agent, keyless install, P2P gossip (libp2p), signed heartbeats, DAO
> governance, the cloudflared backend tunnel, and the cosmos/evm sovereign chain.
> Severity = impact × exploitability **in production use**. Several items are
> harmless on today's local devnet but become critical the moment this is the path
> "other machines join", which it now is (ADR-024). Each finding lists the fix.

Audit method: source review of the new/changed code paths (Rust agent + gossip,
TS gateway/fleet, install/ops scripts, contracts wiring) and the committed chain
genesis. Not a substitute for an external review before mainnet.

---

## CRITICAL

### C1 — Sovereign-chain genesis is controlled by PUBLIC well-known keys
**Where:** `chain/genesis.json` (committed); built from cosmos/evm `local_node.sh`
dev mnemonics.
**Issue:** The genesis funds accounts (one with **100,000,000 TEST**) whose keys are
the cosmos/evm **public test mnemonics**, and the single genesis validator's
signing key is a public dev key. Anyone who knows those (public) mnemonics controls
the chain's funds and the founding validator — i.e. can drain balances and, as the
sole/early validator, dominate consensus.
**Impact:** Total compromise of any chain started from this genesis.
**Fix:** Before any non-local use, generate a **fresh genesis** with secret,
per-operator validator keys (`evmd init` + real `keys add` on each machine, fresh
gentx collection), remove the dev pre-funded accounts, and distribute the new
`genesis.json`. Never reuse `local_node.sh`'s mnemonics. Treat the committed
`chain/genesis.json` as a **devnet sample only** — label it as such.

### C2 — STEP contracts on the sovereign chain are owned by a public key
**Where:** sovereign-chain deploy used `dev0` (public mnemonic) as
`DEPLOYER_PRIVATE_KEY`, so `admin` = that address on chain 262144 (ADR-024).
**Issue:** `StepAccess` admin + all granted roles (PARAM, PAUSER, VALIDATOR_ADMIN,
TREASURER, RELEASE, …) belong to a **publicly-known key**. Anyone can grant
themselves roles, change protocol params, pause domains, or drive privileged paths.
**Impact:** Full control of the STEP protocol on that chain.
**Fix:** Redeploy with a **secret** deployer, then immediately transfer admin to
the **TimelockController + StepGovernor** (already built, ADR-020) and renounce the
bare admin. Never deploy production contracts from a dev key.

---

## HIGH

### H1 — `install.sh` runs an unverified downloaded binary
**Where:** `scripts/node/install.sh:34` — `curl -fsSL "$ARTIFACT" -o step-node-agent`
then `chmod +x` + run as a boot-persistent service holding the node key.
**Issue:** No checksum/signature on the downloaded binary. A compromised or
MITM'd artifact host yields **arbitrary code execution** on every joining node.
This is inconsistent with the agent's own self-update, which *does* verify sha256
against the on-chain `ReleaseRegistry`.
**Fix:** Pass an expected `--sha256` (published on-chain / in the install command),
verify it before `chmod +x`, and prefer HTTPS pinning. Reuse the agent's existing
hash-verify path for the bootstrap binary too.

### H2 — Public gateway + funded relayer → gas-drain DoS
**Where:** backend tunnel exposes `gw.step.regiominer.com → :8080`
(`scripts/ops/backend-tunnel.mjs`); `services/gateway-api/src/index.ts:76` submits
finalise txs paying gas from `RELAYER_PRIVATE_KEY`.
**Issue:** With claim intake public, an attacker who can get claims to pass quorum
forces the relayer to pay gas, draining its balance (and is a free spam vector for
everything up to submission).
**Fix:** Enforce per-wallet / per-IP rate limits and proof-of-work or auth at the
gateway intake *before* fan-out; alert on relayer balance; cap submissions/min.
Confirm the validator wallet-rate-limit gates before any on-chain submit.

### H3 — Dev `anvil` exposed on the network with the well-known account-0 key
**Where:** `scripts/dev/up.mjs:177` (`STEP_ANVIL_HOSTS`), baked into the hub daemon
(`scripts/ops/install-hub.mjs:54`). We ran it on the LAN IP.
**Issue:** anvil's admin/funder is the **public** Hardhat account-0 key. Anyone who
can reach the RPC (LAN today; `0.0.0.0`/tunnel would be worse) controls the chain —
mint, drain, re-register validators.
**Fix:** Keep anvil **loopback-only** or behind WireGuard; never `0.0.0.0` or
public. This risk disappears at cutover to the sovereign chain (which must fix C1/C2
first).

---

## MEDIUM

### M1 — Free transactions on the sovereign chain (spam/DoS)
**Where:** `scripts/chain/start.sh:13` — `--minimum-gas-prices=0atest --evm.min-tip=0`.
**Issue:** Zero-cost txs let anyone fill blocks / bloat state.
**Fix:** Set a non-zero `--minimum-gas-prices` for any networked deployment.

### M2 — Secrets passed on the command line (`ps`-visible)
**Where:** `services/node-agent/src/secrets.rs:96-105` (`security add-generic-password
… -w <secret>`); `scripts/node/bundle-agent.mjs:94-95`; `scripts/node/register.mjs:40`
(`cast … --private-key <key>`).
**Issue:** Secrets appear in process arguments, readable via `ps` by other local
users/processes during the call.
**Fix:** Feed secrets via stdin or a temp 0600 file / keychain API, not argv. For
`cast`, use `--private-key` from an env-file or `--interactive`/keystore.

### M3 — Mining-frontier endpoint amplification
**Where:** `services/gateway-api/src/app.ts` `GET /v1/mesh/mineable` — up to **21
on-chain `eth_call`s per request** (`triangleStatus` walk), unauthenticated.
**Fix:** Short-TTL cache per location + rate limit; cap the ancestor walk.

### M4 — Heartbeat endpoint CPU DoS
**Where:** `services/fleet-api/src/app.ts:60` — ECDSA recovery (and a rebuilt
`registered()` set) runs **before** any rate limit on `POST /v1/fleet/heartbeat`.
**Fix:** IP/peer rate-limit + body-size cap before verification; memoize the
registered set.

### M5 — Open libp2p relay
**Where:** `services/gossip-node/src/swarm.rs:133` —
`relay::Behaviour::new(peer_id, relay::Config::default())`.
**Issue:** Any peer can reserve circuits and relay traffic through the node →
bandwidth/resource abuse (amplification).
**Fix:** Bound reservations/data in `relay::Config`, or only enable the relay
*server* on designated public relays; keep ordinary nodes relay-client + dcutr only.

### M6 — Tunnel control token at rest
**Where:** `STEP_TUNNEL_TOKEN` in `.env` (gitignored) + embedded in the LaunchAgent
plist (0600, `scripts/ops/backend-tunnel.mjs`).
**Issue:** Whoever reads either file can reroute the public backend.
**Fix:** Store in the OS keychain; rotate periodically; tighten file ownership.

---

## LOW / NOTES

- **L1** `scripts/node/register.mjs:33` defaults to the public Anvil admin key when
  `STEP_ADMIN_KEY` is unset — require the env in non-dev (fail closed).
- **L2** The keyed agent bundle (`bundle-agent.mjs`) embeds the node private key;
  prefer the **keyless** `install.sh` + `--init` path (no secret in transit) and
  deprecate the keyed bundle for anything beyond a trusted LAN.
- **L3** Gossip/QUIC listen on `0.0.0.0` (`swarm.rs:176`) — intended for
  reachability; acceptable for a P2P node, noted for awareness.
- **L4** Gateway does not numerically validate `lat/lon` (passed to the mesh API,
  which does) — add a numeric guard for defense-in-depth.

## Positive controls already in place (kept honest)
- Agent self-update verifies sha256 against on-chain `ReleaseRegistry`; fail-closed
  integrity + secrets; auto-rollback (M8).
- Heartbeats + gossip votes use EIP-191/EIP-712 signatures verified against the
  **registered on-chain address** (anti-spoof); gossipsub `ValidationMode::Strict`.
- Keyless `--init` uses the OS CSPRNG (`/dev/urandom`); keys never transit.
- Multi-endpoint chain-read agreement (#50) resists a single lying RPC.
- `gitleaks` runs in CI; `TimelockController` + `StepGovernor` exist to remove
  admin-key risk (apply them — see C2).

## Priority order
1. **C1, C2** before the chain is used by any second machine (they are on the
   "join the foundation" path now).
2. **H1, H2, H3** before the backend/install is reachable beyond a trusted LAN.
3. **M1–M6** before a public/incentivised deployment.
