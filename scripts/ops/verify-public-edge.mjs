#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";

const root = new URL("../..", import.meta.url).pathname;
const fail = (msg) => {
  console.error(`[public-edge-verify] ${msg}`);
  process.exit(1);
};
const ok = (msg) => process.stdout.write(`[public-edge-verify] ${msg}\n`);

const forbidden = /(http:\/\/127\.0\.0\.1|http:\/\/localhost|https?:\/\/0\.0\.0\.0|https?:\/\/10\.|https?:\/\/192\.168\.|https?:\/\/172\.(1[6-9]|2\d|3[0-1])\.)/i;
const productionFiles = [
  "apps/static-frontend/src/main.tsx",
  "apps/static-frontend/worker.js",
  "apps/static-frontend/public/config.js",
  "apps/static-frontend/wrangler.toml",
  "scripts/ops/deploy-cloudflare-worker.sh",
];

for (const file of productionFiles) {
  const path = `${root}/${file}`;
  if (!existsSync(path)) fail(`missing expected file ${file}`);
  const body = readFileSync(path, "utf8");
  if (forbidden.test(body) && !file.endsWith("deploy-cloudflare-worker.sh")) {
    fail(`production client/worker file contains forbidden local/private URL: ${file}`);
  }
}

const worker = readFileSync(`${root}/apps/static-frontend/worker.js`, "utf8");
for (const token of ["/api/peers/healthy", "no_healthy_peer", "production_localhost_forbidden", "x-step-route-id", "STEP_PEER_DIRECTORY_URL"]) {
  if (!worker.includes(token)) fail(`worker missing required edge-routing token: ${token}`);
}

const main = readFileSync(`${root}/apps/static-frontend/src/main.tsx`, "utf8");
if (!main.includes('gatewayUrl: window.STEP_CONFIG?.gatewayUrl ?? "/api/gateway"')) fail("web client does not default gateway to /api/gateway");
if (!main.includes('indexerUrl: window.STEP_CONFIG?.indexerUrl ?? "/api/indexer"')) fail("web client does not default indexer to /api/indexer");
if (!main.includes("Mining is fail-closed")) fail("web miner does not fail closed when indexer state is unavailable");

ok("no production localhost dependency detected in client/worker config");
ok("Worker peer-routing and safety tokens are present");
ok("web client defaults to same-origin edge API routes");
