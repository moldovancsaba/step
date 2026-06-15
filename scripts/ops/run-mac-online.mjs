#!/usr/bin/env node
/**
 * Foreground runner for the Mac mini online sandbox.
 *
 * Intended for launchd or a terminal session. It builds the static frontend,
 * starts the native STEP backend when needed, then runs the online gateway on
 * STEP_ONLINE_GATEWAY_PORT (default :8070). Stop with Ctrl-C or launchctl
 * unload; the wrapper stops the native backend it started.
 */
import { spawn, execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const PID_FILE = join(ROOT, ".runtime/pids.json");
let gateway;
let startedBackend = false;
let stopping = false;

function log(message) {
  process.stdout.write(`[mac-online] ${message}\n`);
}

function run(command, args, env = {}) {
  execFileSync(command, args, {
    cwd: ROOT,
    stdio: "inherit",
    env: { ...process.env, ...env },
  });
}

function stopBackend() {
  if (!startedBackend) return;
  try {
    run("node", ["scripts/dev/down.mjs"]);
  } catch (err) {
    log(`backend stop failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function shutdown(signal) {
  if (stopping) return;
  stopping = true;
  log(`received ${signal}; stopping online gateway`);
  if (gateway && !gateway.killed) gateway.kill("SIGTERM");
  stopBackend();
  process.exit(0);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

log("building static frontend");
run("pnpm", ["--filter", "@step/static-frontend", "build"]);

if (!existsSync(PID_FILE)) {
  log("starting STEP backend stack");
  run("node", ["scripts/dev/up.mjs"]);
  startedBackend = true;
} else {
  log("backend stack already appears to be running");
}

log("starting online gateway");
gateway = spawn("pnpm", ["--filter", "@step/online-gateway", "dev"], {
  cwd: ROOT,
  stdio: "inherit",
  env: process.env,
});

gateway.on("exit", (code, signal) => {
  if (!stopping) {
    log(`online gateway exited code=${code ?? "-"} signal=${signal ?? "-"}`);
    stopBackend();
    process.exit(code ?? 1);
  }
});
