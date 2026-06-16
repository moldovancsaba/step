#!/usr/bin/env node

import { spawn } from "node:child_process";

function cleanBase(value) {
  return value?.trim().replace(/\/+$/, "") || "";
}

function getBase() {
  return cleanBase(process.env.STEP_WEB_BASE_URL) || "https://step.moldovancsaba.workers.dev";
}

function getBackendBase(base, envKey, suffix) {
  const envValue = cleanBase(process.env[envKey]);
  if (envValue) return envValue;
  return `${base}${suffix}`;
}

async function checkUrl(name, url) {
  const start = performance.now();
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${name} -> ${response.status} ${response.statusText}`);
  }
  const time = Math.round(performance.now() - start);
  return `${name}: ${response.status} (${time}ms)`;
}

function openInBrowser(url) {
  if (process.env.STEP_WEB_OPEN_PAGES === "0") return Promise.resolve();
  const opener = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  return new Promise((resolve) => {
    const child = spawn(opener, args, {
      detached: true,
      stdio: "ignore",
    });
    child.on("error", () => {
      console.warn(`Could not open ${url}`);
      resolve();
    });
    child.unref();
    resolve();
  });
}

async function main() {
  const base = getBase();
  const gatewayBase = getBackendBase(base, "STEP_WEB_GATEWAY_BASE_URL", "/api/gateway");
  const indexerBase = getBackendBase(base, "STEP_WEB_INDEXER_BASE_URL", "/api/indexer");

  const checks = [
    { name: "Frontend config", url: `${base}/config.js` },
    { name: "Explorer", url: `${base}/explorer` },
    { name: "Mesh explorer", url: `${base}/explorer/mesh` },
    { name: "Miner", url: `${base}/miner` },
    { name: "Gateway health", url: `${gatewayBase}/healthz` },
    { name: "Indexer health", url: `${indexerBase}/healthz` },
  ];

  console.log("Checking required endpoints...");
  let failed = false;
  for (const check of checks) {
    try {
      const line = await checkUrl(check.name, check.url);
      console.log(`  OK  ${line}`);
    } catch (error) {
      failed = true;
      console.error(`  FAIL ${check.name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (failed) {
    console.error("Some required endpoints are not ready. Aborting auto-open.");
    process.exit(1);
  }

  const pages = [
    `${base}/`,
    `${base}/explorer`,
    `${base}/explorer/mesh`,
    `${base}/miner`,
  ];

  console.log("All checks passed. Opening web pages...");
  for (const page of pages) {
    await openInBrowser(page);
    await new Promise((resolve) => setTimeout(resolve, 600));
  }

  console.log("Done.");
  console.log(`Base: ${base}`);
  console.log(`Gateway: ${gatewayBase}`);
  console.log(`Indexer: ${indexerBase}`);
  console.log("Set STEP_WEB_OPEN_PAGES=0 to skip auto-open.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
