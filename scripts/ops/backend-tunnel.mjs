#!/usr/bin/env node
/**
 * backend-tunnel — expose this machine's gateway (:8080) + indexer (:8090) to the
 * public Cloudflare edge over a NAMED, self-hosted tunnel, so the deployed web
 * worker (step.regiominer.com) and the iOS app can reach the backend without any
 * inbound ports, public IP, or third-party SaaS beyond Cloudflare itself.
 *
 * The tunnel `step-backend` is remotely-managed (ingress configured via the CF
 * API); its run token lives in gitignored `.env` as STEP_TUNNEL_TOKEN. Hostnames:
 *   gw.step.regiominer.com  -> http://127.0.0.1:8080  (gateway-api)
 *   idx.step.regiominer.com -> http://127.0.0.1:8090  (indexer)
 *
 * Usage:
 *   node scripts/ops/backend-tunnel.mjs           # run in the foreground
 *   node scripts/ops/backend-tunnel.mjs --install  # install a boot-persistent LaunchAgent
 *   node scripts/ops/backend-tunnel.mjs --uninstall
 *
 * One-time owner step (the CF token cannot edit DNS): in the Cloudflare dashboard
 * add two PROXIED CNAMEs in the regiominer.com zone, both pointing at
 *   <TUNNEL_ID>.cfargotunnel.com
 * for `gw.step.regiominer.com` and `idx.step.regiominer.com`. The script prints
 * the exact target.
 */
import { execFileSync, spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const HOME = process.env.HOME;
const CLOUDFLARED = process.env.CLOUDFLARED_BIN ?? `${HOME}/.local/bin/cloudflared`;
const LABEL = "app.step.backend-tunnel";
const PLIST = `${HOME}/Library/LaunchAgents/${LABEL}.plist`;
const TUNNEL_ID = "329b02b6-46bb-4273-8751-a4909f9b900f";

function loadToken() {
  // STEP_TUNNEL_TOKEN from the environment, else from gitignored .env.
  if (process.env.STEP_TUNNEL_TOKEN) return process.env.STEP_TUNNEL_TOKEN;
  const envPath = join(ROOT, ".env");
  if (existsSync(envPath)) {
    const line = readFileSync(envPath, "utf8")
      .split("\n")
      .find((l) => l.startsWith("STEP_TUNNEL_TOKEN="));
    if (line) return line.slice("STEP_TUNNEL_TOKEN=".length).trim();
  }
  return null;
}

function dnsReminder() {
  console.log("");
  console.log("Owner action (one-time, CF token cannot edit DNS): add two PROXIED CNAMEs");
  console.log(`in the regiominer.com zone, both -> ${TUNNEL_ID}.cfargotunnel.com :`);
  console.log("  gw.step.regiominer.com   CNAME  " + `${TUNNEL_ID}.cfargotunnel.com  (proxied)`);
  console.log("  idx.step.regiominer.com  CNAME  " + `${TUNNEL_ID}.cfargotunnel.com  (proxied)`);
  console.log("");
}

const arg = process.argv[2];

if (arg === "--uninstall") {
  try {
    execFileSync("launchctl", ["bootout", `gui/${process.getuid()}/${LABEL}`], { stdio: "ignore" });
  } catch { /* not loaded */ }
  console.log("backend tunnel LaunchAgent removed.");
  process.exit(0);
}

const token = loadToken();
if (!token) {
  console.error("STEP_TUNNEL_TOKEN missing (env or .env). Re-provision the tunnel token.");
  process.exit(1);
}
if (!existsSync(CLOUDFLARED)) {
  console.error(`cloudflared not found at ${CLOUDFLARED} (set CLOUDFLARED_BIN).`);
  process.exit(1);
}

if (arg === "--install") {
  const logDir = join(ROOT, ".runtime/logs");
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key><array>
    <string>${CLOUDFLARED}</string>
    <string>tunnel</string><string>--no-autoupdate</string>
    <string>run</string><string>--token</string><string>${token}</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${logDir}/backend-tunnel.out.log</string>
  <key>StandardErrorPath</key><string>${logDir}/backend-tunnel.err.log</string>
</dict></plist>`;
  writeFileSync(PLIST, plist, { mode: 0o600 }); // token inside ⇒ user-only perms
  try {
    execFileSync("launchctl", ["bootout", `gui/${process.getuid()}/${LABEL}`], { stdio: "ignore" });
  } catch { /* fresh install */ }
  execFileSync("launchctl", ["bootstrap", `gui/${process.getuid()}`, PLIST], { stdio: "inherit" });
  console.log(`installed boot-persistent backend tunnel (${LABEL}).`);
  dnsReminder();
  process.exit(0);
}

// Foreground run.
dnsReminder();
console.log("running step-backend tunnel (Ctrl-C to stop)…");
const child = spawn(CLOUDFLARED, ["tunnel", "--no-autoupdate", "run", "--token", token], {
  stdio: "inherit",
});
child.on("exit", (code) => process.exit(code ?? 0));
