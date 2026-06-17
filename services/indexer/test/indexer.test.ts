/**
 * Projection tests: decoded events apply correctly; decode round-trip via
 * viem-encoded logs; API responses (test plan §2.7).
 */
import { describe, expect, it } from "vitest";
import { encodeEventTopics, encodeAbiParameters, type Log } from "viem";
import { MiningClaimVerifierAbi } from "@step/shared-types/abis";
import type { Hex } from "@step/shared-types";
import { MemoryStore } from "../src/store.js";
import { applyEvent, decodeLogs, type DecodedEvent } from "../src/events.js";
import { createApi } from "../src/api.js";

const TRI = ("0x" + "aa".repeat(32)) as Hex;
const MINER = "0x17c5185167401ed00cf5f5b2fc97d9bbfdb7d025" as const;
const TX = ("0x" + "bb".repeat(32)) as Hex;

function mined(slot: number, amount: bigint, claim: string): DecodedEvent {
  return {
    eventName: "TriangleMined",
    args: {
      triangleId: TRI,
      miner: MINER,
      slot: BigInt(slot),
      trinityAmount: amount,
      proofHash: ("0x" + claim.padStart(64, "0")) as Hex,
    },
    blockNumber: 10n + BigInt(slot),
    transactionHash: TX,
  };
}

describe("event projection", () => {
  it("projects natural mining, twin, freeze, campaign lifecycle", () => {
    const store = new MemoryStore();
    applyEvent(store, mined(0, 100n, "01"));
    applyEvent(store, mined(1, 50n, "02"));
    applyEvent(store, {
      eventName: "FoundationTwinAllocated",
      args: { claimHash: "0x01", trinityAmount: 150n },
      blockNumber: 12n,
      transactionHash: TX,
    });
    applyEvent(store, {
      eventName: "TriangleFrozen",
      args: { triangleId: TRI, reasonCode: ("0x" + "11".repeat(32)) as Hex },
      blockNumber: 13n,
      transactionHash: TX,
    });

    const tri = store.triangle(TRI);
    expect(tri.used_slots).toBe(2);
    expect(tri.total_mined_trinity).toBe(150n);
    expect(tri.frozen).toBe(true);
    expect(store.treasury.total_twin_minted).toBe(150n);
    // Supply stat = natural mints + twin (mirrors the contract invariant).
    expect(store.stats().total_supply).toBe(300n);
    expect(store.stats().last_block).toBe(13n);

    const campaignId = ("0x" + "cc".repeat(32)) as Hex;
    applyEvent(store, {
      eventName: "CampaignCreated",
      args: { campaignId, merchant: MINER, triangleIds: [TRI] },
      blockNumber: 14n,
      transactionHash: TX,
    });
    applyEvent(store, {
      eventName: "OasisFunded",
      args: { campaignId, trinityAmount: 500n, newBudget: 500n },
      blockNumber: 15n,
      transactionHash: TX,
    });
    applyEvent(store, {
      eventName: "SponsoredRewardClaimed",
      args: {
        campaignId,
        miner: MINER,
        trinityAmount: 100n,
        proofHash: ("0x" + "03".padStart(64, "0")) as Hex,
      },
      blockNumber: 16n,
      transactionHash: TX,
    });
    const campaign = store.campaign(campaignId);
    expect(campaign.budget).toBe(500n);
    expect(campaign.verified_visits).toBe(1);
    expect(campaign.released).toBe(100n);
    expect(store.triangle(TRI).oasis_campaigns).toContain(campaignId);
    // Sponsored claims do not add to supply.
    expect(store.stats().total_supply).toBe(300n);
  });

  it("decodes a real viem-encoded TriangleMined log", () => {
    const topics = encodeEventTopics({
      abi: MiningClaimVerifierAbi,
      eventName: "TriangleMined",
      args: { triangleId: TRI, miner: MINER },
    });
    const data = encodeAbiParameters(
      [{ type: "uint256" }, { type: "uint256" }, { type: "bytes32" }],
      [3n, 8_388_608n, ("0x" + "04".padStart(64, "0")) as Hex],
    );
    const log = {
      address: "0x0000000000000000000000000000000000000001",
      topics,
      data,
      blockNumber: 42n,
      transactionHash: TX,
      logIndex: 0,
      blockHash: TX,
      transactionIndex: 0,
      removed: false,
    } as unknown as Log;

    const [decoded] = decodeLogs([log]);
    expect(decoded?.eventName).toBe("TriangleMined");
    expect(decoded?.args.slot).toBe(3n);
    expect(decoded?.args.trinityAmount).toBe(8_388_608n);

    const store = new MemoryStore();
    applyEvent(store, decoded!);
    expect(store.triangle(TRI).used_slots).toBe(4);
  });
});

