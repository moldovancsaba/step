/**
 * NFT + marketplace read API.
 *  - #7  ownership & provenance:   /v1/tokens, /v1/tokens/:id, /v1/owners/:addr
 *  - #10 marketplace:              /v1/listings, /v1/tokens/:id/trades
 *  - #6  ERC-721 metadata:         /v1/metadata/:id  (tokenURI target)
 *
 * No coordinates are stored on-chain or here (PRV-001); metadata references the
 * triangle id hash + level/slot/order, and clients resolve geometry from the
 * mesh engine. Read-only; bigints are serialised as decimal strings.
 */
import { Hono } from "hono";
import { cors } from "hono/cors";
import type { NftStore, NftToken } from "./store.js";

const DEC_RE = /^[0-9]+$/;

export interface NftApiOptions {
  /** Public base URL of this metadata service (for tokenURI external links). */
  externalBaseUrl?: string;
}

export function createApi(store: NftStore, corsOrigins: string[] = [], opts: NftApiOptions = {}) {
  const app = new Hono();

  if (corsOrigins.length) {
    app.use(
      "*",
      cors({ origin: corsOrigins, allowMethods: ["GET", "OPTIONS"], allowHeaders: ["content-type"] }),
    );
  }

  app.get("/healthz", (c) => c.text("ok"));

  // ---- #7 ownership & provenance -------------------------------------
  app.get("/v1/tokens", (c) => c.json([...store.tokens.values()].slice(0, 1000)));

  app.get("/v1/tokens/:id", (c) => {
    const id = c.req.param("id");
    if (!DEC_RE.test(id)) return c.json({ error: "bad token id" }, 400);
    const tok = store.tokens.get(id);
    if (!tok) return c.json({ error: "unknown token" }, 404);
    return c.json(tok);
  });

  app.get("/v1/owners/:addr", (c) => {
    const addr = c.req.param("addr");
    if (!/^0x[0-9a-fA-F]{40}$/.test(addr)) return c.json({ error: "bad address" }, 400);
    return c.json({ owner: addr, tokens: store.byOwner(addr) });
  });

  // ---- #10 marketplace -----------------------------------------------
  app.get("/v1/listings", (c) => c.json(store.activeListings()));

  app.get("/v1/tokens/:id/trades", (c) => {
    const id = c.req.param("id");
    if (!DEC_RE.test(id)) return c.json({ error: "bad token id" }, 400);
    return c.json(store.tradesFor(id));
  });

  // ---- #6 ERC-721 metadata (tokenURI target) -------------------------
  app.get("/v1/metadata/:id", (c) => {
    const id = c.req.param("id");
    if (!DEC_RE.test(id)) return c.json({ error: "bad token id" }, 400);
    const tok = store.tokens.get(id);
    if (!tok) return c.json({ error: "unknown token" }, 404);
    return c.json(metadata(tok, opts.externalBaseUrl));
  });

  return app;
}

/** OpenSea-style ERC-721 metadata derived from on-chain provenance. */
export function metadata(tok: NftToken, externalBaseUrl?: string): Record<string, unknown> {
  const order = tok.slot === 0 ? "first miner (landlord)" : `miner #${tok.slot + 1}`;
  return {
    name: `STEP Triangle ${tok.triangle_id_hash.slice(0, 10)}… · slot ${tok.slot}`,
    description:
      `Proof-of-presence collectible for one mining slot of a STEP mesh triangle. ` +
      `Slot ${tok.slot} (${order}) at mesh level ${tok.level}. Provenance is immutable; ` +
      `ownership is transferable. Slot 0 confers campaign (landlord) rights.`,
    external_url: externalBaseUrl ? `${externalBaseUrl}/token/${tok.token_id}` : undefined,
    attributes: [
      { trait_type: "Triangle", value: tok.triangle_id_hash },
      { trait_type: "Mesh Level", value: tok.level },
      { trait_type: "Slot", value: tok.slot },
      { trait_type: "Mining Order", value: tok.slot + 1 },
      { trait_type: "Landlord", value: tok.slot === 0 ? "yes" : "no" },
      { trait_type: "Original Miner", value: tok.original_miner },
      { display_type: "date", trait_type: "Mined At", value: tok.minted_at },
    ],
  };
}
