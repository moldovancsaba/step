# STEP Smart Contract Specification

**Version:** 0.1 (alpha)
**Date:** 2026-06-12
**Status:** Implemented and tested on Anvil; NOT audited (SC-007 blocks any non-testnet deployment)
**Source:** [`contracts/src`](../../contracts/src) — Solidity 0.8.28, Foundry, OpenZeppelin 5.1.0

---

## 1. Architecture principles

1. **The chain never sees coordinates** (DEV §5.1, PRV-001). Miners sign the full claim off-chain (EIP-712 domain `StepMiningClaim v1`); validators verify geometry/attestation/fraud off-chain and sign votes over the claim hash. Contracts verify only the weighted validator quorum and finalise economic state. On-chain data per claim: claim hash, triangle ID hash, miner address, slot, amount, proof CID hash — exactly the POP-008 field list.
2. **Trinity is structurally indivisible**: `TrinityToken.decimals() == 0` and `mint` requires `amount >= 1` (PRD-004).
3. **Two and only two mint paths** (TOK-002): natural rewards via `MiningClaimVerifier` and the foundation twin via `FoundationTreasury`. Sponsored Trinity is never minted — only escrowed and released (TOK-003).
4. **Economic constants are time-locked parameters**, not code (`Parameterized` base: schedule → delay → apply, with re-validation at apply time and full event trail).
5. **Every state change emits an event** for the indexer (ENG-001).

## 2. Contract inventory

| Contract | Responsibility | Key external functions |
|---|---|---|
| `StepAccess` | Central roles + domain pause switches (`PAUSE_MINTING`, `PAUSE_CAMPAIGNS`) | `setPaused`, `checkRole`, `checkNotPaused` |
| `TrinityToken` | ERC-20, 0 decimals, role-gated mint | `mint` |
| `MeshRegistry` | Mesh spec version commitment, mineable level set (ADR-003) | `setMineableLevel`, `isMineableLevel` |
| `SafetyRegistry` | Triangle freezes with reason codes (SAF-002/004) | `freezeTriangle`, `unfreezeTriangle`, `isTriangleBlocked` |
| `ValidatorRegistry` | Validator identity/type/weight/status/stake; slashing hook (VAL-005) | `registerValidator`, `setStatus`, `setWeight`, `slash`, `activeWeight` |
| `TriangleMiningState` | Collector slots, halving reward curve, opening delay, cooldown, exhaustion (MIN-002/003/004) | `consumeSlot` (verifier-only), `status`, `nextReward`, `slotReward` |
| `FoundationTreasury` | Twin allocation at `twin_bps` with optional lifetime cap; reason-coded withdrawals (TOK-005, ADR-008) | `allocateTwin` (verifier-only), `withdraw` |
| `ProofRegistry` | claimHash → proof CID hash commitments | `store` (verifier-only), `hasProof` |
| `CampaignRegistry` | Campaign state machine (DEV §15.2), triangles, wallet limits, refund policy | `createCampaign`, `reviewCampaign`, `activateCampaign`, `pauseCampaign`, `cancelCampaign`, `expireCampaign` |
| `RewardPool` | Sponsored Trinity escrow; release/refund executor | `fund`, `release` (verifier-only), `refund` |
| `MiningClaimVerifier` | EIP-712 weighted quorum verification; natural + sponsored finalisation; replay protection | `finaliseNaturalClaim`, `finaliseSponsoredClaim`, `voteDigest` |

## 3. Claim finalisation flows

### Natural (SYS §23.1 steps 11–15)
`finaliseNaturalClaim(claimHash, triangleId, meshLevel, miner, proofCidHash, sigs[])`:
1. replay check (`finalisedClaims[claimHash]`, shared across both paths);
2. `SafetyRegistry.isTriangleBlocked` → revert if frozen;
4. quorum: signatures must be strictly ascending by validator address (dedup); each recovers against the EIP-712 vote digest `StepValidatorVote(claimHash, triangleId, miner, approve=true)`; only `Active` validators contribute `weight`; `Σweights ≥ P_QUORUM_WEIGHT`;
5. `TriangleMiningState.consumeSlot` (checks Open/Locked/Cooldown/Exhausted, returns slot + halving reward ≥ 1);
6. `TrinityToken.mint(miner, reward)`;
7. `FoundationTreasury.allocateTwin(claimHash, reward)` — `twin = reward × bps/10000`, clamped by the lifetime cap when set;
8. `ProofRegistry.store`;
9. `emit TriangleMined(triangleId, miner, slot, reward, claimHash)`.

### Sponsored (SYS §23.2)
`finaliseSponsoredClaim(claimHash, triangleId, campaignId, miner, proofCidHash, sigs[])`: replay + safety + quorum, then `RewardPool.release` → `CampaignRegistry.onSponsoredClaim` enforces Active status, time window, triangle membership, per-wallet limit, and budget; transfer (never mint) to the miner; `emit SponsoredRewardClaimed`.