describe("explorer API", () => {
  it("serves triangles, claims, treasury, stats", async () => {
    const store = new MemoryStore();
    applyEvent(store, mined(0, 100n, "01"));
    const api = createApi(store);

    const tri = await api.request(`/v1/triangles/${TRI}`);
    expect(tri.status).toBe(200);
    expect(((await tri.json()) as any).used_slots).toBe(1);

    const claim = await api.request(`/v1/claims/0x${"01".padStart(64, "0")}`);
    expect(claim.status).toBe(200);
    expect(((await claim.json()) as any).trinity_amount).toBe("100");

    expect((await api.request("/v1/triangles/0xdead")).status).toBe(404);
    const stats = await (await api.request("/v1/stats")).json() as any;
    expect(stats.claims_finalised).toBe(1);
  });
});

describe("mesh oasis/desert states (#16)", () => {
  const TRI2 = ("0x" + "cd".repeat(32)) as Hex;

  it("classifies oasis / filling / desert by slot depletion", async () => {
    const store = new MemoryStore();
    // TRI: 2 of 4 slots used → filling (depletion 0.5).
    applyEvent(store, mined(0, 100n, "01"));
    applyEvent(store, mined(1, 50n, "02"));
    const api = createApi(store, [], { totalSlots: 4 });

    const single = await (await api.request(`/v1/mesh-states/${TRI}`)).json() as any;
    expect(single.used_slots).toBe(2);
    expect(single.total_slots).toBe(4);
    expect(single.depletion).toBe(0.5);
    expect(single.state).toBe("filling");

    // Unmined triangle → full oasis, 200 (not 404).
    const oasisResp = await api.request(`/v1/mesh-states/${TRI2}`);
    expect(oasisResp.status).toBe(200);
    const oasis = await oasisResp.json() as any;
    expect(oasis.used_slots).toBe(0);
    expect(oasis.depletion).toBe(0);
    expect(oasis.state).toBe("oasis");
  });

  it("marks a fully-mined triangle as desert and caps depletion at 1", async () => {
    const store = new MemoryStore();
    for (let s = 0; s < 4; s++) applyEvent(store, mined(s, 10n, String(s + 1)));
    const api = createApi(store, [], { totalSlots: 4 });
    const d = await (await api.request(`/v1/mesh-states/${TRI}`)).json() as any;
    expect(d.used_slots).toBe(4);
    expect(d.depletion).toBe(1);
    expect(d.state).toBe("desert");
  });

  it("returns batch states for a viewport and validates input", async () => {
    const store = new MemoryStore();
    applyEvent(store, mined(0, 100n, "01"));
    const api = createApi(store, [], { totalSlots: 27 });

    const ok = await api.request("/v1/mesh-states", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ triangle_id_hashes: [TRI, TRI2] }),
    });
    expect(ok.status).toBe(200);
    const body = await ok.json() as any;
    expect(body.total_slots).toBe(27);
    expect(body.states).toHaveLength(2);
    expect(body.states[0].triangle_id_hash.toLowerCase()).toBe(TRI.toLowerCase());
    expect(body.states[1].state).toBe("oasis");

    // Bad hash → 400.
    const bad = await api.request("/v1/mesh-states", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ triangle_id_hashes: ["0xnothex"] }),
    });
    expect(bad.status).toBe(400);

    // Non-array → 400.
    const bad2 = await api.request("/v1/mesh-states", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ triangle_id_hashes: "nope" }),
    });
    expect(bad2.status).toBe(400);
  });
});
