import { Hono } from "hono";
import type { EvidenceVault } from "./vault.js";

export function createApp(vault: EvidenceVault, foundationToken: string) {
  const app = new Hono();

  app.get("/healthz", (c) => c.text("ok"));

  app.post("/v1/bundles", async (c) => {
    const bundle = await c.req.json().catch(() => null);
    if (!bundle || bundle.schema_version !== "step.evidence.bundle.v1") {
      return c.json({ error: "step.evidence.bundle.v1 body required" }, 400);
    }
    const cid = await vault.store(bundle);
    return c.json({ cid }, 201);
  });

  // Foundation-only: claim review and disputes (HARD §13.3); never public.
  app.get("/v1/bundles/:cid", async (c) => {
    if (c.req.header("authorization") !== `Bearer ${foundationToken}`) {
      return c.json({ error: "forbidden" }, 403);
    }
    const bundle = await vault.retrieve(c.req.param("cid"));
    if (bundle === null) return c.json({ error: "unknown or key destroyed" }, 404);
    return c.json(bundle);
  });

  // GDPR deletion = key destruction (ADR-014); logged for the privacy dashboard.
  app.delete("/v1/bundles/:cid/key", async (c) => {
    if (c.req.header("authorization") !== `Bearer ${foundationToken}`) {
      return c.json({ error: "forbidden" }, 403);
    }
    const destroyed = await vault.destroy(c.req.param("cid"));
    if (!destroyed) return c.json({ error: "unknown or already destroyed" }, 404);
    console.log(JSON.stringify({ event: "evidence_key_destroyed", cid: c.req.param("cid") }));
    return c.json({ destroyed: true });
  });

  return app;
}