## 4. Events (DEV §10.4 / HARD §15.3 coverage)

`TriangleMined`, `FoundationTwinAllocated`, `CampaignCreated`, `CampaignStatusChanged`, `OasisFunded`, `SponsoredRewardClaimed`/`SponsoredRewardReleased`, `SponsoredClaimRecorded`, `CampaignRefundRecorded`/`CampaignRefunded`, `ValidatorRegistered`, `ValidatorStatusChanged`, `ValidatorWeightChanged`, `ValidatorSlashed`, `TriangleFrozen`, `TriangleUnfrozen`, `ProofStored`, `TriangleSlotConsumed`, `TreasuryWithdrawal`, `ParamScheduled`, `ParamApplied`, `ParamCancelled`, `DomainPaused`, `DomainUnpaused`, `MeshSpecVersionSet`, `MineableLevelSet`.

## 5. Parameters (alpha defaults — UNFROZEN)

| Contract | Key | Alpha default | Validation |
|---|---|---|---|
| TriangleMiningState | `triangle.collector_slots` | 27 | 1–256 AND `base >> (slots−1) ≥ 1` |
| TriangleMiningState | `triangle.base_reward_trinity` | 67 108 864 (2²⁶) | ≥1 AND curve floor ≥ 1 Trinity |
| TriangleMiningState | `triangle.opening_delay_s` | 0 (pilot) | any |
| TriangleMiningState | `triangle.post_claim_cooldown_s` | 3600 (deploy script) | any |
| FoundationTreasury | `treasury.twin_bps` | 10000 | ≤ 10000 |
| FoundationTreasury | `treasury.twin_cap_trinity` | 0 (uncapped) | any |
| MiningClaimVerifier | `verifier.quorum_threshold_weight` | 100 | > 0 |

The ≥1-Trinity curve floor is enforced three times: at parameter validation, re-validated at timelock apply, and as a `require` at consumption (defence in depth, HARD §4.3).

## 6. Test status (verified 2026-06-12)

`forge test`: **31/31 passing** — 28 unit/integration (happy paths, replay across both paths, quorum shortfalls, suspended validators, duplicate/unsorted signatures, signature-over-wrong-claim, rejection votes, freeze/unfreeze, exhaustion incl. exact 1-Trinity final slot, emergency pause round-trip, campaign lifecycle with both refund policies, per-wallet limits, pre-funding enforcement, param timelock, twin bps fuzz across 0–10000, twin cap clamp, opening delay/cooldown timing), 1 fuzz (512 runs), 2 invariants (64 runs × 32 depth: `totalSupply == minerMints + twinMints`, treasury holds all twin).

Deployment: `script/Deploy.s.sol` executed successfully against live Anvil (chain 31337); address book at [`contracts/deployments/31337.json`](../../contracts/deployments/31337.json). Production wiring grants `MINTER_ROLE` only to the verifier and treasury contracts.

## 7. Known gaps and audit notes

- **No audit yet** — required before any non-testnet deployment (SC-007).
- `DisputeManager` and `Exchange` are specified (SYS §13.2) but intentionally not implemented: disputes are admin-mediated in alpha (claim review console) and the exchange is excluded from alpha entirely (ADR-011). Both are post-alpha contracts.
- Static analysis (Slither) and Echidna campaigns are CI tasks, not yet executed in this environment — tracked in the release log.
- Upgradeability: contracts are non-upgradeable by design for alpha; redeployment is the upgrade path on the internal testnet. A governed proxy strategy is a pre-mainnet decision.

## TrustCenterRegistry

`TrustCenterRegistry` binds a desktop Trust Center node identity to a user wallet for ownership and reward routing. It does not grant validator voting weight.

State:

```solidity
mapping(address => address) nodeOwner;
mapping(address => address) rewardRecipient;
mapping(address => NodeStatus) nodeStatus;
mapping(bytes32 => bool) usedPairingDigest;
```

Statuses:

```solidity
None, Pending, Active, Suspended, Revoked
```

Pairing digest:

```solidity
keccak256(abi.encode(
  keccak256("STEP_TRUST_CENTER_PAIR_V1"),
  block.chainid,
  address(this),
  node,
  owner,
  challenge,
  expiresAt
))
```

`pairNode(node, owner, challenge, expiresAt, ownerSignature)` verifies the owner wallet's Ethereum personal-sign signature, prevents replay, records ownership, initializes reward recipient, and moves the node to `Pending` if it was `None`.

`setRewardRecipient(node, recipient)` is restricted to the node owner.

`setNodeStatus(node, status)` is restricted to `VALIDATOR_ADMIN_ROLE` and is the administrative bridge from paired ownership to operational status. Validator voting weight remains controlled by `ValidatorRegistry`.
