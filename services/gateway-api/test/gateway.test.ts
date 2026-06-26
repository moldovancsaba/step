/**
 * Gateway orchestration tests with injected transports (unit scope — the real
 * iPhone→validator→chain path is tests/e2e). Covers: nonce issuance, quorum
 * routing, validator-failure tolerance, idempotent resubmission, chain-revert
 * handling, sponsored-path routing.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  canonicalClaimMessage,
  claimHash,
  personalDigest,
  triangleIdHash,
  voteDigest,
  type Claim,
  type Hex,
  type SignedVote,
  type ValidateResponse,
} from "@step/shared-types";
import { privateKeyToAccount } from "viem/accounts";
import { createApp, type GatewayDeps } from "../src/app.js";
import { aggregateQuorum } from "../src/quorum.js";

const VERIFIER = "0x610178dA211FEF7D417bC0e6FeD39F05609AD788" as const;
const miner = privateKeyToAccount(
  "0x4242424242424242424242424242424242424242424242424242424242424242",
);
const validatorKeys = [
  "0x1111111111111111111111111111111111111111111111111111111111111111",
  "0x2222222222222222222222222222222222222222222222222222222222222222",
  "0x3333333333333333333333333333333333333333333333333333333333333333",
] as const;
const validators = validatorKeys.map((k) => privateKeyToAccount(k));

async function buildClaim(overrides: Partial<Claim> = {}): Promise<Claim> {
  const base: Omit<Claim, "signature"> = {
    schema_version: "step.proof.location.v1",
    wallet_address: miner.address,
    triangle_id: "STEP-21-F00-12203302320201311132",
    mesh_level: 21,
    latitude: 47.4979,
    longitude: 19.0402,
    horizontal_accuracy_m: 5,
    timestamp_utc: new Date().toISOString().replace(/\.\d+Z$/, "Z"),
    nonce: "aabbccddeeff0011:2000000000:cafe0123.0000111122223333aaaabbbbccccdddd",
    integrity_mode: "dev-unattested",
    ...overrides,
  };
  const signature = await miner.sign({
    hash: personalDigest(canonicalClaimMessage(base)),
  });
  return { ...base, ...overrides, signature } as Claim;
}

/** A fake validator node that actually signs real EIP-712 votes. */
function fakeValidator(index: number, approve: boolean) {
  return async (claim: Claim): Promise<ValidateResponse> => {
    const ch = claimHash(canonicalClaimMessage(claim));
    const th = triangleIdHash(claim.triangle_id);
    const account = validators[index]!;
    const digest = voteDigest(31337n, VERIFIER, ch, th, claim.wallet_address, approve);
    const signature = await account.sign({ hash: digest });
    return {
      verdict: {
        approve,
        reject_reasons: approve ? [] : ["fraud_score_too_high"],
        fraud: { score: approve ? 0 : 1, signals: [] },
        boundary: "inside",
      },
      vote: {
        validator: account.address,
        signature,
        claim_hash: ch,
        triangle_id_hash: th,
        miner: claim.wallet_address.toLowerCase() as `0x${string}`,
        approve,
      },
      validated_at: new Date().toISOString(),
    };
  };
}

function makeDeps(behaviour: {
  validatorApproves: boolean[];
  weight?: bigint;
  failNode?: number;
  chainReverts?: boolean;
}) {
  const submitNatural = vi.fn(async () => {
    if (behaviour.chainReverts) throw new Error("TriangleNotOpen");
    return ("0x" + "ab".repeat(32)) as Hex;
  });
  const submitSponsored = vi.fn(async () => ("0x" + "cd".repeat(32)) as Hex);
  const storeEvidence = vi.fn(async () => ("0x" + "ee".repeat(32)) as Hex);
  const deps: GatewayDeps = {
    nonceSecret: "gw-test-secret",
    nonceTtlSeconds: 120,
    quorumThresholdWeight: 101n,
    validatorUrls: behaviour.validatorApproves.map((_, i) => `http://validator-${i}`),
    async validate(url, claim) {
      const i = Number(url.split("-")[1]);
      if (behaviour.failNode === i) throw new Error("connection refused");
      return fakeValidator(i, behaviour.validatorApproves[i]!)(claim);
    },
    weightOf: async () => behaviour.weight ?? 50n,
    submitNatural,
    submitSponsored,
    storeEvidence,
    randomHex: () => "cafe0123",
    nowUnix: () => 1_900_000_000,
  };
  return { deps, submitNatural, submitSponsored, storeEvidence };
}

