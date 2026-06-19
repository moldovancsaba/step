#!/usr/bin/env node
/** Stop the STEP pilot stack started by up.mjs. */
import { readFileSync, rmSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const PID_FILE = join(ROOT, ".runtime/pids.json");

if (!existsSync(PID_FILE)) {
  console.log("[down] no .runtime/pids.json — nothing to stop");
  process.exit(0);
}

const procs = JSON.parse(readFileSync(PID_FILE, "utf8"));

// Stop anvil GRACEFULLY (SIGTERM) so it flushes chain state to --state before
// exiting; everything else can be killed hard.
const anvil = procs.find((p) => p.name === "anvil");
if (anvil) {
  try {
    process.kill(anvil.pid, "SIGTERM");
    console.log(`[down] stopping anvil (pid ${anvil.pid}) gracefully to save chain state…`);
    // Give anvil a moment to write its state dump before exiting, polling so we
    // return as soon as it's gone (synchronous sleep via Atomics.wait).
    const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
    for (let i = 0; i < 20; i++) {
      try {
        process.kill(anvil.pid, 0); // still alive?
        sleep(100);
      } catch {
        break; // gone
      }
    }
  } catch {
    /* already gone */
  }
}

for (const { name, pid } of procs) {
  if (name === "anvil") continue; // handled above
  try {
    process.kill(pid, "SIGKILL");
    console.log(`[down] killed ${name} (pid ${pid})`);
  } catch {
    console.log(`[down] ${name} (pid ${pid}) already gone`);
  }
}
// Best-effort final SIGKILL for anvil in case SIGTERM didn't land.
if (anvil) {
  try {
    process.kill(anvil.pid, "SIGKILL");
  } catch {
    /* already exited cleanly */
  }
}
rmSync(PID_FILE, { force: true });
console.log("[down] stack stopped");
