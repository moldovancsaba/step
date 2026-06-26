# STEP API Contracts

**Version:** 0.1 (alpha, as implemented) · **Date:** 2026-06-12
Wire types live in [`packages/schemas`](../../packages/schemas) (JSON Schema, CI-validated) and [`@step/shared-types`](../../packages/shared-types); the typed client is [`@step/api-client`](../../packages/api-client). All bodies are JSON; errors are `{error: string}` with conventional status codes.

## gateway-api (claim path)

| Endpoint | Request | Response | Notes |
|---|---|---|---|
| `POST /v1/nonce` | `{wallet}` | `{nonce, expires_at_unix}` | wallet-bound, single-use, TTL = `proof.nonce_ttl_seconds` |
| `POST /v1/claims` | `{claim: step.proof.location.v1}` | ClaimRecord | idempotent per claim hash; fans out, aggregates quorum, relays on-chain; chain reverts → `reject_reasons[0] = "chain_revert:…"` |
| `GET /v1/claims/{hash}` | — | ClaimRecord | 404 unknown |

ClaimRecord: `{claim_hash, triangle_id, triangle_id_hash, miner, campaign_id?, status: submitted|validating|accepted|finalised|rejected, reject_reasons[], votes[{validator, approve, weight}], tx_hash?, submitted_at, finalised_at?}` — never coordinates.

## validator-node

| Endpoint | Purpose |
|---|---|
| `POST /v1/validate` `{claim}` | full pipeline → `{verdict{approve, reject_reasons[], fraud{score, signals[]}, boundary}, vote{validator, signature, claim_hash, triangle_id_hash, miner, approve}, validated_at}`; 429 on wallet rate limit |
| `GET /v1/mesh/resolve?lat&lon&level` · `GET /v1/mesh/triangle/{id}` | canonical TriangleInfo: `{triangle_id, triangle_id_hash, level, vertices[3]{lat,lon}, centroid, area_m2, min_side_m, parent, neighbours[3], mesh_spec_version}`; 400 on invalid input |
| `GET /healthz` · `GET /metrics` | liveness; Prometheus text |

## indexer (explorer reads; bigints serialised as strings)

`GET /v1/stats` `{total_supply, claims_finalised, sponsored_claims, triangles_touched, last_block}` · `GET /v1/triangles/{idHash}` `{used_slots, last_mined_at, frozen, freeze_reason, total_mined_trinity, oasis_campaigns[]}` · `GET /v1/triangles` · `GET /v1/claims[/{hash}]` · `GET /v1/campaigns[/{id}]` `{merchant, status, budget, released, refunded, triangle_id_hashes[], verified_visits}` · `GET /v1/validators` · `GET /v1/treasury` `{total_twin_minted, withdrawals[{to, amount, purpose, tx_hash}]}`.

## merchant-api

`POST /v1/merchants` (422 on restricted category or missing rights confirmation) · `POST /v1/merchants/{id}/review` (foundation bearer token) · `POST /v1/pois` (canonical triangle mapping; 403 unapproved merchant; 502 mesh failure) · `GET /v1/merchants/{id}/pois` · `GET /v1/pois/{id}/qr` `{payload: stepqr1:…, rotates_every_s: 300}` · `POST /v1/pois/{id}/qr/verify` `{payload}` → `{valid}`.

## proof-storage (foundation-internal)

`POST /v1/bundles` (`step.evidence.bundle.v1` only) → 201 `{cid}` · `GET /v1/bundles/{cid}` (foundation token; 404 after key destruction) · `DELETE /v1/bundles/{cid}/key` (foundation token; GDPR deletion, logged).

## exchange-service (closed credits only — ADR-011)

`POST /v1/credits/grant` (foundation token) · `GET /v1/credits/{merchant}` (balance + ledger + reference price) · `POST /v1/credits/convert` (409 over balance; floor-rounded whole-Trinity figure). **Every response includes the HARD §8.4 disclaimer field.**

## On-chain interface

The contract ABI set is generated to `@step/shared-types/abis` by `scripts/dev/extract-abis.mjs` after `forge build`; function/event surfaces are specified in the [contract specification](../smart-contracts/STEP_contract_specification.md). Address book per chain: `contracts/deployments/{chainId}.json`.

## Trust Center onboarding API

Trust Center onboarding is defined in detail in `docs/trust-center-onboarding-api.md`.

### POST /v1/trust-centers/pair

Pairs a locally generated desktop node identity to a mobile wallet. The gateway validates payload shape and relays `TrustCenterRegistry.pairNode`.

Required body:

```json
{
  "type": "step.trustcenter.pair",
  "version": 1,
  "nodeAddress": "0x...",
  "ownerWallet": "0x...",
  "challenge": "0x...bytes32",
  "expiresAt": 1800000000,
  "signature": "0x..."
}
```

Success returns ownership, reward recipient, status, active validator weight, next action, and transaction hash.

### GET /v1/trust-centers/:nodeAddress

Returns onboarding/runtime status for a Trust Center node. Wallet ownership and validator activation are separate fields; a paired node can be `pending` with zero validator weight.

### GET /v1/trust-centers/:nodeAddress/onboarding-status

Mobile/installer polling alias for the same status record.

## Public edge and peer routing API

The public frontend uses same-origin Worker routes and must not know backend topology.

### GET /api/edge/health

Returns Worker routing health, deploy mode, and available peers by service.

### GET /api/peers

Returns known peer records from static config, bootstrap config, and the peer directory.

### GET /api/peers/healthy?service=gateway

Returns active, non-expired, public HTTPS peers able to serve the requested service.

### /api/gateway/*, /api/mesh/*, /api/indexer/*, /api/fleet/*

Routes to healthy peers. Responses include route metadata headers where available:

```text
x-step-route-id
x-step-peer
x-step-peer-service
x-step-route-attempts
```

If no healthy peer exists, the Worker returns structured JSON with `error: "no_healthy_peer"` and does not synthesize protocol success.
