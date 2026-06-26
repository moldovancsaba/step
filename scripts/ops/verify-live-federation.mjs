#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";

const root = new URL("../..", import.meta.url).pathname;
const runtimeEnvPath = `${root}/.runtime/.env.runtime`;
const fail = (msg) => {
  console.error(`[live-federation-verify] ${msg}`);
  process.exit(1);
};
const ok = (msg) => process.stdout.write(`[live-federation-verify] ${msg}\n`);

function runtimeEnv() {
  const out = {};
  if (!existsSync(runtimeEnvPath)) return out;
  for (const line of readFileSync(runtimeEnvPath, "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

async function json(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
  if (!response.ok) fail(`${url} returned ${response.status}`);
  return response.json();
}

async function text(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
  if (!response.ok) fail(`${url} returned ${response.status}`);
  return response.text();
}

const env = runtimeEnv();
const fleetUrl = process.env.STEP_BACKEND_FLEET_URL ?? env.STEP_BACKEND_FLEET_URL ?? "http://127.0.0.1:8099";
const gatewayUrl = process.env.STEP_BACKEND_GATEWAY_URL ?? env.STEP_BACKEND_GATEWAY_URL ?? "http://127.0.0.1:8080";
const expectedQuorum = process.env.STEP_EXPECTED_QUORUM ?? "101";
const requiredRemote = process.env.STEP_REQUIRED_REMOTE_NODE ?? "";

const gatewayHealth = (await text(`${gatewayUrl.replace(/\/$/, "")}/healthz`)).trim();
if (gatewayHealth !== "ok") fail(`gateway health is not ok: ${gatewayHealth}`);

const fleet = await json(`${fleetUrl.replace(/\/$/, "")}/v1/fleet`);
if (String(fleet.quorumThreshold) !== expectedQuorum) {
  fail(`fleet quorumThreshold is ${fleet.quorumThreshold}, expected ${expectedQuorum}`);
}
if (fleet.quorumReachable !== true) fail("fleet quorum is not reachable");
if (BigInt(fleet.totalActiveWeight ?? 0) < BigInt(expectedQuorum)) {
  fail(`active weight ${fleet.totalActiveWeight} is below quorum ${expectedQuorum}`);
}
if (Array.isArray(fleet.alerts) && fleet.alerts.length > 0) {
  fail(`fleet has alerts: ${JSON.stringify(fleet.alerts)}`);
}

const nodes = Array.isArray(fleet.nodes) ? fleet.nodes : [];
if (nodes.length < 2) fail("fleet has fewer than two nodes");
const remote = requiredRemote
  ? nodes.find((node) => node.name === requiredRemote)
  : nodes.find((node) => node.transport === "peer" && node.inQuorum === true && String(node.p2pAddress ?? node.url ?? "").startsWith("/"));
const remoteLabel = requiredRemote || "peer-native remote node";
if (!remote) fail(`required remote node not found: ${remoteLabel}`);
if (remote.reachable !== true || remote.inQuorum !== true) {
  fail(`${remoteLabel} is not reachable and in quorum`);
}
if (remote.transport !== "peer") fail(`${remoteLabel} is not peer-native`);
if (!String(remote.p2pAddress ?? remote.url ?? "").startsWith("/")) {
  fail(`${remoteLabel} does not expose a peer multiaddr`);
}
if (/^https?:\/\/(127\.0\.0\.1|localhost|0\.0\.0\.0)/i.test(String(remote.url ?? ""))) {
  fail(`${remoteLabel} is still exposed as localhost in fleet view`);
}

ok(`gateway health ok at ${gatewayUrl}`);
ok(`fleet quorum reachable: active=${fleet.totalActiveWeight} threshold=${fleet.quorumThreshold}`);
ok(`${remote.name ?? remoteLabel} is peer-native and in quorum`);
