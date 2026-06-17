/**
 * Index store (DAT-004). The chain is the source of final economic truth
 * (DAT-002); this store is a rebuildable projection. Alpha runs the in-memory
 * backend — legitimate at pilot scale because the indexer replays from block 0
 * on restart in seconds. The PostgreSQL backend lands with the public-testnet
 * deployment (tracked in the release log), behind this same interface.
 */
import type { Address, Hex } from "@step/shared-types";

export interface TriangleRow {
  triangle_id_hash: Hex;
  used_slots: number;
  last_mined_at: string | null;
  frozen: boolean;
  freeze_reason: Hex | null;
  total_mined_trinity: bigint;
  oasis_campaigns: Hex[];
}

export interface ClaimRow {
  claim_hash: Hex;
  triangle_id_hash: Hex;
  miner: Address;
  kind: "natural" | "sponsored";
  slot: number | null;
  campaign_id: Hex | null;
  trinity_amount: bigint;
  proof_cid_hash: Hex | null;
  block_number: bigint;
  tx_hash: Hex;
}

export interface CampaignRow {
  campaign_id: Hex;
  merchant: Address;
  status: number;
  budget: bigint;
  released: bigint;
  refunded: bigint;
  triangle_id_hashes: Hex[];
  verified_visits: number;
}

export interface ValidatorRow {
  validator: Address;
  validator_type: number;
  weight: bigint;
  status: number;
  slashed_total: bigint;
}

export interface TreasuryRow {
  total_twin_minted: bigint;
  withdrawals: { to: Address; amount: bigint; purpose: Hex; tx_hash: Hex }[];
}

export interface MeshState {
  triangle_id_hash: Hex;
  used_slots: number;
  total_slots: number;
  depletion: number; // 0 (oasis) .. 1 (desert)
  state: "oasis" | "filling" | "desert";
  frozen: boolean;
  last_mined_at: string | null;
}

export interface Stats {
  total_supply: bigint;
  claims_finalised: number;
  sponsored_claims: number;
  triangles_touched: number;
  last_block: bigint;
}

export class MemoryStore {
  triangles = new Map<string, TriangleRow>();
  claims = new Map<string, ClaimRow>();
  campaigns = new Map<string, CampaignRow>();
  validators = new Map<string, ValidatorRow>();
  treasury: TreasuryRow = { total_twin_minted: 0n, withdrawals: [] };
  lastBlock = 0n;

  triangle(idHash: Hex): TriangleRow {
    const key = idHash.toLowerCase();
    let row = this.triangles.get(key);
    if (!row) {
      row = {
        triangle_id_hash: idHash,
        used_slots: 0,
        last_mined_at: null,
        frozen: false,
        freeze_reason: null,
        total_mined_trinity: 0n,
        oasis_campaigns: [],
      };
      this.triangles.set(key, row);
    }
    return row;
  }

  campaign(id: Hex): CampaignRow {
    const key = id.toLowerCase();
    let row = this.campaigns.get(key);
    if (!row) {
      row = {
        campaign_id: id,
        merchant: "0x0000000000000000000000000000000000000000",
        status: 0,
        budget: 0n,
        released: 0n,
        refunded: 0n,
        triangle_id_hashes: [],
        verified_visits: 0,
      };
      this.campaigns.set(key, row);
    }
    return row;
  }

  /**
   * Oasis/desert state for one triangle (issue #16). Depletion = used / total
   * slots in [0,1]; drives the viewport heat overlay (green oasis → red desert,
   * #17). Triangles never mined (absent from the projection) report depletion 0
   * = full oasis. `frozen` triangles are surfaced so the UI can mark them.
   */
  meshState(idHash: Hex, totalSlots: number): MeshState {
    const row = this.triangles.get(idHash.toLowerCase());
    const used = row ? row.used_slots : 0;
    const total = Math.max(totalSlots, 1);
    const depletion = Math.min(used / total, 1);
    const state: MeshState["state"] =
      used >= total ? "desert" : depletion >= 0.5 ? "filling" : "oasis";
    return {
      triangle_id_hash: idHash,
      used_slots: used,
      total_slots: total,
      depletion,
      state,
      frozen: row?.frozen ?? false,
      last_mined_at: row?.last_mined_at ?? null,
    };
  }

  stats(): Stats {
    let supply = 0n;
    for (const c of this.claims.values()) {
      if (c.kind === "natural") supply += c.trinity_amount;
    }
    supply += this.treasury.total_twin_minted;
    return {
      total_supply: supply,
      claims_finalised: this.claims.size,
      sponsored_claims: [...this.claims.values()].filter((c) => c.kind === "sponsored").length,
      triangles_touched: this.triangles.size,
      last_block: this.lastBlock,
    };
  }
}
