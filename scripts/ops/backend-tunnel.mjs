#!/usr/bin/env node
/**
 * backend-tunnel — expose this machine's gateway (:8080) + indexer (:8090) to the
 * public Cloudflare edge over a NAMED, self-hosted tunnel, so the deployed web
 * worker (step.regiominer.com) and the iOS app can reach the backend without any
 * inbound ports, public IP, or third-party SaaS beyond Cloudflare itself.
 *
 * The tunnel `step-backend` is remotely-managed (ingress configured via the CF
 * API). #68 (audit M6): its run token lives in the OS **keychain**, NOT in the
 * plist or argv — the LaunchAgent runs a wrapper that reads the token from the
 * keychain into `TUNNEL_TOKEN` (the env var cloudflared honours), so the token
 * never appears in a plist literal or in `ps`. Hostnames (ingress, set in CF):
 *   gw.step.regiominer.com  -> http://127.0.0.1:8080  (gateway-api)
 *   idx.step.regiominer.com -> http://127.0.0.1:8090  (indexer)
 *   acc.step.regiominer.com -> http://127.0.0.1:8091  (account-api)
 *   nft.step.regiominer.com -> http://127.0.0.1:8092  (nft-indexer)
 *
 * Usage:
 *   node scripts/ops/backend-tunnel.mjs            # run in the foreground
 *   node scripts/ops/backend-tunnel.mjs --install  # provision token + LaunchAgent
 *   node scripts/ops/backend-tunnel.mjs --rotate   # replace the token (from STEP_TUNNEL_TOKEN)
 *   node scripts/ops/backend-tunnel.mjs --uninstall
 */
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const HOME = process.env.HOME;
const CLOUDFLARED = process.env.CLOUDFLARED_BIN ?? `${HOME}/.local/bin/cloudflared`;
const LABEL = "app.step.backend-tunnel";
const PLIST = `${HOME}/Library/LaunchAgents/${LABEL}.plist`;
const WRAPPER = `${HOME}/.step/backend-tunnel-run.sh`;
const KC_SERVICE = "app.step.tunnel";
const KC_ACCOUNT = "token";
const TUNNEL_ID = "329b02b6-46bb-4273-8751-a4909f9b900f";

/** Store the token in the keychain via stdin (never argv; #64/#68). */
function keychainStore(token) {
  const r = spawnSync("security", ["add-generic-password", "-U", "-s", KC_SERVICE, "-a", KC_ACCOUNT, "-w"], { input: token });
  if ((r.status ?? 1) !== 0) throw new Error("keychain store failed");
}

/** Read the token: keychain first, then env, then gitignored .env (migration). */
function loadToken() {
  try {
    const out = execFileSync("security", ["find-generic-password", "-s", KC_SERVICE, "-a", KC_ACCOUNT, "-w"], {
      stdio: ["ignore", "pipe", "ignore"],
    });
    const t = out.toString().trim();
    if (t) return t;
  } catch { /* not in keychain yet */ }
  if (process.env.STEP_TUNNEL_TOKEN) return process.env.STEP_TUNNEL_TOKEN;
  const envPath = join(ROOT, ".env");
  if (existsSync(envPath)) {
    const line = readFileSync(envPath, "utf8").split("\n").find((l) => l.startsWith("STEP_TUNNEL_TOKEN="));
    if (line) return line.slice("STEP_TUNNEL_TOKEN=".length).trim();
  }
  return null;
}

function dnsReminder() {
  console.log("");
  console.log("Owner action (one-time, CF token cannot edit DNS): add four PROXIED CNAMEs");
  console.log(`in the regiominer.com zone, all -> ${TUNNEL_ID}.cfargotunnel.com :`);
  for (const h of ["gw", "idx", "acc", "nft"]) {
    console.log(`  ${h}.step.regiominer.com`.padEnd(27) + `CNAME  ${TUNNEL_ID}.cfargotunnel.com  (proxied)`);
  }
  console.log("Also add the acc/nft ingress rules in the CF tunnel dashboard (→ :8091, :8092).");
  console.log("");
}

const arg = process.argv[2];

if (arg === "--uninstall") {
  try {
    execFileSync("launchctl", ["bootout", `gui/${process.getuid()}/${LABEL}`], { stdio: "ignore" });
  } catch { /* not loaded */ }
  console.log("backend tunnel LaunchAgent removed (keychain token left in place; delete with `security delete-generic-password -s app.step.tunnel`).");
  process.exit(0);
}

if (arg === "--rotate") {
  const next = process.env.STEP_TUNNEL_TOKEN;
  if (!next) { console.error("set STEP_TUNNEL_TOKEN=<new token> to rotate"); process.exit(1); }
  keychainStore(next);
  try { execFileSync("launchctl", ["kickstart", "-k", `gui/${process.getuid()}/${LABEL}`], { stdio: "ignore" }); } catch { /* not installed */ }
  console.log("tunnel token rotated in the keychain; agent restarted.");
  process.exit(0);
}

const token = loadToken();
if (!token) {
  console.error("no tunnel token (keychain/env/.env). Provide STEP_TUNNEL_TOKEN once, then --install.");
  process.exit(1);
}
if (!existsSync(CLOUDFLARED)) {
  console.error(`cloudflared not found at ${CLOUDFLARED} (set CLOUDFLARED_BIN).`);
  process.exit(1);
}

if (arg === "--install") {
  // 1. Move the token into the keychain (out of .env/plist/argv).
  keychainStore(token);
  // 2. Wrapper reads the token from the keychain into TUNNEL_TOKEN (no argv/plist literal).
  mkdirSync(join(HOME, ".step"), { recursive: true });
  const wrapper = `#!/bin/sh
TUNNEL_TOKEN=$(security find-generic-password -s ${KC_SERVICE} -a ${KC_ACCOUNT} -w) || { echo "tunnel token not in keychain" >&2; exit 1; }
export TUNNEL_TOKEN
exec "${CLOUDFLARED}" tunnel --no-autoupdate run
`;
  writeFileSync(WRAPPER, wrapper, { mode: 0o700 });
  const logDir = join(ROOT, ".runtime/logs");
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key><array><string>${WRAPPER}</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${logDir}/backend-tunnel.out.log</string>
  <key>StandardErrorPath</key><string>${logDir}/backend-tunnel.err.log</string>
</dict></plist>`;
  writeFileSync(PLIST, plist, { mode: 0o600 }); // no token inside
  try {
    execFileSync("launchctl", ["bootout", `gui/${process.getuid()}/${LABEL}`], { stdio: "ignore" });
  } catch { /* fresh install */ }
  execFileSync("launchctl", ["bootstrap", `gui/${process.getuid()}`, PLIST], { stdio: "inherit" });
  console.log(`installed boot-persistent backend tunnel (${LABEL}); token in keychain, not the plist.`);
  dnsReminder();
  process.exit(0);
}

// Foreground run — token via env (TUNNEL_TOKEN), not argv.
dnsReminder();
console.log("running step-backend tunnel (Ctrl-C to stop)…");
const child = spawn(CLOUDFLARED, ["tunnel", "--no-autoupdate", "run"], {
  stdio: "inherit",
  env: { ...process.env, TUNNEL_TOKEN: token },
});
child.on("exit", (code) => process.exit(code ?? 0));
