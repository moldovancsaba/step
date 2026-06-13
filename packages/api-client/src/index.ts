/**
 * @step/api-client — typed client for the gateway, indexer, and merchant APIs
 * (WEB-006 strong typed API client). Thin fetch wrappers; types are the
 * shared-types contract. Every method throws ApiError on non-2xx.
 */
import type { Claim, Hex, TriangleInfo } from "@step/shared-types";

export class ApiError extends Error {
  constructor(
    public status: number,
    public body: unknown,
    url: string,
  ) {
    super(`API ${status} from ${url}`);
  }
}

type FetchLike = typeof fetch;

async function request<T>(
  fetchImpl: FetchLike,
  url: string,
  init?: RequestInit,
): Promise<T> {
  const resp = await fetchImpl(url, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  const body = await resp.json().catch(() => null);
  if (!resp.ok) throw new ApiError(resp.status, body, url);
  return body as T;
}

export interface GatewayClaimRecord {
  claim_hash: Hex;
  triangle_id: string;
  triangle_id_hash: Hex;
  miner: string;
  campaign_id?: string;
  status: "submitted" | "validating" | "accepted" | "finalised" | "rejected";
  reject_reasons: string[];
  votes: { validator: string; approve: boolean; weight: string }[];
  tx_hash?: Hex;
  submitted_at: string;
  finalised_at?: string;
}

export function gatewayClient(baseUrl: string, fetchImpl: FetchLike = fetch) {
  return {
    nonce: (wallet: string) =>
      request<{ nonce: string; expires_at_unix: number }>(fetchImpl, `${baseUrl}/v1/nonce`, {
        method: "POST",
        body: JSON.stringify({ wallet }),
      }),
    submitClaim: (claim: Claim) =>
      request<GatewayClaimRecord>(fetchImpl, `${baseUrl}/v1/claims`, {
        method: "POST",
        body: JSON.stringify({ claim }),
      }),
    claimStatus: (hash: Hex) =>
      request<GatewayClaimRecord>(fetchImpl, `${baseUrl}/v1/claims/${hash}`),
  };
}

export interface IndexerTriangle {
  triangle_id_hash: Hex;
  used_slots: number;
  last_mined_at: string | null;
  frozen: boolean;
  total_mined_trinity: string;
  oasis_campaigns: Hex[];
}

export interface IndexerStats {
  total_supply: string;
  claims_finalised: number;
  sponsored_claims: number;
  triangles_touched: number;
  last_block: string;
}

export function indexerClient(baseUrl: string, fetchImpl: FetchLike = fetch) {
  return {
    stats: () => request<IndexerStats>(fetchImpl, `${baseUrl}/v1/stats`),
    triangle: (idHash: Hex) =>
      request<IndexerTriangle>(fetchImpl, `${baseUrl}/v1/triangles/${idHash}`),
    claims: () => request<unknown[]>(fetchImpl, `${baseUrl}/v1/claims`),
    claim: (hash: Hex) => request<unknown>(fetchImpl, `${baseUrl}/v1/claims/${hash}`),
    campaigns: () => request<unknown[]>(fetchImpl, `${baseUrl}/v1/campaigns`),
    campaign: (id: Hex) => request<unknown>(fetchImpl, `${baseUrl}/v1/campaigns/${id}`),
    validators: () => request<unknown[]>(fetchImpl, `${baseUrl}/v1/validators`),
    treasury: () => request<unknown>(fetchImpl, `${baseUrl}/v1/treasury`),
  };
}

export function meshClient(baseUrl: string, fetchImpl: FetchLike = fetch) {
  return {
    resolve: (lat: number, lon: number, level: number) =>
      request<TriangleInfo>(
        fetchImpl,
        `${baseUrl}/v1/mesh/resolve?lat=${lat}&lon=${lon}&level=${level}`,
      ),
    triangle: (id: string) =>
      request<TriangleInfo>(fetchImpl, `${baseUrl}/v1/mesh/triangle/${id}`),
  };
}

export function merchantClient(baseUrl: string, fetchImpl: FetchLike = fetch) {
  return {
    register: (input: { name: string; category: string; rights_confirmed: boolean }) =>
      request<{ merchant_id: string; status: string }>(fetchImpl, `${baseUrl}/v1/merchants`, {
        method: "POST",
        body: JSON.stringify(input),
      }),
    createPoi: (input: {
      merchant_id: string;
      name: string;
      lat: number;
      lon: number;
      level: number;
    }) =>
      request<{ poi_id: string; triangle_id: string; triangle_id_hash: Hex }>(
        fetchImpl,
        `${baseUrl}/v1/pois`,
        { method: "POST", body: JSON.stringify(input) },
      ),
    pois: (merchantId: string) =>
      request<unknown[]>(fetchImpl, `${baseUrl}/v1/merchants/${merchantId}/pois`),
    qr: (poiId: string) =>
      request<{ payload: string; rotates_every_s: number }>(
        fetchImpl,
        `${baseUrl}/v1/pois/${poiId}/qr`,
      ),
  };
}
