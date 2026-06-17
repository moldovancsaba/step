/**
 * NFT + marketplace projection tests: synthetic decoded events apply correctly,
 * a real viem-encoded log decodes round-trip, and the API serves ownership,
 * provenance, listings, trades, and ERC-721 metadata.
 */
import { describe, expect, it } from "vitest";
import { encodeEventTopics, encodeAbiParameters, type Log } from "viem";
import type { Address, Hex } from "@step/shared-types";
import { NftStore } from "../src/store.js";
import { applyEvent, decodeLogs, type DecodedEvent } from "../src/events.js";
import { createApi, metadata } from "../src/api.js";
import { TriangleSlotNftEventsAbi } from "../src/abis.js";

const TRI = ("0x" + "aa".repeat(32)) as Hex;
const MINER = "0x17c5185167401ed00cf5f5b2fc97d9bbfdb7d025" as Address;
const BUYER = "0x1111111111111111111111111111111111111111" as Address;
const RECIPIENT = "0x2222222222222222222222222222222222222222" as Address;
const TX = ("0x" + "bb".repeat(32)) as Hex;

function minted(tokenId: bigint, slot: number, miner: Address): DecodedEvent {
  return {
    eventName: "SlotMinted",
    args: { tokenId, triangleIdHash: TRI, slot: BigInt(slot), level: 21n, miner, minedAt: 1_750_000_000n },
    blockNumber: 10n,
    transactionHash: TX,
  };
}

describe("nft projection (#7)", () => {
  it("mints, transfers, and tracks ownership + immutable provenance", () => {
    const store = new NftStore();
    applyEvent(store, minted(1n, 0, MINER));
    // Transfer 1 from miner to buyer.
    applyEvent(store, {
      eventName: "Transfer",
      args: { from: MINER, to: BUYER, tokenId: 1n },
      blockNumber: 11n,
      transactionHash: TX,
    });
    const tok = store.tokens.get("1")!;
    expect(tok.owner).toBe(BUYER);
    expect(tok.original_miner).toBe(MINER); // provenance immutable
    expect(tok.slot).toBe(0);
    expect(tok.level).toBe(21);
    expect(store.byOwner(BUYER).map((t) => t.token_id)).toEqual(["1"]);
    expect(store.byOwner(MINER)).toHaveLength(0);
  });

  it("ignores the zero-address mint Transfer (provenance owns the mint)", () => {
    const store = new NftStore();
    applyEvent(store, minted(1n, 0, MINER));
    applyEvent(store, {
      eventName: "Transfer",
      args: { from: "0x0000000000000000000000000000000000000000", to: MINER, tokenId: 1n },
      blockNumber: 10n,
      transactionHash: TX,
    });
    expect(store.tokens.get("1")!.owner).toBe(MINER);
  });
});

describe("marketplace projection (#10)", () => {
  it("tracks listings, sales, gifts, cancels, and trade history", () => {
    const store = new NftStore();
    applyEvent(store, minted(1n, 0, MINER));
    applyEvent(store, {
      eventName: "Listed",
      args: { tokenId: 1n, seller: MINER, priceTrinity: 5n },
      blockNumber: 12n,
      transactionHash: TX,
    });
    expect(store.activeListings()).toHaveLength(1);

    applyEvent(store, {
      eventName: "Sold",
      args: { tokenId: 1n, seller: MINER, buyer: BUYER, priceTrinity: 5n },
      blockNumber: 13n,
      transactionHash: TX,
    });
    expect(store.activeListings()).toHaveLength(0); // listing cleared on sale
    expect(store.tokens.get("1")!.owner).toBe(BUYER);

    // New owner gifts it.
    applyEvent(store, {
      eventName: "Gifted",
      args: { tokenId: 1n, from: BUYER, to: RECIPIENT },
      blockNumber: 14n,
      transactionHash: TX,
    });
    expect(store.tokens.get("1")!.owner).toBe(RECIPIENT);

    const trades = store.tradesFor("1");
    expect(trades.map((t) => t.kind)).toEqual(["list", "sale", "gift"]);
    expect(trades[1]!.price_trinity).toBe("5");
  });

  it("cancel deactivates the listing", () => {
    const store = new NftStore();
    applyEvent(store, minted(1n, 1, MINER));
    applyEvent(store, {
      eventName: "Listed",
      args: { tokenId: 1n, seller: MINER, priceTrinity: 3n },
      blockNumber: 12n,
      transactionHash: TX,
    });
    applyEvent(store, {
      eventName: "Cancelled",
      args: { tokenId: 1n, seller: MINER },
      blockNumber: 13n,
      transactionHash: TX,
    });
    expect(store.activeListings()).toHaveLength(0);
    expect(store.tradesFor("1").map((t) => t.kind)).toEqual(["list", "cancel"]);
  });
});

describe("log decode round-trip", () => {
  it("decodes a real viem-encoded SlotMinted log", () => {
    const topics = encodeEventTopics({
      abi: TriangleSlotNftEventsAbi,
      eventName: "SlotMinted",
      args: { tokenId: 7n, triangleIdHash: TRI, miner: MINER },
    });
    const data = encodeAbiParameters(
      [
        { name: "slot", type: "uint32" },
        { name: "level", type: "uint8" },
        { name: "minedAt", type: "uint64" },
      ],
      [3, 21, 1_750_000_000n],
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
    expect(decoded?.eventName).toBe("SlotMinted");
    expect(decoded?.args.tokenId).toBe(7n);
    expect(decoded?.args.slot).toBe(3);

    const store = new NftStore();
    applyEvent(store, decoded!);
    expect(store.tokens.get("7")!.slot).toBe(3);
  });
});

describe("API + metadata (#6)", () => {
  it("serves tokens, owners, listings, trades, and ERC-721 metadata", async () => {
    const store = new NftStore();
    applyEvent(store, minted(1n, 0, MINER));
    const api = createApi(store, [], { externalBaseUrl: "https://step.example" });

    const tok = await (await api.request("/v1/tokens/1")).json() as any;
    expect(tok.slot).toBe(0);

    const owner = await (await api.request(`/v1/owners/${MINER}`)).json() as any;
    expect(owner.tokens).toHaveLength(1);

    expect((await api.request("/v1/tokens/999")).status).toBe(404);
    expect((await api.request("/v1/tokens/notanumber")).status).toBe(400);

    const meta = await (await api.request("/v1/metadata/1")).json() as any;
    expect(meta.external_url).toBe("https://step.example/token/1");
    const landlord = meta.attributes.find((a: any) => a.trait_type === "Landlord");
    expect(landlord.value).toBe("yes"); // slot 0 = landlord
  });

  it("metadata marks non-landlord slots", () => {
    const m = metadata({
      token_id: "9",
      triangle_id_hash: TRI,
      level: 21,
      slot: 4,
      original_miner: MINER,
      minted_at: 1_750_000_000,
      owner: MINER,
    });
    const landlord = (m.attributes as any[]).find((a) => a.trait_type === "Landlord");
    expect(landlord.value).toBe("no");
  });
});
