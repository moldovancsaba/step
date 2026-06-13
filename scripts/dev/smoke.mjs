#!/usr/bin/env node
/** Thin wrapper: run the pilot smoke test against a running stack. */
import { execSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
try {
  execSync("pnpm --filter @step/e2e exec tsx src/smoke.ts", {
    cwd: ROOT,
    stdio: "inherit",
    env: { ...process.env, PATH: `${process.env.HOME}/.cargo/bin:${process.env.HOME}/.foundry/bin:${process.env.PATH}` },
  });
} catch {
  process.exit(1);
}
