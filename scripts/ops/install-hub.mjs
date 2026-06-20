#!/usr/bin/env node
/**
 * Install the hub stack as a boot-persistent service (#49). macOS: a LaunchDaemon
 * that runs hub-supervisor.mjs at boot (RunAtLoad + KeepAlive). So tribecca's
 * chain + artifact server + services come back on reboot with no human.
 *
 *   sudo node scripts/ops/install-hub.mjs            # install + start
 *   sudo node scripts/ops/install-hub.mjs --uninstall
 */
import { execSync } from "node:child_process";
import { writeFileSync, rmSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const LABEL = "app.step.hub";
const PLIST = `/Library/LaunchDaemons/${LABEL}.plist`;
const log = (m) => process.stdout.write(`[install-hub] ${m}\n`);
const sh = (c) => execSync(c, { stdio: "pipe" }).toString().trim();
const uninstall = process.argv.includes("--uninstall");

if (process.platform !== "darwin") {
  console.error("[install-hub] only macOS (launchd) is implemented; Linux/systemd is analogous.");
  process.exit(2);
}

if (uninstall) {
  try { sh(`launchctl bootout system ${PLIST}`); } catch { /* not loaded */ }
  rmSync(PLIST, { force: true });
  log("removed hub LaunchDaemon");
  process.exit(0);
}

const node = sh("command -v node");
const home = process.env.HOME ?? sh("echo $HOME");
const user = process.env.SUDO_USER ?? process.env.USER ?? "";
const logsDir = join(ROOT, ".runtime/logs");
mkdirSync(logsDir, { recursive: true });

const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>Label</key><string>${LABEL}</string>
    <key>ProgramArguments</key>
    <array>
      <string>${node}</string>
      <string>${join(ROOT, "scripts/ops/hub-supervisor.mjs")}</string>
    </array>
    <key>EnvironmentVariables</key>
    <dict>
      <key>HOME</key><string>${home}</string>
      <key>PATH</key><string>${home}/.cargo/bin:${home}/.foundry/bin:/usr/local/bin:/usr/bin:/bin</string>
    </dict>
${user ? `    <key>UserName</key><string>${user}</string>\n` : ""}    <key>WorkingDirectory</key><string>${ROOT}</string>
    <key>RunAtLoad</key><true/>
    <key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
    <key>StandardOutPath</key><string>${join(logsDir, "hub.out.log")}</string>
    <key>StandardErrorPath</key><string>${join(logsDir, "hub.err.log")}</string>
  </dict>
</plist>
`;
writeFileSync(PLIST, plist);
log(`wrote ${PLIST}`);
try { sh(`launchctl bootout system ${PLIST}`); } catch { /* not loaded yet */ }
sh(`launchctl bootstrap system ${PLIST}`);
sh(`launchctl enable system/${LABEL}`);
log("");
log("✓ hub installed as a LaunchDaemon (RunAtLoad + KeepAlive).");
log("  verify:  launchctl print system/" + LABEL + " | head");
log("  logs:    .runtime/logs/hub.out.log");
