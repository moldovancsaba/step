/**
 * Typed clients for the STEP backends the web app talks to:
 *  - account-api (#12): register/login/logout/session/vault (cookie session)
 *  - validator mesh API (#15): /v1/mesh/cover viewport coverage
 *  - indexer (#16): /v1/mesh-states oasis/desert batch
 *  - nft-indexer (#7/#10): tokens, listings
 *
 * Base URLs come from Vite env (VITE_*), defaulting to the local pilot ports.
 */
import type { KdfParams } from "./crypto.js";

const env = (import.meta as unknown as { env: Record<string, string | undefined> }).env;

const ACCOUNT_URL = env.VITE_ACCOUNT_URL ?? "http://127.0.0.1:8091";
const MESH_URL = env.VITE_MESH_URL ?? "http://127.0.0.1:8081";
const INDEXER_URL = env.VITE_INDEXER_URL ?? "http://127.0.0.1:8090";
const NFT_URL = env.VITE_NFT_URL ?? "http://127.0.0.1:8092";

/** Whether the mesh/indexer/NFT backends are deployed for this build. When the
 *  app is served over https but those URLs are still the local-dev defaults,
 *  they're unreachable (and would be mixed-content) — so map/NFT surfaces show a
 *  clear "coming soon" state instead of hammering localhost. */
const isLocalUrl = (u: string) => u.includes("127.0.0.1") || u.includes("localhost");
export const meshConfigured = !!env.VITE_MESH_URL && !isLocalUrl(MESH_URL);
export const nftConfigured = !!env.VITE_NFT_URL && !isLocalUrl(NFT_URL);

async function jsonOrThrow(resp: Response): Promise<unknown> {
  if (!resp.ok) {
    const body = (await resp.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `HTTP ${resp.status}`);
  }
  return resp.json();
}

// ---- account-api (#12) ------------------------------------------------
export interface RegisterBody {
  identity: string;
  authKey: string;
  address: string;
  vault_ciphertext: string;
  iv: string;
  kdf_params: KdfParams;
}

export interface LoginResult {
  vault_ciphertext: string;
  iv: string;
  kdf_params: KdfParams;
  address: `0x${string}`;
}

export const account = {
  async register(body: RegisterBody): Promise<void> {
    await jsonOrThrow(
      await fetch(`${ACCOUNT_URL}/v1/register`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
    );
  },
  /** Public KDF-salt lookup (non-secret) so any device can derive the authKey
   *  for identity-login without local cache. Decoyed server-side vs enumeration. */
  async kdf(identity: string): Promise<{ kdf_params: KdfParams }> {
    return (await jsonOrThrow(
      await fetch(`${ACCOUNT_URL}/v1/kdf?identity=${encodeURIComponent(identity)}`, {
        credentials: "include",
      }),
    )) as { kdf_params: KdfParams };
  },
  async login(identity: string, authKey: string): Promise<LoginResult> {
    return (await jsonOrThrow(
      await fetch(`${ACCOUNT_URL}/v1/login`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ identity, authKey }),
      }),
    )) as LoginResult;
  },
  async logout(): Promise<void> {
    await fetch(`${ACCOUNT_URL}/v1/logout`, { method: "POST", credentials: "include" });
  },
  async session(): Promise<{ identity: string; address: `0x${string}` } | null> {
    const resp = await fetch(`${ACCOUNT_URL}/v1/session`, { credentials: "include" });
    if (resp.status === 401) return null;
    return (await jsonOrThrow(resp)) as { identity: string; address: `0x${string}` };
  },
};

// ---- mesh cover (#15) + states (#16) ----------------------------------
export interface CoverTriangle {
  triangle_id: string;
  triangle_id_hash: `0x${string}`;
  vertices: { lat: number; lon: number }[];
}
export interface CoverResult {
  triangles: CoverTriangle[];
  truncated: boolean;
  suggested_level: number;
}
export interface MeshState {
  triangle_id_hash: `0x${string}`;
  used_slots: number;
  total_slots: number;
  depletion: number;
  state: "oasis" | "filling" | "desert";
  frozen: boolean;
}

export const mesh = {
  async cover(
    b: { minLat: number; minLon: number; maxLat: number; maxLon: number },
    level: number,
    max = 2000,
  ): Promise<CoverResult> {
    const q = new URLSearchParams({
      minLat: String(b.minLat),
      minLon: String(b.minLon),
      maxLat: String(b.maxLat),
      maxLon: String(b.maxLon),
      level: String(level),
      max: String(max),
    });
    return (await jsonOrThrow(await fetch(`${MESH_URL}/v1/mesh/cover?${q}`))) as CoverResult;
  },
  async states(hashes: string[]): Promise<{ total_slots: number; states: MeshState[] }> {
    return (await jsonOrThrow(
      await fetch(`${INDEXER_URL}/v1/mesh-states`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ triangle_id_hashes: hashes }),
      }),
    )) as { total_slots: number; states: MeshState[] };
  },
};

// ---- nft-indexer (#7/#10) ---------------------------------------------
export interface NftToken {
  token_id: string;
  triangle_id_hash: `0x${string}`;
  level: number;
  slot: number;
  owner: `0x${string}`;
  minted_at: number;
}

export const nft = {
  async owned(address: string): Promise<NftToken[]> {
    const r = (await jsonOrThrow(await fetch(`${NFT_URL}/v1/owners/${address}`))) as {
      tokens: NftToken[];
    };
    return r.tokens;
  },
};

export const endpoints = { ACCOUNT_URL, MESH_URL, INDEXER_URL, NFT_URL };
