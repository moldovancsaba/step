#!/usr/bin/env node
/**
 * Destructive disaster-survival drill.
 *
 * Stops the local Tribecca gateway/fleet/validator services, proves a remote
 * Trust Center still exposes the required independent service path, then always
 * restores the stopped launchd services. This is intentionally fail-closed: if
 * any remote survival endpoint is absent, the script exits non-zero.
 */
import { execFileSync, spawnSync } from "node:child_process";
import net from "node:net";

const uid = process.getuid?.() ?? Number(execFileSync("id", ["-u"], { encoding: "utf8" }).trim());
const stoppedLabels = (process.env.STEP_DRILL_STOP_LABELS ??
  "app.step.gateway-api,app.step.fleet-api,app.step.node-agent-tribecca-0,app.step.node-agent-tribecca-1,app.step.node-agent-tribecca-2")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const remoteHost = process.env.STEP_DRILL_REMOTE_HOST ?? "chappie.local";
const expectedQuorum = BigInt(process.env.STEP_EXPECTED_QUORUM ?? "101");
const checks = [
  { name: "agent", kind: "http", url: process.env.STEP_DRILL_AGENT_URL ?? `http://${remoteHost}:9200/healthz`, expectText: "ok" },
  { name: "gateway", kind: "http", url: process.env.STEP_DRILL_GATEWAY_URL ?? `http://${remoteHost}:8080/healthz`, expectText: "ok" },
  { name: "fleet", kind: "fleet", url: process.env.STEP_DRILL_FLEET_URL ?? `http://${remoteHost}:8099/v1/fleet` },
  { name: "chain_rpc", kind: "jsonrpc", url: process.env.STEP_DRILL_CHAIN_RPC_URL ?? `http://${remoteHost}:8645` },
  { name: "validator", kind: "http", url: process.env.STEP_DRILL_VALIDATOR_URL ?? `http://${remoteHost}:9104/healthz`, expectText: "ok" },
  { name: "gossip", kind: "tcp", host: process.env.STEP_DRILL_GOSSIP_HOST ?? remoteHost, port: Number(process.env.STEP_DRILL_GOSSIP_PORT ?? "4001") }
];

const log = (msg) => process.stdout.write(`[disaster-survival] ${msg}\n`);
const errors = [];

function launchctl(args, allowFail = true) {
  const result = spawnSync("launchctl", args, { encoding: "utf8" });
  if (result.status !== 0 && !allowFail) {
    throw new Error((result.stderr || result.stdout || `launchctl ${args.join(" ")} failed`).trim());
  }
  return result;
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function tcpOpen(host, port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    const done = (ok) => {
      socket.destroy();
      resolve(ok);
    };
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
    setTimeout(() => done(false), 2500);
  });
}

async function httpText(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`);
  return response.text();
}

async function checkEndpoint(check) {
  if (check.kind === "http") {
    const body = (await httpText(check.url)).trim();
    if (check.expectText && body !== check.expectText) throw new Error(`${check.name} returned ${JSON.stringify(body)}, expected ${JSON.stringify(check.expectText)}`);
    return;
  }
  if (check.kind === "fleet") {
    const response = await fetch(check.url, { signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error(`${check.url} returned HTTP ${response.status}`);
    const fleet = await response.json();
    if (fleet.quorumReachable !== true) throw new Error("remote fleet quorumReachable is not true");
    if (BigInt(fleet.totalActiveWeight ?? 0) < expectedQuorum) throw new Error(`remote fleet active weight ${fleet.totalActiveWeight} below ${expectedQuorum}`);
    if (Array.isArray(fleet.alerts) && fleet.alerts.length > 0) {
      throw new Error(`remote fleet has alerts: ${JSON.stringify(fleet.alerts)}`);
    }
    return;
  }
  if (check.kind === "jsonrpc") {
    const response = await fetch(check.url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }),
      signal: AbortSignal.timeout(5000)
    });
    if (!response.ok) throw new Error(`${check.url} returned HTTP ${response.status}`);
    const body = await response.json();
    if (!body.result) throw new Error(`chain RPC did not return eth_chainId: ${JSON.stringify(body)}`);
    return;
  }
  if (check.kind === "tcp") {
    if (!(await tcpOpen(check.host, check.port))) throw new Error(`${check.host}:${check.port} is not reachable`);
    return;
  }
  throw new Error(`unknown check kind ${check.kind}`);
}

async function main() {
  log(`stopping local services: ${stoppedLabels.join(", ")}`);
  for (const label of stoppedLabels) launchctl(["bootout", `gui/${uid}/${label}`], true);
  await sleep(5000);

  try {
    for (const check of checks) {
      try {
        await checkEndpoint(check);
        log(`ok ${check.name}`);
      } catch (error) {
        errors.push(`${check.name}: ${error.message}`);
        log(`FAIL ${check.name}: ${error.message}`);
      }
    }
  } finally {
    log("restoring local services");
    for (const label of stoppedLabels) {
      const plist = `${process.env.HOME}/Library/LaunchAgents/${label}.plist`;
      launchctl(["bootstrap", `gui/${uid}`, plist], true);
    }
    await sleep(5000);
  }

  if (errors.length > 0) {
    process.stderr.write(`[disaster-survival] failed:\n- ${errors.join("\n- ")}\n`);
    process.exit(1);
  }
  log("remote Trust Center survived local Tribecca outage");
}

main().catch((error) => {
  process.stderr.write(`[disaster-survival] ${error.stack ?? error.message}\n`);
  process.exit(1);
});
