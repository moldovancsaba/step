import { describe, expect, it } from "vitest";
import { computeCid, EvidenceVault, MemoryBackend } from "../src/vault.js";
import { createApp } from "../src/app.js";

const MASTER = new Uint8Array(32).fill(7);
const TOKEN = "test-foundation-token";

const bundle = {
  schema_version: "step.evidence.bundle.v1",
  claim_hash: "0x" + "ab".repeat(32),
  claim: { latitude: 47.4979, longitude: 19.0402 },
  validator_signatures: [],
  fraud_score: { score: 0 },
  proof_level: "L2",
  created_at: "2026-06-12T10:00:00Z",
};

describe("evidence vault", () => {
  it("round-trips encrypt → store → retrieve", async () => {
    const vault = new EvidenceVault(new MemoryBackend(), MASTER);
    const cid = await vault.store(bundle);
    expect(cid).toMatch(/^bafkrei/); // CIDv1 raw sha2-256
    const out = (await vault.retrieve(cid)) as typeof bundle;
    expect(out.claim_hash).toBe(bundle.claim_hash);
    expect(out.claim.latitude).toBe(47.4979);
  });

  it("ciphertext at rest never contains coordinates", async () => {
    const backend = new MemoryBackend();
    const vault = new EvidenceVault(backend, MASTER);
    const cid = await vault.store(bundle);
    const stored = await backend.get(cid);
    const atRest = new TextDecoder().decode(stored!.ciphertext);
    expect(atRest).not.toContain("47.4979");
    expect(atRest).not.toContain("19.0402");
  });

  it("key destruction makes the bundle permanently unreadable", async () => {
    const vault = new EvidenceVault(new MemoryBackend(), MASTER);
    const cid = await vault.store(bundle);
    expect(await vault.destroy(cid)).toBe(true);
    expect(await vault.retrieve(cid)).toBeNull();
    expect(await vault.destroy(cid)).toBe(false); // idempotently gone
  });

  it("returns null for a tampered ciphertext instead of throwing a 500", async () => {
    const backend = new MemoryBackend();
    const vault = new EvidenceVault(backend, MASTER);
    const cid = await vault.store(bundle);
    const stored = await backend.get(cid);
    if (!stored) throw new Error("stored bundle missing");
    stored.ciphertext[0] = (stored.ciphertext[0] ?? 0) ^ 0xff; // flip a byte → auth-tag failure
    expect(await vault.retrieve(cid)).toBeNull();
  });

  it("CIDs are deterministic per content", () => {
    const a = computeCid(new Uint8Array([1, 2, 3]));
    expect(a).toBe(computeCid(new Uint8Array([1, 2, 3])));
    expect(a).not.toBe(computeCid(new Uint8Array([1, 2, 4])));
  });
});

describe("storage API", () => {
  it("ingests, gates retrieval by token, destroys keys", async () => {
    const vault = new EvidenceVault(new MemoryBackend(), MASTER);
    const app = createApp(vault, TOKEN);

    const post = await app.request("/v1/bundles", {
      method: "POST",
      body: JSON.stringify(bundle),
      headers: { "content-type": "application/json" },
    });
    expect(post.status).toBe(201);
    const { cid } = await post.json() as any;

    // No token → forbidden (raw evidence is never public, HARD §13.2).
    expect((await app.request(`/v1/bundles/${cid}`)).status).toBe(403);

    const get = await app.request(`/v1/bundles/${cid}`, {
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    expect(get.status).toBe(200);

    const del = await app.request(`/v1/bundles/${cid}/key`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    expect(del.status).toBe(200);
    expect(
      (
        await app.request(`/v1/bundles/${cid}`, {
          headers: { authorization: `Bearer ${TOKEN}` },
        })
      ).status,
    ).toBe(404);

    // Wrong schema rejected.
    const bad = await app.request("/v1/bundles", {
      method: "POST",
      body: JSON.stringify({ nope: 1 }),
      headers: { "content-type": "application/json" },
    });
    expect(bad.status).toBe(400);
  });
});