describe("mining frontier (/v1/mesh/mineable)", () => {
  afterEach(() => vi.unstubAllGlobals());
  // a 4-segment location id is enough to exercise the ancestor walk
  const LOC = "1.2.3.4";

  function frontierApp(statusByLevel: number[]) {
    const { deps } = makeDeps({ validatorApproves: [true] });
    const calls: string[] = [];
    deps.meshUrl = "http://mesh";
    deps.triangleStatus = async (id: string) => {
      calls.push(id);
      return statusByLevel[id.split(".").length - 1] ?? 1;
    };
    // Mesh resolve returns the full level-21-style location id.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => ({ triangle_id: LOC }) }) as unknown as Response),
    );
    const { app } = createApp(deps);
    return { app, calls };
  }

  it("returns the level-1 genesis triangle on a fresh mesh (all Open)", async () => {
    const { app } = frontierApp([1, 1, 1, 1]); // Open everywhere
    const resp = await app.request("/v1/mesh/mineable?lat=47.5&lon=19.0");
    expect(resp.status).toBe(200);
    const body = (await resp.json()) as { triangle_id: string; level: number; mineable: boolean };
    expect(body).toMatchObject({ triangle_id: "1", level: 1, mineable: true });
  });

  it("descends past Exhausted ancestors to the first non-exhausted one", async () => {
    // L1 + L2 Exhausted(3), L3 Open(1) ⇒ frontier is the level-3 ancestor
    const { app } = frontierApp([3, 3, 1, 1]);
    const resp = await app.request("/v1/mesh/mineable?lat=47.5&lon=19.0");
    const body = (await resp.json()) as { triangle_id: string; level: number; mineable: boolean };
    expect(body).toMatchObject({ triangle_id: "1.2.3", level: 3, mineable: true });
  });

  it("reports a Locked frontier as not yet mineable", async () => {
    const { app } = frontierApp([3, 0, 1, 1]); // L1 Exhausted, L2 Locked(0)
    const resp = await app.request("/v1/mesh/mineable?lat=47.5&lon=19.0");
    const body = (await resp.json()) as { level: number; status: string; mineable: boolean };
    expect(body).toMatchObject({ level: 2, status: "Locked", mineable: false });
  });

  it("reports fully_mined when the whole ancestor chain is Exhausted", async () => {
    const { app } = frontierApp([3, 3, 3, 3]);
    const resp = await app.request("/v1/mesh/mineable?lat=47.5&lon=19.0");
    const body = (await resp.json()) as { fully_mined?: boolean; mineable: boolean };
    expect(body.fully_mined).toBe(true);
    expect(body.mineable).toBe(false);
  });
});

describe("nonce issuance", () => {
  it("issues wallet-bound nonces with TTL", async () => {
    const { deps } = makeDeps({ validatorApproves: [true, true, true] });
    const { app } = createApp(deps);
    const resp = await app.request("/v1/nonce", {
      method: "POST",
      body: JSON.stringify({ wallet: miner.address }),
      headers: { "content-type": "application/json" },
    });
    expect(resp.status).toBe(200);
    const json = await resp.json() as any;
    expect(json.expires_at_unix).toBe(1_900_000_120);
    expect(json.nonce).toContain(miner.address.slice(2).toLowerCase());
    expect(json.nonce.length).toBeLessThanOrEqual(128); // schema bound
    const bad = await app.request("/v1/nonce", {
      method: "POST",
      body: JSON.stringify({ wallet: "nope" }),
      headers: { "content-type": "application/json" },
    });
    expect(bad.status).toBe(400);
  });
});

