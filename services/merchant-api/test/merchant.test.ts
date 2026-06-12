import { describe, expect, it } from "vitest";
import type { TriangleInfo } from "@step/shared-types";
import { createApp, qrPayload, verifyQrPayload, type MerchantDeps } from "../src/app.js";

const TOKEN = "admin-token";
const QR_SECRET = "qr-secret";

function deps(now = 1_900_000_000): MerchantDeps {
  return {
    adminToken: TOKEN,
    qrSecret: QR_SECRET,
    nowUnix: () => now,
    async resolveTriangle(lat, lon, level): Promise<TriangleInfo> {
      return {
        triangle_id: `STEP-${level}-F00-1220330232020131113${Math.abs(Math.round(lat))}`.slice(0, 40),
        triangle_id_hash: ("0x" + "ab".repeat(32)) as `0x${string}`,
        level,
        vertices: [
          { lat, lon },
          { lat: lat + 0.0001, lon },
          { lat, lon: lon + 0.0001 },
        ],
        centroid: { lat, lon },
        area_m2: 20,
        min_side_m: 6.7,
        parent: null,
        neighbours: [],
        mesh_spec_version: "step-mesh-v1",
      };
    },
  };
}

const json = (body: unknown, auth?: string) => ({
  method: "POST",
  body: JSON.stringify(body),
  headers: {
    "content-type": "application/json",
    ...(auth ? { authorization: `Bearer ${auth}` } : {}),
  },
});

describe("merchant onboarding (MER-001/008)", () => {
  it("registers, blocks restricted categories, requires rights confirmation", async () => {
    const app = createApp(deps());
    const ok = await app.request(
      "/v1/merchants",
      json({ name: "Café Mesh", category: "horeca", rights_confirmed: true }),
    );
    expect(ok.status).toBe(201);
    expect(((await ok.json()) as any).status).toBe("pending");

    const restricted = await app.request(
      "/v1/merchants",
      json({ name: "Casino", category: "gambling", rights_confirmed: true }),
    );
    expect(restricted.status).toBe(422);

    const noRights = await app.request(
      "/v1/merchants",
      json({ name: "Shop", category: "retail" }),
    );
    expect(noRights.status).toBe(422);
  });

  it("POIs require an admin-approved merchant and map to a canonical triangle", async () => {
    const app = createApp(deps());
    const merchant = await (
      await app.request(
        "/v1/merchants",
        json({ name: "Café Mesh", category: "horeca", rights_confirmed: true }),
      )
    ).json() as any;

    // Before approval: POI rejected.
    const early = await app.request(
      "/v1/pois",
      json({ merchant_id: merchant.merchant_id, name: "Front door", lat: 47.4979, lon: 19.0402, level: 21 }),
    );
    expect(early.status).toBe(403);

    // Review requires the foundation token.
    const unauth = await app.request(
      `/v1/merchants/${merchant.merchant_id}/review`,
      json({ approve: true }),
    );
    expect(unauth.status).toBe(403);
    await app.request(`/v1/merchants/${merchant.merchant_id}/review`, json({ approve: true }, TOKEN));

    const poi = await app.request(
      "/v1/pois",
      json({ merchant_id: merchant.merchant_id, name: "Front door", lat: 47.4979, lon: 19.0402, level: 21 }),
    );
    expect(poi.status).toBe(201);
    const poiJson = await poi.json() as any;
    expect(poiJson.triangle_id).toMatch(/^STEP-21-F00/);

    const list = await (
      await app.request(`/v1/merchants/${merchant.merchant_id}/pois`)
    ).json() as any;
    expect(list).toHaveLength(1);
  });
});

describe("rotating QR proof (MER-004)", () => {
  it("payload verifies in current and previous window, then expires", () => {
    const now = 1_900_000_000;
    const p = qrPayload(QR_SECRET, "poi_1", now);
    expect(verifyQrPayload(QR_SECRET, p, "poi_1", now)).toBe(true);
    expect(verifyQrPayload(QR_SECRET, p, "poi_1", now + 299)).toBe(true); // skew window
    expect(verifyQrPayload(QR_SECRET, p, "poi_1", now + 700)).toBe(false); // expired
    expect(verifyQrPayload(QR_SECRET, p, "poi_2", now)).toBe(false); // wrong POI
    expect(verifyQrPayload("other", p, "poi_1", now)).toBe(false); // wrong secret
  });

  it("QR endpoints issue and verify", async () => {
    const app = createApp(deps());
    const merchant = await (
      await app.request(
        "/v1/merchants",
        json({ name: "Café", category: "horeca", rights_confirmed: true }),
      )
    ).json() as any;
    await app.request(`/v1/merchants/${merchant.merchant_id}/review`, json({ approve: true }, TOKEN));
    const poi = await (
      await app.request(
        "/v1/pois",
        json({ merchant_id: merchant.merchant_id, lat: 47.5, lon: 19.04, level: 21 }),
      )
    ).json() as any;

    const qr = await (await app.request(`/v1/pois/${poi.poi_id}/qr`)).json() as any;
    const verify = await (
      await app.request(`/v1/pois/${poi.poi_id}/qr/verify`, json({ payload: qr.payload }))
    ).json() as any;
    expect(verify.valid).toBe(true);

    const bad = await (
      await app.request(`/v1/pois/${poi.poi_id}/qr/verify`, json({ payload: "stepqr1:fake" }))
    ).json() as any;
    expect(bad.valid).toBe(false);
  });
});
