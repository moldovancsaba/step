import { serve } from "@hono/node-server";
import type { TriangleInfo } from "@step/shared-types";
import { createApp } from "./app.js";

function env(key: string): string {
  const v = process.env[key];
  if (!v) throw new Error(`missing env ${key}`);
  return v;
}

const meshUrl = env("MESH_API_URL"); // a validator node, e.g. http://127.0.0.1:9100
const app = createApp({
  adminToken: env("FOUNDATION_API_TOKEN"),
  qrSecret: env("MERCHANT_QR_SECRET"),
  nowUnix: () => Math.floor(Date.now() / 1000),
  async resolveTriangle(lat, lon, level): Promise<TriangleInfo> {
    const resp = await fetch(`${meshUrl}/v1/mesh/resolve?lat=${lat}&lon=${lon}&level=${level}`);
    if (!resp.ok) throw new Error(`mesh API HTTP ${resp.status}`);
    return resp.json() as Promise<TriangleInfo>;
  },
});
const port = Number(process.env.MERCHANT_API_PORT ?? 8097);
console.log(`merchant-api listening on :${port}`);
serve({ fetch: app.fetch, port });
