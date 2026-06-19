#!/usr/bin/env node
/**
 * `node list` — show the STEP trust-center federation.
 *
 * For each node in the directory (.runtime/nodes.json) it cross-checks the three
 * sources of truth: the directory entry, the on-chain ValidatorRegistry weight
 * (the trust anchor), and the node's live /v1/node/info + /healthz. A node is
 * only genuinely trusted when its directory address has a non-zero on-chain
 * active weight AND it answers.
 */
import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const RUNTIME = join(ROOT, ".runtime");
const PATH_EXT = `${process.env.HOME}/.cargo/bin:${process.env.HOME}/.foundry/bin:${process.env.PATH}`;

function loadRuntimeEnv() {
  const file = join(RUNTIME, ".env.runtime");
  const out = {};
  if (existsSync(file)) {
    for (const line of readFileSync(file, "utf8").split("\n")) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m) out[m[1]] = m[2];
    }
  }
  return out;
}

const rt = loadRuntimeEnv();
const rpcUrl = process.env.STEP_RPC_URL ?? rt.STEP_RPC_URL;
const deploymentsFile = process.env.STEP_DEPLOYMENTS_FILE ?? rt.STEP_DEPLOYMENTS_FILE;
let registry = process.env.VALIDATOR_REGISTRY;
if (!registry && deploymentsFile && existsSync(deploymentsFile)) {
  registry = JSON.parse(readFileSync(deploymentsFile, "utf8")).ValidatorRegistry;
}

const dirFile = rt.NODE_DIRECTORY_FILE ?? join(RUNTIME, "nodes.json");
if (!existsSync(dirFile)) {
  console.log("No federation directory yet. Start the stack: node scripts/dev/up.mjs");
  process.exit(0);
}
const nodes = (JSON.parse(readFileSync(dirFile, "utf8")).nodes ?? []);

function onchainWeight(address) {
  if (!registry || !rpcUrl) return "?";
  try {
    return execSync(
      `cast call ${registry} "activeWeight(address)(uint256)" ${address} --rpc-url ${rpcUrl}`,
      { stdio: "pipe", env: { ...process.env, PATH: PATH_EXT } },
    )
      .toString()
      .trim()
      .split(" ")[0];
  } catch {
    return "err";
  }
}

async function liveInfo(url) {
  try {
    const r = await fetch(`${url}/v1/node/info`, { signal: AbortSignal.timeout(2500) });
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}

let totalActive = 0n;
const rows = [];
for (const n of nodes) {
  const w = onchainWeight(n.address);
  const info = await liveInfo(n.url);
  const healthy = info !== null;
  // Trust = registered on-chain (weight>0) AND the live address matches.
  const addrMatch = healthy && info.validator?.toLowerCase() === n.address.toLowerCase();
  if (healthy && /^\d+$/.test(w)) totalActive += BigInt(w);
  rows.push({
    name: n.name,
    type: n.type,
    location: n.location,
    url: n.url,
    address: n.address,
    onchain: w,
    health: healthy ? "up" : "DOWN",
    verified: addrMatch ? "yes" : healthy ? "ADDR-MISMATCH" : "-",
  });
}

const threshold = rt.STEP_PROTOCOL_PARAMS
  ? quorumThreshold(rt.STEP_PROTOCOL_PARAMS)
  : "?";

console.log(`STEP federation — ${rows.length} trust-center node(s)\n`);
const pad = (s, n) => String(s).padEnd(n);
console.log(
  pad("NAME", 14) + pad("TYPE", 15) + pad("WEIGHT", 8) + pad("HEALTH", 8) + pad("VERIFIED", 15) + "URL",
);
for (const r of rows) {
  console.log(
    pad(r.name, 14) +
      pad(r.type, 15) +
      pad(r.onchain, 8) +
      pad(r.health, 8) +
      pad(r.verified, 15) +
      r.url,
  );
}
console.log(
  `\nLive active weight: ${totalActive}` +
    (threshold !== "?" ? `  |  quorum threshold: ${threshold}` : "") +
    (threshold !== "?"
      ? `  →  ${totalActive >= BigInt(threshold) ? "QUORUM REACHABLE" : "below quorum"}`
      : ""),
);

function quorumThreshold(paramsFile) {
  try {
    const p = JSON.parse(readFileSync(paramsFile, "utf8"));
    return String(p.validators?.quorum_threshold_weight?.value ?? "?");
  } catch {
    return "?";
  }
}
