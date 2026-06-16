#!/usr/bin/env node
/**
 * Start the complete local development experience:
 * backend stack (via up.mjs) + static frontend + web miner + web explorer.
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const PID_FILE = join(ROOT, ".runtime", "pids.json");
const children = [];
let startedBackendByUs = false;
let stopping = false;

function log(message) {
  process.stdout.write(`[stack] ${message}\n`);
}

function spawnChild(name, command, args, env = {}) {
  const child = spawn(command, args, {
    cwd: ROOT,
    env: { ...process.env, ...env },
    stdio: "inherit",
  });
  children.push({ name, child });

  child.on("exit", (code, signal) => {
    if (stopping) return;
    log(`${name} exited (code=${code ?? "-"}, signal=${signal ?? "-"})`);
    stopAll(1);
  });

  return child;
}

function stopAll(exitCode = 0) {
  if (stopping) return;
  stopping = true;

  for (const { name, child } of children.slice().reverse()) {
    if (!child.killed) {
      try {
        child.kill("SIGTERM");
        log(`stopped ${name}`);
      } catch {}
    }
  }

  if (startedBackendByUs && existsSync(PID_FILE)) {
    try {
      spawnSync("node", ["scripts/dev/down.mjs"], { cwd: ROOT, stdio: "inherit" });
    } catch {
      /* best-effort cleanup */
    }
  }

  process.exit(exitCode);
}

process.on("SIGINT", () => stopAll(0));
process.on("SIGTERM", () => stopAll(0));

const backendAlreadyRunning = existsSync(PID_FILE);
if (backendAlreadyRunning) {
  log("backend appears to be already running (.runtime/pids.json exists)");
} else {
  log("starting backend stack...");
  startBackend();
}

spawnChild("static-frontend", "pnpm", ["--filter", "@step/static-frontend", "dev"]);
spawnChild("web-miner", "pnpm", [
  "--filter",
  "@step/web-miner",
  "dev",
], {
  GATEWAY_URL: "http://127.0.0.1:8080",
  MESH_API_URL: "http://127.0.0.1:9101",
  STEP_RPC_URL: "http://127.0.0.1:8545",
  STEP_DEPLOYMENTS_FILE: `${ROOT}/contracts/deployments/31337.json`,
});
spawnChild("web-explorer", "pnpm", ["--filter", "@step/web-explorer", "dev"]);

log("all services launched");
log("URLs:");
log("  static frontend:  http://127.0.0.1:3010");
log("  web miner:       http://127.0.0.1:3003");
log("  web explorer:    http://127.0.0.1:3000");

function startBackend() {
  spawnChild("backend", "node", ["scripts/dev/up.mjs"]);
  startedBackendByUs = true;
}

if (!backendAlreadyRunning) {
  log("backend is managed by this process. stop with Ctrl+C.");
}
