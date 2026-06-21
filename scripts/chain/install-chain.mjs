#!/usr/bin/env node
/**
 * install-chain — make the sovereign chain (evmd) boot-persistent on this machine,
 * like the agent and the tunnel. A LaunchAgent (RunAtLoad + KeepAlive) runs
 * `scripts/chain/start.sh`, so the chain survives a reboot/crash. No sudo (user
 * agent). Gas floor + chain home come from the plist env (defaults: devnet).
 *
 *   node scripts/chain/install-chain.mjs            # install + start
 *   node scripts/chain/install-chain.mjs --uninstall
 */
import { execFileSync } from "node:child_process";
import { writeFileSync as write } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const HOME = process.env.HOME;
const LABEL = "app.step.chain";
const PLIST = `${HOME}/Library/LaunchAgents/${LABEL}.plist`;
const sh = (cmd, args) => execFileSync(cmd, args, { stdio: "inherit" });

if (process.argv.includes("--uninstall")) {
  try { execFileSync("launchctl", ["bootout", `gui/${process.getuid()}/${LABEL}`], { stdio: "ignore" }); } catch { /* not loaded */ }
  console.log("sovereign-chain LaunchAgent removed.");
  process.exit(0);
}

const logDir = join(ROOT, ".runtime/logs");
// Env baked into the agent. STEP_LOCAL_DEV=1 ⇒ 0 gas (devnet sandbox). For a real
// federation set STEP_MIN_GAS_PRICE and drop STEP_LOCAL_DEV (start.sh enforces it).
const env = {
  STEP_LOCAL_DEV: process.env.STEP_LOCAL_DEV ?? "1",
  STEP_MIN_GAS_PRICE: process.env.STEP_MIN_GAS_PRICE ?? "",
  STEP_CHAIN_HOME: process.env.STEP_CHAIN_HOME ?? `${HOME}/.evmd`,
  STEP_EVM_RPC_PORT: process.env.STEP_EVM_RPC_PORT ?? "8645",
  EVMD: process.env.EVMD ?? `${HOME}/.local/bin/evmd`,
  PATH: `${HOME}/.local/bin:/usr/local/bin:/usr/bin:/bin`,
};
const envXml = Object.entries(env)
  .filter(([, v]) => v !== "")
  .map(([k, v]) => `    <key>${k}</key><string>${v}</string>`)
  .join("\n");

const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key><array>
    <string>/bin/sh</string><string>${join(ROOT, "scripts/chain/start.sh")}</string>
  </array>
  <key>EnvironmentVariables</key><dict>
${envXml}
  </dict>
  <key>WorkingDirectory</key><string>${ROOT}</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${join(logDir, "chain.out.log")}</string>
  <key>StandardErrorPath</key><string>${join(logDir, "chain.err.log")}</string>
</dict></plist>`;
write(PLIST, plist, { mode: 0o644 });
try { execFileSync("launchctl", ["bootout", `gui/${process.getuid()}/${LABEL}`], { stdio: "ignore" }); } catch { /* fresh */ }
sh("launchctl", ["bootstrap", `gui/${process.getuid()}`, PLIST]);
console.log(`✓ sovereign chain installed boot-persistent (${LABEL}); EVM RPC on :${env.STEP_EVM_RPC_PORT}.`);
console.log("  verify:  launchctl print gui/$(id -u)/app.step.chain | head");
