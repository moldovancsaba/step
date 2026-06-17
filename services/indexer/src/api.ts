/** Explorer-facing REST API over the projection (WEB-003 data source). */
import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Hex } from "@step/shared-types";
import type { MemoryStore } from "./store.js";

function json(value: unknown): unknown {
  return JSON.parse(
    JSON.stringify(value, (_k, v) => (typeof v === "bigint" ? v.toString() : v)),
  );
}

export interface ApiOptions {
  /** Mineable slots per triangle (protocol param collector_slots_per_triangle). */
  totalSlots?: number;
}

/** Max triangle hashes accepted in one mesh-states batch (bounds CPU/payload;
 *  matches the viewport cover cap in #15). */
const MAX_MESH_STATE_BATCH = 20_000;
const HASH_RE = /^0x[0-9a-fA-F]{64}$/;

export function createApi(store: MemoryStore, corsOrigins: string[] = [], opts: ApiOptions = {}) {
  const app = new Hono();
  const totalSlots = opts.totalSlots ?? 27;

  if (corsOrigins.length) {
    app.use(
      "*",
      cors({
        origin: corsOrigins,
        allowMethods: ["GET", "POST", "OPTIONS"],
        allowHeaders: ["content-type"],
      }),
    );
  }

  app.get("/healthz", (c) => c.text("ok"));

  app.get("/v1/stats", (c) => c.json(json(store.stats())));

  app.get("/v1/triangles/:idHash", (c) => {
    const row = store.triangles.get(c.req.param("idHash").toLowerCase());
    if (!row) return c.json({ error: "unknown triangle" }, 404);
    return c.json(json(row));
  });

  app.get("/v1/triangles", (c) =>
    c.json(json([...store.triangles.values()].slice(0, 500))),
  );

  app.get("/v1/claims/:hash", (c) => {
    const row = store.claims.get(c.req.param("hash").toLowerCase());
    if (!row) return c.json({ error: "unknown claim" }, 404);
    return c.json(json(row));
  });

  app.get("/v1/claims", (c) => {
    const rows = [...store.claims.values()]
      .sort((a, b) => (a.block_number < b.block_number ? 1 : -1))
      .slice(0, 100);
    return c.json(json(rows));
  });

  app.get("/v1/campaigns/:id", (c) => {
    const row = store.campaigns.get(c.req.param("id").toLowerCase());
    if (!row) return c.json({ error: "unknown campaign" }, 404);
    return c.json(json(row));
  });

  app.get("/v1/campaigns", (c) => c.json(json([...store.campaigns.values()])));

  app.get("/v1/validators", (c) => c.json(json([...store.validators.values()])));

  app.get("/v1/treasury", (c) => c.json(json(store.treasury)));

  // Oasis/desert state for a single triangle (#16). Always 200: an unmined
  // triangle is a full oasis (depletion 0), not a 404.
  app.get("/v1/mesh-states/:idHash", (c) => {
    const idHash = c.req.param("idHash");
    if (!HASH_RE.test(idHash)) return c.json({ error: "bad triangle id hash" }, 400);
    return c.json(json(store.meshState(idHash as Hex, totalSlots)));
  });

  // Batch oasis/desert states for a viewport's triangles (#16 → #17). The client
  // gets the hashes from the mesh cover (#15) and posts them here for colouring.
  app.post("/v1/mesh-states", async (c) => {
    let body: { triangle_id_hashes?: unknown };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid json" }, 400);
    }
    const hashes = body.triangle_id_hashes;
    if (!Array.isArray(hashes)) return c.json({ error: "triangle_id_hashes must be an array" }, 400);
    if (hashes.length > MAX_MESH_STATE_BATCH) {
      return c.json({ error: `too many triangles (max ${MAX_MESH_STATE_BATCH})` }, 400);
    }
    const states = [];
    for (const h of hashes) {
      if (typeof h !== "string" || !HASH_RE.test(h)) {
        return c.json({ error: "every triangle_id_hash must be a 32-byte hex string" }, 400);
      }
      states.push(store.meshState(h as Hex, totalSlots));
    }
    return c.json(json({ total_slots: totalSlots, states }));
  });

  return app;
}
