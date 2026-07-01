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
import { RateLimiter } from "./ratelimit.js";

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

/** 0x + 32-byte hex — the on-chain form for a campaign id / hash. Guards the
 *  unchecked `as Hex` casts before a value reaches a chain call. */
function isHex32(v: unknown): v is Hex {
  return typeof v === "string" && /^0x[0-9a-fA-F]{64}$/.test(v);
}

/** Mesh ID v2 terminal level is 21; reject out-of-range before any chain work. */
function isValidMeshLevel(level: unknown): level is number {
  return typeof level === "number" && Number.isInteger(level) && level >= 1 && level <= 21;
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
    /\b(ClaimAlreadyFinalised|TriangleIdMalformed|TriangleLevelMismatch|ParentTriangleNotExhausted|TriangleBlocked|AccuracyTooLow|BoundaryAmbiguous|NonceRejected|WalletAlreadyMined|TriangleNotOpen|ParentNotExhausted|ClaimNotFound|PairingExpired|PairingReplay|InvalidOwnerSignature|NodeAlreadyOwned|NotNodeOwner|RevokedNode|ZeroAddress)\b/,
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

export type TrustCenterNodeStatus = "none" | "pending" | "active" | "suspended" | "revoked";

export interface TrustCenterStatusRecord {
  nodeAddress: Address;
  ownerWallet?: Address;
  rewardRecipient?: Address;
  status: TrustCenterNodeStatus;
  activeWeight?: string;
  nextAction: string;
}

export interface TrustCenterPairRequest {
  type: "step.trustcenter.pair";
  version: 1;
  nodeAddress: Address;
  ownerWallet: Address;
  challenge: Hex;
  expiresAt: number;
  signature: Hex;
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
  /** On-chain `TriangleMiningState.status(keccak256(id))` for a triangle id, as the
   *  raw enum index (0 Locked, 1 Open, 2 Cooldown, 3 Exhausted). Used to resolve
   *  the mineable frontier. Optional: when absent, the frontier endpoint is off. */
  triangleStatus?(triangleId: string): Promise<number>;
  /** Abuse controls for public exposure (#61/#65). Absent ⇒ limits off (trusted LAN). */
  trustCenters?: {
    pairNode(req: TrustCenterPairRequest): Promise<Hex>;
    status(nodeAddress: Address): Promise<TrustCenterStatusRecord>;
  };
  rateLimit?: {
    nowMs(): number;
    ipPerMin?: number;
    walletPerMin?: number;
    frontierPerMin?: number;
    frontierCacheTtlMs?: number;
    /** relayer balance read + floor: below it, submission is paused (fail-closed). */
    relayerBalanceWei?(): Promise<bigint>;
    relayerMinBalanceWei?: bigint;
  };
}

/** Best-effort client IP behind the Cloudflare tunnel; never trust a client-set value
 *  for anything but rate-limit keying. */
function clientIp(c: { req: { header(name: string): string | undefined } }): string {
  return (
    c.req.header("cf-connecting-ip") ||
    (c.req.header("x-forwarded-for") || "").split(",")[0]?.trim() ||
    "unknown"
  );
}

/** TriangleStatus enum index → name (TriangleMiningState.sol). */
const TRIANGLE_STATUS = ["Locked", "Open", "Cooldown", "Exhausted"] as const;

export function createApp(deps: GatewayDeps) {
  const app = new Hono();
  const records = new Map<string, ClaimRecord>();
  const meshUrl = deps.meshUrl ?? deps.validatorUrls[0];

  // Abuse controls (#61/#65). Per-minute → tokens with refill = perMin/60.
  const rl = deps.rateLimit;
  const ipClaim = rl?.ipPerMin ? new RateLimiter(rl.ipPerMin, rl.ipPerMin / 60) : null;
  const walletClaim = rl?.walletPerMin ? new RateLimiter(rl.walletPerMin, rl.walletPerMin / 60) : null;
  const ipFrontier = rl?.frontierPerMin ? new RateLimiter(rl.frontierPerMin, rl.frontierPerMin / 60) : null;
  const frontierCache = new Map<string, { status: number; expiresAt: number }>();
  const now = () => rl?.nowMs() ?? Date.now();

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


  app.post("/v1/trust-centers/pair", async (c) => {
    if (!deps.trustCenters) return c.json({ error: "trust center pairing unavailable" }, 503);
    const body = (await c.req.json().catch(() => null)) as Partial<TrustCenterPairRequest> | null;
    const nodeAddress = body?.nodeAddress?.toLowerCase() as Address | undefined;
    const ownerWallet = body?.ownerWallet?.toLowerCase() as Address | undefined;
    const challenge = body?.challenge as Hex | undefined;
    const signature = body?.signature as Hex | undefined;
    const expiresAt = Number(body?.expiresAt ?? 0);
    if (body?.type !== "step.trustcenter.pair" || body?.version !== 1) {
      return c.json({ error: "invalid_pairing_payload", nextAction: "scan_or_paste_new_pairing_payload" }, 400);
    }
    if (!nodeAddress || !/^0x[0-9a-f]{40}$/.test(nodeAddress)) {
      return c.json({ error: "invalid_node_address", nextAction: "retry_provisioning" }, 400);
    }
    if (!ownerWallet || !/^0x[0-9a-f]{40}$/.test(ownerWallet)) {
      return c.json({ error: "invalid_owner_wallet", nextAction: "unlock_wallet" }, 400);
    }
    if (!challenge || !/^0x[0-9a-fA-F]{64}$/.test(challenge)) {
      return c.json({ error: "invalid_challenge", nextAction: "scan_or_paste_new_pairing_payload" }, 400);
    }
    if (!signature || !/^0x[0-9a-fA-F]+$/.test(signature)) {
      return c.json({ error: "invalid_signature", nextAction: "sign_pairing_in_wallet" }, 400);
    }
    if (!Number.isFinite(expiresAt) || expiresAt <= deps.nowUnix()) {
      return c.json({ error: "pairing_expired", nextAction: "run_step_trustcenter_provision_again" }, 400);
    }
    const req: TrustCenterPairRequest = {
      type: "step.trustcenter.pair",
      version: 1,
      nodeAddress,
      ownerWallet,
      challenge,
      expiresAt,
      signature,
    };
    try {
      const txHash = await deps.trustCenters.pairNode(req);
      const status = await deps.trustCenters.status(nodeAddress);
      return c.json({ ...status, txHash, nextAction: status.nextAction }, 200);
    } catch (err) {
      return c.json({ error: `chain_revert:${shorten(extractRevertReason(err), 220)}`, nextAction: "retry_or_contact_support" }, 409);
    }
  });

  app.get("/v1/trust-centers/:nodeAddress", async (c) => {
    if (!deps.trustCenters) return c.json({ error: "trust center registry unavailable" }, 503);
    const nodeAddress = c.req.param("nodeAddress").toLowerCase() as Address;
    if (!/^0x[0-9a-f]{40}$/.test(nodeAddress)) return c.json({ error: "invalid_node_address" }, 400);
    return c.json(await deps.trustCenters.status(nodeAddress));
  });

  app.get("/v1/trust-centers/:nodeAddress/onboarding-status", async (c) => {
    if (!deps.trustCenters) return c.json({ error: "trust center registry unavailable" }, 503);
    const nodeAddress = c.req.param("nodeAddress").toLowerCase() as Address;
    if (!/^0x[0-9a-f]{40}$/.test(nodeAddress)) return c.json({ error: "invalid_node_address" }, 400);
    return c.json(await deps.trustCenters.status(nodeAddress));
  });

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

  app.get("/v1/mesh/cover", async (c) => {
    if (!meshUrl) return c.json({ error: "mesh API unavailable" }, 503);
    const url = new URL(`${meshUrl}/v1/mesh/cover`);
    for (const key of ["minLat", "minLon", "maxLat", "maxLon", "level", "max"]) {
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

  // Mining frontier (Mesh ID v2): a location resolves to a level-21 triangle, but
  // a triangle at level N>1 is only mineable once its parent is Exhausted (genesis
  // level 1 has no parent). The miner must therefore mine the deepest currently-
  // mineable ANCESTOR of its location — the shallowest ancestor that is not yet
  // Exhausted. This walks that ancestor chain and returns it, so web/iOS miners
  // (and the validator/contract) agree on what to mine instead of guessing L21.
  app.get("/v1/mesh/mineable", async (c) => {
    if (!meshUrl) return c.json({ error: "mesh API unavailable" }, 503);
    if (!deps.triangleStatus) return c.json({ error: "frontier resolver unavailable" }, 503);
    // #65: rate-limit (1 request fans into up to 21 chain reads) + numeric coord guard.
    if (ipFrontier) {
      const g = ipFrontier.take(clientIp(c), now());
      if (!g.allowed) return c.json({ error: "rate limited", retry_after_s: g.retryAfterS }, 429);
    }
    const lat = Number(c.req.query("lat")), lon = Number(c.req.query("lon"));
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
      return c.json({ error: "lat/lon must be valid coordinates" }, 400);
    }
    const url = new URL(`${meshUrl}/v1/mesh/resolve`);
    url.searchParams.set("lat", String(lat));
    url.searchParams.set("lon", String(lon));
    url.searchParams.set("level", "21");
    const resp = await fetch(url);
    if (!resp.ok) return c.json({ error: "mesh resolve failed" }, 502);
    const resolved = (await resp.json()) as { triangle_id?: string };
    const full = resolved.triangle_id;
    if (!full) return c.json({ error: "no triangle for location" }, 404);

    // #65: cache status reads (status changes slowly; the contract re-checks on submit).
    const ttl = rl?.frontierCacheTtlMs ?? 0;
    const statusOf = async (id: string): Promise<number> => {
      if (ttl > 0) {
        const hit = frontierCache.get(id);
        if (hit && hit.expiresAt > now()) return hit.status;
        const s = await deps.triangleStatus!(id);
        frontierCache.set(id, { status: s, expiresAt: now() + ttl });
        return s;
      }
      return deps.triangleStatus!(id);
    };

    const segs = full.split(".");
    for (let level = 1; level <= segs.length; level++) {
      const triangleId = segs.slice(0, level).join(".");
      const status = await statusOf(triangleId);
      if (status !== 3 /* Exhausted */) {
        return c.json({
          triangle_id: triangleId,
          level,
          status: TRIANGLE_STATUS[status] ?? "Unknown",
          mineable: status === 1 /* Open */,
          location_triangle_id: full,
        });
      }
    }
    // Whole ancestor chain exhausted → this location is fully mined.
    return c.json({
      triangle_id: full,
      level: segs.length,
      status: "Exhausted",
      mineable: false,
      fully_mined: true,
      location_triangle_id: full,
    });
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
    // #61: per-IP rate limit before any work (cheap to flood otherwise).
    if (ipClaim) {
      const g = ipClaim.take(clientIp(c), now());
      if (!g.allowed) return c.json({ error: "rate limited", retry_after_s: g.retryAfterS }, 429);
    }
    const body = await c.req.json().catch(() => null);
    const claim = body?.claim as Claim | undefined;
    if (!claim || claim.schema_version !== "step.proof.location.v1") {
      return c.json({ error: "claim with schema step.proof.location.v1 required" }, 400);
    }
    // Reject malformed fields at intake rather than relying solely on a contract
    // revert: a bad campaign_id would be cast blindly to Hex, and an out-of-range
    // mesh_level would waste validator + gas work.
    if (claim.campaign_id !== undefined && !isHex32(claim.campaign_id)) {
      return c.json({ error: "invalid_campaign_id" }, 400);
    }
    if (!isValidMeshLevel(claim.mesh_level)) {
      return c.json({ error: "invalid_mesh_level" }, 400);
    }
    // #61: per-wallet rate limit (the stronger control behind a shared tunnel IP).
    if (walletClaim && claim.wallet_address) {
      const g = walletClaim.take(claim.wallet_address.toLowerCase(), now());
      if (!g.allowed) return c.json({ error: "rate limited", retry_after_s: g.retryAfterS }, 429);
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

    // #61: relayer gas-drain guard — pause on-chain submission (fail-closed) when
    // the relayer balance is at/below the floor, rather than burning the last gas
    // or letting a balance-read error submit blindly. The accepted claim is held;
    // a resubmit succeeds once the relayer is refunded.
    if (rl?.relayerBalanceWei && rl.relayerMinBalanceWei !== undefined) {
      let balance: bigint;
      try {
        balance = await rl.relayerBalanceWei();
      } catch {
        balance = 0n; // read failed ⇒ treat as empty (fail-closed)
      }
      if (balance <= rl.relayerMinBalanceWei) {
        record.status = "validating"; // not finalised; retryable
        return c.json({ ...record, error: "submission paused (relayer balance low)" }, 503);
      }
    }

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

  // Peer-native finalisation endpoint for `step-gossip-node`.
  //
  // A gossip node validates a claim locally, gossips the signed vote, aggregates
  // a weighted quorum of peer votes, then posts the complete bundle here. This
  // endpoint does NOT fan out to validators again and does NOT trust the gossip
  // node's reported total weight. It recomputes claim identity, signature
  // consistency, active weights, evidence storage, and lets the contract perform
  // the final verification.
  app.post("/v1/gossip/finalise", async (c) => {
    const body = (await c.req.json().catch(() => null)) as
      | { claim?: Claim; approvals?: SignedVote[] }
      | null;
    const claim = body?.claim;
    const approvals = body?.approvals ?? [];
    if (!claim || claim.schema_version !== "step.proof.location.v1") {
      return c.json({ error: "claim with schema step.proof.location.v1 required" }, 400);
    }
    if (!Array.isArray(approvals) || approvals.length === 0) {
      return c.json({ error: "approval votes required" }, 400);
    }
    if (claim.campaign_id !== undefined && !isHex32(claim.campaign_id)) {
      return c.json({ error: "invalid_campaign_id" }, 400);
    }

    const ch = claimHash(canonicalClaimMessage(claim));
    const th = triangleIdHash(claim.triangle_id);
    const miner = claim.wallet_address.toLowerCase() as Address;
    const existing = records.get(ch);
    if (existing?.status === "finalised") return c.json(existing, 200);

    const record: ClaimRecord =
      existing ?? {
        claim_hash: ch,
        triangle_id: claim.triangle_id,
        triangle_id_hash: th,
        miner,
        campaign_id: claim.campaign_id,
        status: "validating",
        reject_reasons: [],
        votes: [],
        submitted_at: new Date().toISOString(),
      };
    records.set(ch, record);

    if (!votesAreConsistent(approvals, ch, th, miner)) {
      record.status = "rejected";
      record.reject_reasons = ["inconsistent_votes"];
      return c.json(record, 200);
    }
    // A consistent set of all-rejection votes must not be able to reach quorum
    // and post an (incorrect) on-chain result — require at least one approval.
    if (!approvals.some((v) => v.approve)) {
      record.status = "rejected";
      record.reject_reasons = ["no_approval_votes"];
      return c.json(record, 200);
    }

    const votes: WeightedVote[] = [];
    record.votes = [];
    for (const vote of approvals) {
      const weight = await deps.weightOf(vote.validator);
      votes.push({ vote, weight });
      record.votes.push({
        validator: vote.validator,
        approve: vote.approve,
        weight: weight.toString(),
      });
    }
    const quorum = aggregateQuorum(votes, deps.quorumThresholdWeight);
    if (!quorum.reached) {
      record.status = "rejected";
      record.reject_reasons = ["quorum_not_reached"];
      return c.json(record, 200);
    }

    if (deps.rateLimit?.relayerBalanceWei && deps.rateLimit.relayerMinBalanceWei !== undefined) {
      let balance: bigint;
      try {
        balance = await deps.rateLimit.relayerBalanceWei();
      } catch {
        balance = 0n;
      }
      if (balance <= deps.rateLimit.relayerMinBalanceWei) {
        record.status = "validating";
        return c.json({ ...record, error: "submission paused (relayer balance low)" }, 503);
      }
    }

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
            miner,
            proofCidHash,
            sortedApprovals: quorum.sortedApprovals,
          })
        : await deps.submitNatural({
            claimHash: ch,
            triangleId: claim.triangle_id,
            triangleIdHash: th,
            meshLevel: claim.mesh_level,
            miner,
            proofCidHash,
            sortedApprovals: quorum.sortedApprovals,
          });
      record.status = "finalised";
      record.tx_hash = txHash;
      record.finalised_at = new Date().toISOString();
      record.reject_reasons = [];
    } catch (err) {
      record.status = "rejected";
      record.reject_reasons = [`chain_revert:${shorten(extractRevertReason(err), 220)}`];
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
