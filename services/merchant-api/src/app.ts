/**
 * Merchant API: admin-gated merchant onboarding (MER-001 — no self-service in
 * alpha), POI management with canonical triangle mapping (via the validator
 * node's mesh API, ADR-004), restricted-category enforcement (MER-008,
 * SYS §20.6), merchant rights confirmation (HARD §14.3), and rotating QR
 * proof payloads for L4 campaigns (MER-004).
 *
 * Campaign creation/funding happens ON-CHAIN through the merchant dashboard
 * with the foundation-managed merchant key (MER-009); this service stores the
 * off-chain merchant/POI registry and serves campaign reporting by joining
 * the indexer. Alpha store: in-memory (rebuildable registry at pilot scale,
 * mirrored to the operational Postgres at MVP).
 */
import { Hono } from "hono";
import { keccak256, stringToBytes } from "viem";
import type { TriangleInfo } from "@step/shared-types";

/** SYS §20.6 restricted merchant categories: excluded outright in alpha. */
export const RESTRICTED_CATEGORIES = [
  "alcohol",
  "tobacco",
  "gambling",
  "adult",
  "weapons",
  "controlled_substances",
  "political",
  "medical_claims",
  "financial_promotions",
] as const;

export interface Merchant {
  merchant_id: string;
  name: string;
  category: string;
  status: "pending" | "approved" | "rejected";
  rights_confirmed: boolean;
  created_at: string;
}

export interface Poi {
  poi_id: string;
  merchant_id: string;
  name: string;
  lat: number;
  lon: number;
  level: number;
  triangle_id: string;
  triangle_id_hash: string;
}

export interface MerchantDeps {
  adminToken: string;
  /** Canonical mesh resolution (validator node /v1/mesh/resolve). */
  resolveTriangle(lat: number, lon: number, level: number): Promise<TriangleInfo>;
  /** Rotating QR secret (per-POI payloads, MER-004/DEV §17.1 QR rotation). */
  qrSecret: string;
  nowUnix(): number;
}

/** Rotating QR payload: poi + 5-minute window + keyed tag. Scanned by the
 *  miner app, embedded as merchant_proof, verified by merchant validators. */
export function qrPayload(secret: string, poiId: string, nowUnix: number): string {
  const window = Math.floor(nowUnix / 300);
  const body = `${poiId}:${window}`;
  const tag = keccak256(stringToBytes(`${secret}|${body}`)).slice(2, 34);
  return `stepqr1:${body}:${tag}`;
}

export function verifyQrPayload(
  secret: string,
  payload: string,
  poiId: string,
  nowUnix: number,
): boolean {
  // Accept current and previous window (clock skew tolerance).
  for (const w of [Math.floor(nowUnix / 300), Math.floor(nowUnix / 300) - 1]) {
    const body = `${poiId}:${w}`;
    const tag = keccak256(stringToBytes(`${secret}|${body}`)).slice(2, 34);
    if (payload === `stepqr1:${body}:${tag}`) return true;
  }
  return false;
}

export function createApp(deps: MerchantDeps) {
  const app = new Hono();
  const merchants = new Map<string, Merchant>();
  const pois = new Map<string, Poi>();
  let seq = 0;

  const requireAdmin = (auth: string | undefined) =>
    auth === `Bearer ${deps.adminToken}`;

  app.get("/healthz", (c) => c.text("ok"));

  /** Merchant registration → pending review (MER-001 steps 1–2). */
  app.post("/v1/merchants", async (c) => {
    const body = await c.req.json().catch(() => null);
    const { name, category, rights_confirmed } = body ?? {};
    if (!name || !category) return c.json({ error: "name and category required" }, 400);
    if ((RESTRICTED_CATEGORIES as readonly string[]).includes(category)) {
      // MER-008: excluded outright in alpha; legal review may open some later.
      return c.json({ error: `category '${category}' is restricted (SYS §20.6)` }, 422);
    }
    if (rights_confirmed !== true) {
      // HARD §14.3: merchant must confirm location rights and legal access.
      return c.json({ error: "rights_confirmed must be true" }, 422);
    }
    const merchant: Merchant = {
      merchant_id: `mer_${++seq}`,
      name,
      category,
      status: "pending",
      rights_confirmed: true,
      created_at: new Date().toISOString(),
    };
    merchants.set(merchant.merchant_id, merchant);
    return c.json(merchant, 201);
  });

  /** Admin approval (alpha gate, OAS scope: admin-approved onboarding). */
  app.post("/v1/merchants/:id/review", async (c) => {
    if (!requireAdmin(c.req.header("authorization"))) {
      return c.json({ error: "forbidden" }, 403);
    }
    const merchant = merchants.get(c.req.param("id"));
    if (!merchant) return c.json({ error: "unknown merchant" }, 404);
    const { approve } = await c.req.json().catch(() => ({ approve: false }));
    merchant.status = approve ? "approved" : "rejected";
    return c.json(merchant);
  });

  /** POI creation with canonical triangle mapping (MER-001 steps 4–5). */
  app.post("/v1/pois", async (c) => {
    const body = await c.req.json().catch(() => null);
    const { merchant_id, name, lat, lon, level } = body ?? {};
    const merchant = merchants.get(merchant_id);
    if (!merchant) return c.json({ error: "unknown merchant" }, 404);
    if (merchant.status !== "approved") {
      return c.json({ error: "merchant not approved" }, 403);
    }
    if (typeof lat !== "number" || typeof lon !== "number" || typeof level !== "number") {
      return c.json({ error: "lat, lon, level required" }, 400);
    }
    let triangle: TriangleInfo;
    try {
      triangle = await deps.resolveTriangle(lat, lon, level);
    } catch (err) {
      return c.json(
        { error: `mesh resolution failed: ${err instanceof Error ? err.message : "unknown"}` },
        502,
      );
    }
    const poi: Poi = {
      poi_id: `poi_${++seq}`,
      merchant_id,
      name: name ?? "POI",
      lat,
      lon,
      level,
      triangle_id: triangle.triangle_id,
      triangle_id_hash: triangle.triangle_id_hash,
    };
    pois.set(poi.poi_id, poi);
    return c.json(poi, 201);
  });

  app.get("/v1/merchants/:id/pois", (c) => {
    const id = c.req.param("id");
    return c.json([...pois.values()].filter((p) => p.merchant_id === id));
  });

  /** Current rotating QR for a POI (merchant displays this at the door). */
  app.get("/v1/pois/:id/qr", (c) => {
    const poi = pois.get(c.req.param("id"));
    if (!poi) return c.json({ error: "unknown poi" }, 404);
    return c.json({
      payload: qrPayload(deps.qrSecret, poi.poi_id, deps.nowUnix()),
      rotates_every_s: 300,
    });
  });

  /** QR verification endpoint used by merchant validators (L4 proof path). */
  app.post("/v1/pois/:id/qr/verify", async (c) => {
    const poi = pois.get(c.req.param("id"));
    if (!poi) return c.json({ error: "unknown poi" }, 404);
    const { payload } = await c.req.json().catch(() => ({}));
    const valid = typeof payload === "string"
      && verifyQrPayload(deps.qrSecret, payload, poi.poi_id, deps.nowUnix());
    return c.json({ valid });
  });

  return app;
}
