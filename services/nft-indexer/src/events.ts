/**
 * Chain-event → NFT/marketplace projection. Decoding uses the local event ABIs;
 * application logic is pure and unit-tested with synthetic decoded events. The
 * projection is rebuildable from block 0 at any time.
 */
import { parseEventLogs, type Log } from "viem";
import type { Address, Hex } from "@step/shared-types";
import { TriangleSlotNftEventsAbi, TriangleMarketplaceEventsAbi, ZERO_ADDRESS } from "./abis.js";
import type { NftStore } from "./store.js";

const ALL_ABIS = [...TriangleSlotNftEventsAbi, ...TriangleMarketplaceEventsAbi] as const;

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

export function applyEvent(store: NftStore, e: DecodedEvent): void {
  const a = e.args;
  switch (e.eventName) {
    case "SlotMinted": {
      const tokenId = (a.tokenId as bigint).toString();
      const miner = a.miner as Address;
      store.tokens.set(tokenId, {
        token_id: tokenId,
        triangle_id_hash: a.triangleIdHash as Hex,
        level: Number(a.level as bigint),
        slot: Number(a.slot as bigint),
        original_miner: miner,
        minted_at: Number(a.minedAt as bigint),
        owner: miner, // mint sets the original owner; ERC-721 Transfer also fires
      });
      break;
    }
    case "Transfer": {
      const from = a.from as Address;
      const to = a.to as Address;
      const tokenId = (a.tokenId as bigint).toString();
      // Mint Transfer (from == 0) is covered by SlotMinted; only update owner if
      // the token is known (provenance came from SlotMinted).
      if (from === ZERO_ADDRESS) break;
      const tok = store.tokens.get(tokenId);
      if (tok) tok.owner = to;
      break;
    }
    case "Listed": {
      const tokenId = (a.tokenId as bigint).toString();
      store.listings.set(tokenId, {
        token_id: tokenId,
        seller: a.seller as Address,
        price_trinity: (a.priceTrinity as bigint).toString(),
        active: true,
        listed_at_block: e.blockNumber.toString(),
      });
      store.trades.push(trade("list", tokenId, a.seller as Address, null, (a.priceTrinity as bigint).toString(), e));
      break;
    }
    case "Cancelled": {
      const tokenId = (a.tokenId as bigint).toString();
      const l = store.listings.get(tokenId);
      if (l) l.active = false;
      store.trades.push(trade("cancel", tokenId, a.seller as Address, null, null, e));
      break;
    }
    case "Sold": {
      const tokenId = (a.tokenId as bigint).toString();
      const l = store.listings.get(tokenId);
      if (l) l.active = false;
      const tok = store.tokens.get(tokenId);
      if (tok) tok.owner = a.buyer as Address; // ownership also confirmed by Transfer
      store.trades.push(
        trade("sale", tokenId, a.seller as Address, a.buyer as Address, (a.priceTrinity as bigint).toString(), e),
      );
      break;
    }
    case "Gifted": {
      const tokenId = (a.tokenId as bigint).toString();
      const l = store.listings.get(tokenId);
      if (l) l.active = false;
      const tok = store.tokens.get(tokenId);
      if (tok) tok.owner = a.to as Address;
      store.trades.push(trade("gift", tokenId, a.from as Address, a.to as Address, null, e));
      break;
    }
    default:
      break;
  }
  if (e.blockNumber > store.lastBlock) store.lastBlock = e.blockNumber;
}

function trade(
  kind: import("./store.js").TradeKind,
  tokenId: string,
  from: Address | null,
  to: Address | null,
  price: string | null,
  e: DecodedEvent,
): import("./store.js").TradeEvent {
  return {
    kind,
    token_id: tokenId,
    from,
    to,
    price_trinity: price,
    block_number: e.blockNumber.toString(),
    tx_hash: e.transactionHash,
  };
}
