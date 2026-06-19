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
import { cors } from "hono/cors";
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

function shorten(str: string, maxLen = 180) {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen);
}

function extractRevertReason(error: unknown): string {
  const raw =
    error instanceof Error ? error.message : typeof error === "string" ? error : JSON.stringify(error ?? "");

  const direct = raw.match(/reverted with the following reason: ([^\n]+)/);
  if (direct && direct[1]) return direct[1].trim();

  // viem custom-error format: "...reverted with the following signature:" or
  // "...custom error 'ErrorName(args)'". Capture the error name directly.
  const custom = raw.match(/custom error ['"`]?([A-Za-z_][A-Za-z0-9_]*)/);
  if (custom && custom[1]) return custom[1];

  const known = raw.match(
    /\b(ClaimAlreadyFinalised|TriangleIdMalformed|TriangleLevelMismatch|ParentTriangleNotExhausted|TriangleBlocked|AccuracyTooLow|BoundaryAmbiguous|NonceRejected|WalletAlreadyMined|TriangleNotOpen|ParentNotExhausted|ClaimNotFound)\b/,
  );
  if (known && known[1]) return known[1];

  const nested = raw.match(/\breason=([A-Za-z0-9_]+)\b/);
  if (nested && nested[1]) return nested[1];

  const fallback = raw.match(/\b([A-Z][A-Za-z0-9_]+)\b/);
  if (fallback && fallback[1]) {
    return fallback[1];
  }

  return raw.trim();
}

export interface GatewayDeps {
  nonceSecret: string;
  nonceTtlSeconds: number;
  quorumThresholdWeight: bigint;
  validatorUrls: string[];
  /** Current validator endpoints for fan-out. Defaults to `validatorUrls`, but a
   *  deployment can supply a live view (e.g. a node directory that trust-center
   *  nodes join) so an added node participates without restarting the gateway. */
  listValidatorUrls?(): string[] | Promise<string[]>;
  /** POST a claim to one validator node, returns its signed vote. */
  validate(url: string, claim: Claim): Promise<ValidateResponse>;
  /** On-chain active weight for a validator (ValidatorRegistry.activeWeight). */
  weightOf(validator: Address): Promise<bigint>;
  /** Submit finaliseNaturalClaim; resolves to the tx hash after inclusion. */
  submitNatural(args: {
    claimHash: Hex;
    triangleId: string;
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
  /** Allowed browser origins for static frontends (GitHub Pages/Cloudflare Pages). */
  corsOrigins?: string[];
  /** Optional mesh API URL; defaults to the first validator URL. */
  meshUrl?: string;
}

export function createApp(deps: GatewayDeps) {
  const app = new Hono();
  const records = new Map<string, ClaimRecord>();
  const meshUrl = deps.meshUrl ?? deps.validatorUrls[0];

  if (deps.corsOrigins?.length) {
    app.use(
      "*",
      cors({
        origin: deps.corsOrigins,
        allowMethods: ["GET", "POST", "OPTIONS"],
        allowHeaders: ["content-type"],
      }),
    );
  }

  app.get("/healthz", (c) => c.text("ok"));

  app.get("/v1/mesh/resolve", async (c) => {
    if (!meshUrl) return c.json({ error: "mesh API unavailable" }, 503);
    const url = new URL(`${meshUrl}/v1/mesh/resolve`);
    for (const key of ["lat", "lon", "level"]) {
      const value = c.req.query(key);
      if (value !== undefined) url.searchParams.set(key, value);
    }
    const resp = await fetch(url);
    return c.json(await resp.json(), resp.status as never);
  });

  app.get("/v1/mesh/triangle/:id", async (c) => {
    if (!meshUrl) return c.json({ error: "mesh API unavailable" }, 503);
    const resp = await fetch(`${meshUrl}/v1/mesh/triangle/${c.req.param("id")}`);
    return c.json(await resp.json(), resp.status as never);
  });

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

    // Fan out to the current federation in parallel; tolerate node failures
    // (quorum decides, not availability of every node). The validator set is the
    // live directory when provided, so trust-center nodes that joined since
    // startup are included.
    const validatorUrls = deps.listValidatorUrls
      ? await deps.listValidatorUrls()
      : deps.validatorUrls;
    const results = await Promise.allSettled(
      validatorUrls.map((url) => deps.validate(url, claim)),
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

    if (!votesAreConsistent(votes.map((v) => v.vote), ch, record.triangle_id_hash, record.miner)) {
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
            triangleId: claim.triangle_id,
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
      const chainReason = extractRevertReason(err);
      record.status = "rejected";
      record.reject_reasons = [
        `chain_revert:${shorten(chainReason, 220)}`,
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
