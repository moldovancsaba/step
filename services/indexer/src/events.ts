/**
 * Chain-event → store projection (DAT-004). Decoding uses the generated ABIs;
 * application logic is pure and unit-tested. The projection is rebuildable
 * from block 0 at any time — the chain remains the source of truth (DAT-002).
 */
import { parseEventLogs, type Log } from "viem";
import {
  CampaignRegistryAbi,
  FoundationTreasuryAbi,
  MiningClaimVerifierAbi,
  SafetyRegistryAbi,
  ValidatorRegistryAbi,
} from "@step/shared-types/abis";
import type { Address, Hex } from "@step/shared-types";
import type { MemoryStore } from "./store.js";

const ALL_ABIS = [
  ...MiningClaimVerifierAbi,
  ...FoundationTreasuryAbi,
  ...CampaignRegistryAbi,
  ...SafetyRegistryAbi,
  ...ValidatorRegistryAbi,
] as const;

export interface DecodedEvent {
  eventName: string;
  args: Record<string, unknown>;
  blockNumber: bigint;
  transactionHash: Hex;
}

export function decodeLogs(logs: Log[]): DecodedEvent[] {
  return parseEventLogs({ abi: ALL_ABIS, logs, strict: false }).map((l) => ({
    eventName: l.eventName as string,
    args: l.args as Record<string, unknown>,
    blockNumber: l.blockNumber ?? 0n,
    transactionHash: l.transactionHash as Hex,
  }));
}

export function applyEvent(store: MemoryStore, e: DecodedEvent): void {
  const a = e.args;
  switch (e.eventName) {
    case "TriangleMined": {
      const tri = store.triangle(a.triangleId as Hex);
      tri.used_slots = Math.max(tri.used_slots, Number(a.slot as bigint) + 1);
      tri.last_mined_at = new Date().toISOString();
      tri.total_mined_trinity += a.trinityAmount as bigint;
      store.claims.set((a.proofHash as Hex).toLowerCase(), {
        claim_hash: a.proofHash as Hex,
        triangle_id_hash: a.triangleId as Hex,
        miner: a.miner as Address,
        kind: "natural",
        slot: Number(a.slot as bigint),
        campaign_id: null,
        trinity_amount: a.trinityAmount as bigint,
        proof_cid_hash: null,
        block_number: e.blockNumber,
        tx_hash: e.transactionHash,
      });
      break;
    }
    case "FoundationTwinAllocated": {
      store.treasury.total_twin_minted += a.trinityAmount as bigint;
      break;
    }
    case "TreasuryWithdrawal": {
      store.treasury.withdrawals.push({
        to: a.to as Address,
        amount: a.amount as bigint,
        purpose: a.purposeCode as Hex,
        tx_hash: e.transactionHash,
      });
      break;
    }
    case "SponsoredRewardClaimed": {
      const campaign = store.campaign(a.campaignId as Hex);
      campaign.verified_visits += 1;
      campaign.released += a.trinityAmount as bigint;
      store.claims.set((a.proofHash as Hex).toLowerCase(), {
        claim_hash: a.proofHash as Hex,
        triangle_id_hash: "0x" as Hex, // bound via ProofRegistry lookup when needed
        miner: a.miner as Address,
        kind: "sponsored",
        slot: null,
        campaign_id: a.campaignId as Hex,
        trinity_amount: a.trinityAmount as bigint,
        proof_cid_hash: null,
        block_number: e.blockNumber,
        tx_hash: e.transactionHash,
      });
      break;
    }
    case "CampaignCreated": {
      const campaign = store.campaign(a.campaignId as Hex);
      campaign.merchant = a.merchant as Address;
      campaign.triangle_id_hashes = (a.triangleIds as Hex[]) ?? [];
      for (const tid of campaign.triangle_id_hashes) {
        const tri = store.triangle(tid);
        if (!tri.oasis_campaigns.includes(campaign.campaign_id)) {
          tri.oasis_campaigns.push(campaign.campaign_id);
        }
      }
      break;
    }
    case "CampaignStatusChanged": {
      store.campaign(a.campaignId as Hex).status = Number(a.status);
      break;
    }
    case "OasisFunded": {
      store.campaign(a.campaignId as Hex).budget = a.newBudget as bigint;
      break;
    }
    case "CampaignRefundRecorded": {
      store.campaign(a.campaignId as Hex).refunded += a.amount as bigint;
      break;
    }
    case "TriangleFrozen": {
      const tri = store.triangle(a.triangleId as Hex);
      tri.frozen = true;
      tri.freeze_reason = a.reasonCode as Hex;
      break;
    }
    case "TriangleUnfrozen": {
      const tri = store.triangle(a.triangleId as Hex);
      tri.frozen = false;
      tri.freeze_reason = null;
      break;
    }
    case "ValidatorRegistered": {
      store.validators.set((a.validator as string).toLowerCase(), {
        validator: a.validator as Address,
        validator_type: Number(a.validatorType),
        weight: a.weight as bigint,
        status: 1, // Active
        slashed_total: 0n,
      });
      break;
    }
    case "ValidatorStatusChanged": {
      const v = store.validators.get((a.validator as string).toLowerCase());
      if (v) v.status = Number(a.status);
      break;
    }
    case "ValidatorWeightChanged": {
      const v = store.validators.get((a.validator as string).toLowerCase());
      if (v) v.weight = a.weight as bigint;
      break;
    }
    case "ValidatorSlashed": {
      const v = store.validators.get((a.validator as string).toLowerCase());
      if (v) v.slashed_total += a.amount as bigint;
      break;
    }
    default:
      break; // events without a projection (ProofStored handled via claims join later)
  }
  if (e.blockNumber > store.lastBlock) store.lastBlock = e.blockNumber;
}
