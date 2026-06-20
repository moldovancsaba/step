#!/usr/bin/env node
/**
 * Hub supervisor (#49) — idempotently keeps the hub stack up. Run by launchd at
 * boot (install-hub.mjs). If the stack is already healthy it no-ops; otherwise it
 * brings it up via scripts/dev/up.mjs (which reuses the persisted chain state).
 * Stays in the foreground so launchd can supervise it.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import net from "node:net";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const PID_FILE = join(ROOT, ".runtime/pids.json");
const PATH_EXT = `${process.env.HOME}/.cargo/bin:${process.env.HOME}/.foundry/bin:${process.env.PATH}`;
const log = (m) => process.stdout.write(`[hub-supervisor] ${m}\n`);

function portOpen(port) {
  return new Promise((resolve) => {
    const s = net.connect(port, "127.0.0.1");
    s.once("connect", () => { s.destroy(); resolve(true); });
    s.once("error", () => resolve(false));
    setTimeout(() => { s.destroy(); resolve(false); }, 1000);
  });
}

async function stackHealthy() {
  if (!existsSync(PID_FILE)) return false;
  // anvil + a validator + account-api responding ⇒ healthy enough
  return (await portOpen(8545)) && (await portOpen(9101)) && (await portOpen(8091));
}

async function main() {
  if (await stackHealthy()) {
    log("stack already healthy — nothing to do");
  } else {
    // stale pids.json from a crash blocks up.mjs; clear it, then bring up.
    if (existsSync(PID_FILE)) {
      try {
        execFileSync("node", [join(ROOT, "scripts/dev/down.mjs")], { cwd: ROOT, stdio: "inherit", env: { ...process.env, PATH: PATH_EXT } });
      } catch { /* best effort */ }
    }
    log("bringing the hub stack up (reuses persisted chain)…");
    const r = spawnSync("node", [join(ROOT, "scripts/dev/up.mjs")], { cwd: ROOT, stdio: "inherit", env: { ...process.env, PATH: PATH_EXT } });
    if (r.status !== 0) { log(`up.mjs failed (status ${r.status})`); process.exit(1); }
  }
  // Stay alive so launchd supervises us; periodically re-assert health.
  log("supervising hub (KeepAlive). Ctrl-C / launchctl bootout to stop.");
  for (;;) {
    await new Promise((res) => setTimeout(res, 60_000));
    if (!(await stackHealthy())) {
      log("stack became unhealthy — restarting…");
      const r = spawnSync("node", [join(ROOT, "scripts/dev/up.mjs")], { cwd: ROOT, stdio: "inherit", env: { ...process.env, PATH: PATH_EXT } });
      if (r.status !== 0) log(`restart up.mjs failed (status ${r.status})`);
    }
  }
}

main().catch((e) => { log(`ERROR: ${e.message}`); process.exit(1); });
