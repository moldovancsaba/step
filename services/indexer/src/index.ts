/**
 * Indexer entrypoint: polls the chain for logs from the deployed contracts,
 * projects them into the store, serves the explorer REST API.
 * Env: STEP_RPC_URL, STEP_CHAIN_ID, STEP_DEPLOYMENTS_FILE, INDEXER_PORT.
 */
import { serve } from "@hono/node-server";
import { readFileSync } from "node:fs";
import { createPublicClient, defineChain, http, type Address } from "viem";
import { createApi } from "./api.js";
import { applyEvent, decodeLogs } from "./events.js";
import { MemoryStore } from "./store.js";

function env(key: string): string {
  const v = process.env[key];
  if (!v) throw new Error(`missing env ${key}`);
  return v;
}

const deployments = JSON.parse(readFileSync(env("STEP_DEPLOYMENTS_FILE"), "utf8"));
const watched: Address[] = [
  deployments.MiningClaimVerifier,
  deployments.FoundationTreasury,
  deployments.CampaignRegistry,
  deployments.SafetyRegistry,
  deployments.ValidatorRegistry,
];

const chain = defineChain({
  id: Number(env("STEP_CHAIN_ID")),
  name: "step-internal",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [env("STEP_RPC_URL")] } },
});
const client = createPublicClient({ chain, transport: http() });
const store = new MemoryStore();

async function poll() {
  try {
    const head = await client.getBlockNumber();
    if (head > store.lastBlock) {
      const logs = await client.getLogs({
        address: watched,
        fromBlock: store.lastBlock + 1n,
        toBlock: head,
      });
      for (const event of decodeLogs(logs)) applyEvent(store, event);
      if (logs.length > 0) {
        console.log(`indexed ${logs.length} logs up to block ${head}`);
      }
      store.lastBlock = head;
    }
  } catch (err) {
    console.error("poll error:", err instanceof Error ? err.message : err);
  }
}

const port = Number(process.env.INDEXER_PORT ?? 8090);
const corsOrigins = process.env.STEP_CORS_ORIGINS
  ? process.env.STEP_CORS_ORIGINS.split(",").map((s) => s.trim()).filter(Boolean)
  : [];
// Mineable slots per triangle for the oasis/desert overlay (#16). Read from the
// protocol params file when present; otherwise the contract default (27).
let totalSlots = 27;
const paramsFile = process.env.STEP_PROTOCOL_PARAMS;
if (paramsFile) {
  try {
    const raw = JSON.parse(readFileSync(paramsFile, "utf8"));
    const v = raw?.mining?.collector_slots_per_triangle?.value;
    if (typeof v === "number" && v > 0) totalSlots = v;
  } catch (err) {
    console.warn("could not read collector_slots_per_triangle; using 27:", err);
  }
}

console.log(`indexer listening on :${port}, watching ${watched.length} contracts`);
serve({ fetch: createApi(store, corsOrigins, { totalSlots }).fetch, port });
setInterval(poll, 2000);
void poll();
