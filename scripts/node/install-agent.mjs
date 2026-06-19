#!/usr/bin/env node
/**
 * Install the trust-center as a SYSTEM SERVICE (#44) — launchd on macOS, systemd
 * on Linux — so the node-agent runs unattended, starts on boot, and restarts on
 * crash, under a least-privilege account. Replaces the foreground run.sh.
 *
 *   sudo node scripts/node/install-agent.mjs            # install + start
 *   sudo node scripts/node/install-agent.mjs --uninstall
 *
 * Required env (the node's chain wiring; usually baked by the remote bundle):
 *   AGENT_ROOT, STEP_RPC_URL, RELEASE_REGISTRY, NODE_ADDRESS, PLATFORM_ID
 * Optional: PLATFORM, AGENT_PORT, ARTIFACT_BASE_URL, SERVICE_USER, AGENT_BIN.
 */
import { execSync } from "node:child_process";
import { existsSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const LABEL = "app.step.node-agent";
const die = (m) => {
  console.error(`[install] ${m}`);
  process.exit(1);
};
const log = (m) => process.stdout.write(`[install] ${m}\n`);
const sh = (cmd) => execSync(cmd, { stdio: "pipe" }).toString().trim();

const args = new Set(process.argv.slice(2));
const uninstall = args.has("--uninstall");
const platform = process.platform; // 'darwin' | 'linux'

const agentBin =
  process.env.AGENT_BIN ?? join(ROOT, "target/release/step-node-agent");
const serviceUser = process.env.SERVICE_USER ?? null;

// The environment the service runs with (the node's chain identity + wiring).
const SERVICE_ENV_KEYS = [
  "AGENT_ROOT",
  "STEP_RPC_URL",
  "RELEASE_REGISTRY",
  "NODE_ADDRESS",
  "PLATFORM_ID",
  "PLATFORM",
  "AGENT_PORT",
  "ARTIFACT_BASE_URL",
  "AGENT_POLL_INTERVAL",
  "AGENT_INTEGRITY_INTERVAL",
];

function serviceEnv() {
  const env = {};
  for (const k of SERVICE_ENV_KEYS) if (process.env[k]) env[k] = process.env[k];
  return env;
}

// ───────────────────────────── macOS (launchd) ─────────────────────────────
function macPlistPath() {
  return `/Library/LaunchDaemons/${LABEL}.plist`;
}
function macPlist(env) {
  const envXml = Object.entries(env)
    .map(([k, v]) => `      <key>${k}</key><string>${escapeXml(v)}</string>`)
    .join("\n");
  const userKey = serviceUser ? `    <key>UserName</key><string>${serviceUser}</string>\n` : "";
  const logDir = env.AGENT_ROOT ? join(env.AGENT_ROOT, "logs") : "/tmp";
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>Label</key><string>${LABEL}</string>
    <key>ProgramArguments</key>
    <array><string>${agentBin}</string></array>
    <key>EnvironmentVariables</key>
    <dict>
${envXml}
    </dict>
${userKey}    <key>RunAtLoad</key><true/>
    <key>KeepAlive</key>
    <dict><key>SuccessfulExit</key><false/></dict>
    <key>StandardOutPath</key><string>${join(logDir, "node-agent.out.log")}</string>
    <key>StandardErrorPath</key><string>${join(logDir, "node-agent.err.log")}</string>
  </dict>
</plist>
`;
}

function installMac() {
  if (!existsSync(agentBin)) die(`agent binary not found at ${agentBin} (build it or set AGENT_BIN)`);
  const env = serviceEnv();
  if (!env.AGENT_ROOT) die("AGENT_ROOT is required");
  mkdirSync(join(env.AGENT_ROOT, "logs"), { recursive: true });
  const path = macPlistPath();
  writeFileSync(path, macPlist(env));
  log(`wrote ${path}`);
  try {
    sh(`launchctl bootout system ${path}`);
  } catch {
    /* not loaded yet */
  }
  sh(`launchctl bootstrap system ${path}`);
  sh(`launchctl enable system/${LABEL}`);
  log(`loaded LaunchDaemon ${LABEL} (RunAtLoad + KeepAlive)`);
}

function uninstallMac() {
  const path = macPlistPath();
  try {
    sh(`launchctl bootout system ${path}`);
  } catch {
    /* already gone */
  }
  rmSync(path, { force: true });
  log("removed LaunchDaemon");
}

// ───────────────────────────── Linux (systemd) ─────────────────────────────
function systemdUnitPath() {
  return `/etc/systemd/system/${LABEL}.service`;
}
function systemdUnit(env) {
  const envLines = Object.entries(env)
    .map(([k, v]) => `Environment=${k}=${v}`)
    .join("\n");
  const user = serviceUser ? `User=${serviceUser}\n` : "";
  return `[Unit]
Description=STEP trust-center node-agent
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=${agentBin}
${envLines}
${user}Restart=on-failure
RestartSec=5
# least privilege
NoNewPrivileges=true
ProtectSystem=strict
ReadWritePaths=${env.AGENT_ROOT ?? "/var/lib/step-node"}
ProtectHome=true

[Install]
WantedBy=multi-user.target
`;
}

function installLinux() {
  if (!existsSync(agentBin)) die(`agent binary not found at ${agentBin}`);
  const env = serviceEnv();
  if (!env.AGENT_ROOT) die("AGENT_ROOT is required");
  const path = systemdUnitPath();
  writeFileSync(path, systemdUnit(env));
  log(`wrote ${path}`);
  sh("systemctl daemon-reload");
  sh(`systemctl enable ${LABEL}`);
  sh(`systemctl restart ${LABEL}`);
  log(`enabled + started ${LABEL} (Restart=on-failure)`);
}

function uninstallLinux() {
  try {
    sh(`systemctl disable --now ${LABEL}`);
  } catch {
    /* already gone */
  }
  rmSync(systemdUnitPath(), { force: true });
  sh("systemctl daemon-reload");
  log("removed systemd unit");
}

function escapeXml(s) {
  return String(s).replace(/[<>&'"]/g, (c) =>
    ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[c],
  );
}

// ───────────────────────────── dispatch ─────────────────────────────
if (platform === "darwin") {
  uninstall ? uninstallMac() : installMac();
} else if (platform === "linux") {
  uninstall ? uninstallLinux() : installLinux();
} else {
  die(`unsupported platform: ${platform}`);
}

if (!uninstall) {
  log("");
  log("service installed. Verify:");
  log(
    platform === "darwin"
      ? `  launchctl print system/${LABEL} | head`
      : `  systemctl status ${LABEL}`,
  );
  log(`  curl -s http://127.0.0.1:${process.env.AGENT_PORT ?? 9200}/v1/agent/status`);
}