describe("claim orchestration", () => {
  let claim: Claim;
  beforeEach(async () => {
    claim = await buildClaim();
  });

  it("finalises with quorum (3 of 3 × weight 50 ≥ 101)", async () => {
    const { deps, submitNatural, storeEvidence } = makeDeps({
      validatorApproves: [true, true, true],
    });
    const { app } = createApp(deps);
    const resp = await app.request("/v1/claims", {
      method: "POST",
      body: JSON.stringify({ claim }),
      headers: { "content-type": "application/json" },
    });
    const record = await resp.json() as any;
    expect(record.status).toBe("finalised");
    expect(record.tx_hash).toBeDefined();
    expect(submitNatural).toHaveBeenCalledOnce();
    expect(storeEvidence).toHaveBeenCalledOnce();
    // Approvals submitted in ascending validator-address order.
    const submitted = (submitNatural.mock.calls[0] as any)[0].sortedApprovals as SignedVote[];
    const addrs = submitted.map((v) => BigInt(v.validator));
    expect([...addrs].sort((a, b) => (a < b ? -1 : 1))).toEqual(addrs);
  });

  it("rejects when quorum is not reached, with validator reasons", async () => {
    const { deps, submitNatural } = makeDeps({ validatorApproves: [true, false, false] });
    const { app } = createApp(deps);
    const resp = await app.request("/v1/claims", {
      method: "POST",
      body: JSON.stringify({ claim }),
      headers: { "content-type": "application/json" },
    });
    const record = await resp.json() as any;
    expect(record.status).toBe("rejected");
    expect(record.reject_reasons).toContain("fraud_score_too_high");
    expect(submitNatural).not.toHaveBeenCalled();
  });

  it("rejects when a dead validator leaves active approvals below 2/3 + 1", async () => {
    const { deps } = makeDeps({ validatorApproves: [true, true, true], failNode: 2 });
    const { app } = createApp(deps);
    const resp = await app.request("/v1/claims", {
      method: "POST",
      body: JSON.stringify({ claim }),
      headers: { "content-type": "application/json" },
    });
    expect(((await resp.json()) as any).status).toBe("rejected");
  });

  it("is idempotent on resubmission of the same claim", async () => {
    const { deps, submitNatural } = makeDeps({ validatorApproves: [true, true, true] });
    const { app } = createApp(deps);
    const body = { method: "POST", body: JSON.stringify({ claim }), headers: { "content-type": "application/json" } };
    const first = await (await app.request("/v1/claims", body)).json() as any;
    const second = await (await app.request("/v1/claims", body)).json() as any;
    expect(second.claim_hash).toBe(first.claim_hash);
    expect(submitNatural).toHaveBeenCalledOnce();
  });

  it("surfaces chain reverts as rejection with detail", async () => {
    const { deps } = makeDeps({ validatorApproves: [true, true, true], chainReverts: true });
    const { app } = createApp(deps);
    const resp = await app.request("/v1/claims", {
      method: "POST",
      body: JSON.stringify({ claim }),
      headers: { "content-type": "application/json" },
    });
    const record = await resp.json() as any;
    expect(record.status).toBe("rejected");
    expect(record.reject_reasons[0]).toMatch(/^chain_revert:TriangleNotOpen/);
  });

  it("routes sponsored claims to finaliseSponsoredClaim", async () => {
    const sponsored = await buildClaim({
      campaign_id: ("0x" + "55".repeat(32)) as string,
    });
    const { deps, submitSponsored, submitNatural } = makeDeps({
      validatorApproves: [true, true, true],
    });
    const { app } = createApp(deps);
    const resp = await app.request("/v1/claims", {
      method: "POST",
      body: JSON.stringify({ claim: sponsored }),
      headers: { "content-type": "application/json" },
    });
    expect(((await resp.json()) as any).status).toBe("finalised");
    expect(submitSponsored).toHaveBeenCalledOnce();
    expect(submitNatural).not.toHaveBeenCalled();
  });

  it("claim status endpoint returns the record", async () => {
    const { deps } = makeDeps({ validatorApproves: [true, true, true] });
    const { app } = createApp(deps);
    const record = await (
      await app.request("/v1/claims", {
        method: "POST",
        body: JSON.stringify({ claim }),
        headers: { "content-type": "application/json" },
      })
    ).json() as any;
    const status = await app.request(`/v1/claims/${record.claim_hash}`);
    expect(status.status).toBe(200);
    expect(((await status.json()) as any).status).toBe("finalised");
    expect((await app.request("/v1/claims/0xdead")).status).toBe(404);
  });
});

describe("quorum aggregation (pure)", () => {
  it("dedupes validators and sorts by address", () => {
    const mkVote = (validator: string, approve = true): SignedVote => ({
      validator: validator as `0x${string}`,
      signature: "0x" as Hex,
      claim_hash: "0x" as Hex,
      triangle_id_hash: "0x" as Hex,
      miner: "0x" as `0x${string}`,
      approve,
    });
    const big = "0xffffffffffffffffffffffffffffffffffffffff";
    const small = "0x0000000000000000000000000000000000000001";
    const result = aggregateQuorum(
      [
        { vote: mkVote(big), weight: 50n },
        { vote: mkVote(small), weight: 50n },
        { vote: mkVote(big), weight: 50n }, // duplicate collapses
        { vote: mkVote("0x00000000000000000000000000000000000000aa", false), weight: 50n },
      ],
      101n,
    );
    expect(result.reached).toBe(false);
    expect(result.totalWeight).toBe(100n);
    expect(result.sortedApprovals.map((v) => v.validator)).toEqual([small, big]);
  });
});
