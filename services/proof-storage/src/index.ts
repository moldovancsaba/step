/**
 * Proof storage service: POST /v1/bundles (ingest+encrypt), GET (foundation
 * token only), DELETE key destruction. Env: EVIDENCE_MASTER_KEY (64 hex),
 * FOUNDATION_API_TOKEN, PROOF_STORAGE_PORT.
 * IPFS pinning of ciphertext blocks is additive at deployment (kubo in
 * Compose); CIDs computed here are kubo-compatible raw-block CIDs.
 */
import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { EvidenceVault, MemoryBackend } from "./vault.js";

function env(key: string): string {
  const v = process.env[key];
  if (!v) throw new Error(`missing env ${key}`);
  return v;
}

const masterKey = Uint8Array.from(Buffer.from(env("EVIDENCE_MASTER_KEY"), "hex"));
const vault = new EvidenceVault(new MemoryBackend(), masterKey);
const app = createApp(vault, env("FOUNDATION_API_TOKEN"));
const port = Number(process.env.PROOF_STORAGE_PORT ?? 8095);
console.log(`proof-storage listening on :${port}`);
serve({ fetch: app.fetch, port });
