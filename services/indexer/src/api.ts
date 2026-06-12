/** Explorer-facing REST API over the projection (WEB-003 data source). */
import { Hono } from "hono";
import type { MemoryStore } from "./store.js";

function json(value: unknown): unknown {
  return JSON.parse(
    JSON.stringify(value, (_k, v) => (typeof v === "bigint" ? v.toString() : v)),
  );
}

export function createApi(store: MemoryStore) {
  const app = new Hono();

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

  return app;
}
