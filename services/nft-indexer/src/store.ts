/**
 * Projection of the per-slot NFT (#7) and marketplace (#10). Rebuildable from
 * block 0 — the chain is the source of truth. In-memory backend for alpha;
 * Postgres is the deploy adapter behind this same shape (mirrors @step/indexer).
 *
 * Provenance is immutable (set at mint); ownership follows ERC-721 Transfer;
 * listings follow marketplace events. `slot === 0` marks the "landlord" token of
 * a triangle (campaign rights live with slot-0 ownership — see #9).
 */
import type { Address, Hex } from "@step/shared-types";

export interface NftToken {
  token_id: string; // uint256 decimal string
  triangle_id_hash: Hex;
  level: number;
  slot: number;
  original_miner: Address;
  minted_at: number; // unix seconds (on-chain minedAt)
  owner: Address; // current owner (follows Transfer)
}

export interface Listing {
  token_id: string;
  seller: Address;
  price_trinity: string; // uint256 decimal string
  active: boolean;
  listed_at_block: string;
}

export type TradeKind = "sale" | "gift" | "list" | "cancel";

export interface TradeEvent {
  kind: TradeKind;
  token_id: string;
  from: Address | null;
  to: Address | null;
  price_trinity: string | null;
  block_number: string;
  tx_hash: Hex;
}

export class NftStore {
  tokens = new Map<string, NftToken>(); // token_id -> token
  listings = new Map<string, Listing>(); // token_id -> current listing
  trades: TradeEvent[] = []; // append-only history (newest pushed last)
  lastBlock = 0n;

  byOwner(owner: string): NftToken[] {
    const o = owner.toLowerCase();
    return [...this.tokens.values()].filter((t) => t.owner.toLowerCase() === o);
  }

  activeListings(): Listing[] {
    return [...this.listings.values()].filter((l) => l.active);
  }

  tradesFor(tokenId: string): TradeEvent[] {
    return this.trades.filter((t) => t.token_id === tokenId);
  }
}
