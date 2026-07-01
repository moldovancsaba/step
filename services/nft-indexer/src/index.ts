/**
 * NFT + marketplace indexer entrypoint: polls the chain for logs from the
 * TriangleSlotNFT (#4) and TriangleMarketplace (#8) contracts, projects them,
 * and serves the read/metadata API.
 *
 * Env: STEP_RPC_URL, STEP_CHAIN_ID, STEP_DEPLOYMENTS_FILE, NFT_INDEXER_PORT,
 * NFT_METADATA_BASE_URL (optional external_url base), STEP_CORS_ORIGINS.
 *
 * The deployments file must contain TriangleSlotNFT and TriangleMarketplace
 * addresses once those contracts are deployed (#5 wiring); until then this
 * service runs and serves an empty projection.
 */
import { serve } from "@hono/node-server";
import { readFileSync } from "node:fs";
import { createPublicClient, defineChain, http, type Address } from "viem";
import { createApi } from "./api.js";
import { applyEvent, decodeLogs } from "./events.js";
import { scanWindows } from "./scan.js";
import { NftStore } from "./store.js";

function env(key: string): string {
  const v = process.env[key];
  if (!v) throw new Error(`missing env ${key}`);
  return v;
}

const deployments = JSON.parse(readFileSync(env("STEP_DEPLOYMENTS_FILE"), "utf8"));
const watched: Address[] = [deployments.TriangleSlotNFT, deployments.TriangleMarketplace].filter(
  (a): a is Address => typeof a === "string" && a.length === 42,
);

const chain = defineChain({
  id: Number(env("STEP_CHAIN_ID")),
  name: "step-internal",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [env("STEP_RPC_URL")] } },
});
const client = createPublicClient({ chain, transport: http() });
const store = new NftStore();

// cosmos-EVM caps eth_getLogs at ~10k blocks; scan in bounded windows so a large
// catch-up gap doesn't throw and stall NFT indexing (matches services/indexer).
const MAX_LOG_RANGE = BigInt(process.env.STEP_INDEX_MAX_RANGE ?? "5000");

async function poll() {
  if (watched.length === 0) return;
  try {
    const head = await client.getBlockNumber();
    for (const [from, to] of scanWindows(store.lastBlock + 1n, head, MAX_LOG_RANGE)) {
      const logs = await client.getLogs({ address: watched, fromBlock: from, toBlock: to });
      for (const event of decodeLogs(logs)) applyEvent(store, event);
      if (logs.length > 0) console.log(`nft-indexer: applied ${logs.length} logs ${from}..${to}`);
      store.lastBlock = to;
    }
  } catch (err) {
    console.error("poll error:", err instanceof Error ? err.message : err);
  }
}

const port = Number(process.env.NFT_INDEXER_PORT ?? 8092);
const corsOrigins = process.env.STEP_CORS_ORIGINS
  ? process.env.STEP_CORS_ORIGINS.split(",").map((s) => s.trim()).filter(Boolean)
  : [];
console.log(`nft-indexer listening on :${port}, watching ${watched.length} contracts`);
serve({
  fetch: createApi(store, corsOrigins, { externalBaseUrl: process.env.NFT_METADATA_BASE_URL }).fetch,
  port,
});
setInterval(poll, 2000);
void poll();
