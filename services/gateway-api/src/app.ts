/**
 * Gateway API (alpha topology, ADR-005): nonce issuance (ADR-017), claim
 * intake, fan-out to validator nodes, weighted quorum aggregation, and
 * on-chain finalisation via the relayer key (DEV §9.3 "chain or relayer").
 *
 * Privacy: claim records kept by the gateway exclude coordinates — the full
 * claim goes only to validators and the encrypted evidence path (PRV-001).
 * Dependencies are injected so the orchestration is unit-testable; production
 * wiring lives in index.ts and the real end-to-end path runs in tests/e2e.
 */
import { Hono } from "hono";
import {
  canonicalClaimMessage,
  claimHash,
  makeNonce,
  triangleIdHash,
  type Address,
  type Claim,
  type ClaimStatus,
  type Hex,
  type SignedVote,
  type ValidateResponse,
} from "@step/shared-types";
import { aggregateQuorum, votesAreConsistent, type WeightedVote } from "./quorum.js";

export interface ClaimRecord {
  claim_hash: Hex;
  triangle_id: string;
  triangle_id_hash: Hex;
  miner: Address;
  campaign_id?: string;
  status: ClaimStatus;
  reject_reasons: string[];
  votes: { validator: Address; approve: boolean; weight: string }[];
  tx_hash?: Hex;
  submitted_at: string;
  finalised_at?: string;
}

export interface GatewayDeps {
  nonceSecret: string;
  nonceTtlSeconds: number;
  quorumThresholdWeight: bigint;
  validatorUrls: string[];
  /** POST a claim to one validator node, returns its signed vote. */
  validate(url: string, claim: Claim): Promise<ValidateResponse>;
  /** On-chain active weight for a validator (ValidatorRegistry.activeWeight). */
  weightOf(validator: Address): Promise<bigint>;
  /** Submit finaliseNaturalClaim; resolves to the tx hash after inclusion. */
  submitNatural(args: {
    claimHash: Hex;
    triangleIdHash: Hex;
    meshLevel: number;
    miner: Address;
    proofCidHash: Hex;
    sortedApprovals: SignedVote[];
  }): Promise<Hex>;
  /** Submit finaliseSponsoredClaim. */
  submitSponsored(args: {
    claimHash: Hex;
    triangleIdHash: Hex;
    campaignId: Hex;
    miner: Address;
    proofCidHash: Hex;
    sortedApprovals: SignedVote[];
  }): Promise<Hex>;
  /** Store the encrypted evidence bundle; returns the CID hash committed on-chain. */
  storeEvidence(bundle: unknown): Promise<Hex>;
  randomHex(): string;
  nowUnix(): number;
}

export function createApp(deps: GatewayDeps) {
  const app = new Hono();
  const records = new Map<string, ClaimRecord>();

  app.get("/healthz", (c) => c.text("ok"));

  app.post("/v1/nonce", async (c) => {
    const body = await c.req.json().catch(() => null);
    const wallet = body?.wallet as string | undefined;
    if (!wallet || !/^0x[0-9a-fA-F]{40}$/.test(wallet)) {
      return c.json({ error: "wallet required" }, 400);
    }
    const expiry = deps.nowUnix() + deps.nonceTtlSeconds;
    const nonce = makeNonce(deps.nonceSecret, wallet as Address, expiry, deps.randomHex());
    return c.json({ nonce, expires_at_unix: expiry });
  });

  app.post("/v1/claims", async (c) => {
    const body = await c.req.json().catch(() => null);
    const claim = body?.claim as Claim | undefined;
    if (!claim || claim.schema_version !== "step.proof.location.v1") {
      return c.json({ error: "claim with schema step.proof.location.v1 required" }, 400);
    }

    const message = canonicalClaimMessage(claim);
    const ch = claimHash(message);
    const th = triangleIdHash(claim.triangle_id);
    const existing = records.get(ch);
    if (existing) {
      // Idempotent: resubmission returns the existing record (POP-005 replays
      // are additionally rejected by validators and the contract).
      return c.json(existing, 200);
    }

    const record: ClaimRecord = {
      claim_hash: ch,
      triangle_id: claim.triangle_id,
      triangle_id_hash: th,
      miner: claim.wallet_address.toLowerCase() as Address,
      campaign_id: claim.campaign_id,
      status: "validating",
      reject_reasons: [],
      votes: [],
      submitted_at: new Date().toISOString(),
    };
    records.set(ch, record);

    // Fan out to all configured validators in parallel; tolerate node failures
    // (quorum decides, not availability of every node).
    const results = await Promise.allSettled(
      deps.validatorUrls.map((url) => deps.validate(url, claim)),
    );
    const votes: WeightedVote[] = [];
    const rejectReasons = new Set<string>();
    for (const r of results) {
      if (r.status !== "fulfilled") continue;
      const resp = r.value;
      const weight = await deps.weightOf(resp.vote.validator);
      votes.push({ vote: resp.vote, weight });
      record.votes.push({
        validator: resp.vote.validator,
        approve: resp.vote.approve,
        weight: weight.toString(),
      });
      for (const reason of resp.verdict.reject_reasons) rejectReasons.add(reason);
    }

    if (!votesAreConsistent(votes.map((v) => v.vote), ch, record.miner)) {
      record.status = "rejected";
      record.reject_reasons = ["inconsistent_votes"];
      return c.json(record, 200);
    }

    const quorum = aggregateQuorum(votes, deps.quorumThresholdWeight);
    if (!quorum.reached) {
      record.status = "rejected";
      record.reject_reasons =
        rejectReasons.size > 0 ? [...rejectReasons] : ["quorum_not_reached"];
      return c.json(record, 200);
    }

    record.status = "accepted";

    // Evidence bundle: encrypted off-chain, hash on-chain (POP-008/009).
    const proofCidHash = await deps.storeEvidence({
      schema_version: "step.evidence.bundle.v1",
      claim_hash: ch,
      claim,
      validator_signatures: quorum.sortedApprovals,
      created_at: new Date().toISOString(),
    });

    try {
      const txHash = claim.campaign_id
        ? await deps.submitSponsored({
            claimHash: ch,
            triangleIdHash: th,
            campaignId: claim.campaign_id as Hex,
            miner: record.miner,
            proofCidHash,
            sortedApprovals: quorum.sortedApprovals,
          })
        : await deps.submitNatural({
            claimHash: ch,
            triangleIdHash: th,
            meshLevel: claim.mesh_level,
            miner: record.miner,
            proofCidHash,
            sortedApprovals: quorum.sortedApprovals,
          });
      record.status = "finalised";
      record.tx_hash = txHash;
      record.finalised_at = new Date().toISOString();
    } catch (err) {
      // Contract is the final authority: a revert (exhausted slot, frozen
      // triangle, campaign rules…) rejects the claim with the revert detail.
      record.status = "rejected";
      record.reject_reasons = [
        `chain_revert:${err instanceof Error ? err.message.slice(0, 200) : "unknown"}`,
      ];
    }
    return c.json(record, 200);
  });

  app.get("/v1/claims/:hash", (c) => {
    const record = records.get(c.req.param("hash") as Hex);
    if (!record) return c.json({ error: "unknown claim" }, 404);
    return c.json(record);
  });

  return { app, records };
}
