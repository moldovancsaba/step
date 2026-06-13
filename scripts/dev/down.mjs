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
for (const { name, pid } of procs) {
  try {
    process.kill(pid, "SIGKILL");
    console.log(`[down] killed ${name} (pid ${pid})`);
  } catch {
    console.log(`[down] ${name} (pid ${pid}) already gone`);
  }
}
rmSync(PID_FILE, { force: true });
console.log("[down] stack stopped");
