#!/usr/bin/env node
/**
 * Local installer acceptance runner for STEP Trust Center packages.
 *
 * This is intentionally non-destructive by default: it inspects the package,
 * validates the sha256 sidecar, and checks the install scripts for the required
 * operational guarantees. Use --install to also install to the current Mac and
 * run `step-trustcenter doctor --json`.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const die = (m) => {
  console.error(`[pkg-e2e] ${m}`);
  process.exit(1);
};
const log = (m) => process.stdout.write(`[pkg-e2e] ${m}\n`);

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) {
      const key = argv[i].slice(2);
      out[key] = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[(i += 1)] : "true";
    }
  }
  return out;
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

const args = parseArgs(process.argv.slice(2));
const pkg = args.pkg;
if (!pkg) die("--pkg path is required");
if (!existsSync(pkg)) die(`package not found: ${pkg}`);

const sidecar = `${pkg}.sha256`;
if (!existsSync(sidecar)) die(`sha256 sidecar missing: ${sidecar}`);
const expected = readFileSync(sidecar, "utf8").trim().split(/\s+/)[0].replace(/^0x/, "");
const actual = sha256(pkg);
if (actual !== expected) die(`sha256 mismatch: expected ${expected}, got ${actual}`);
log("sha256 sidecar matches package bytes");

const expandRoot = mkdtempSync(join(tmpdir(), "step-pkg-e2e-"));
const expandDir = join(expandRoot, "expanded");
execFileSync("pkgutil", ["--expand-full", pkg, expandDir], { stdio: "pipe" });
const bom = execFileSync("find", [expandDir, "-type", "f"], { encoding: "utf8" });
for (const required of ["step-node-agent", "step-trustcenter", "postinstall"]) {
  if (!bom.includes(required)) die(`expanded package does not contain ${required}`);
}
log("package expands with node-agent, step-trustcenter, and postinstall");

const scripts = bom
  .split("\n")
  .filter((p) => p.endsWith("postinstall") || p.endsWith("step-trustcenter"))
  .map((p) => readFileSync(p, "utf8"))
  .join("\n");
for (const token of ["provision", "doctor", "launchctl", "app.step.node-agent", "step.trustcenter.pair"]) {
  if (!scripts.includes(token)) die(`installer scripts missing required token: ${token}`);
}
log("installer scripts expose provision/start/doctor and pairing payload behavior");

if (args.install === "true") {
  log("installing package to / (requires sudo/admin policy if installer prompts)");
  execFileSync("installer", ["-pkg", pkg, "-target", "/"], { stdio: "inherit" });
  execFileSync("/usr/local/bin/step-trustcenter", ["doctor", "--json"], { stdio: "inherit" });
}

log("pkg acceptance checks passed");
