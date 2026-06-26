#!/usr/bin/env node
/**
 * Build a self-contained AGENT bundle for a remote trust center (the hardened,
 * self-maintaining deployment — #40-#44). Unlike `bundle.mjs` (which runs a bare
 * validator), this runs `step-node-agent`, which fetches the authorized release
 * from the hub, verifies its sha256 against the on-chain ReleaseRegistry, runs a
 * canary, activates, auto-rolls-back on failure, and continuously self-checks.
 *
 *   node scripts/node/bundle-agent.mjs --name chappie \
 *        --advertise-host chappie.tailc0f646.ts.net --port 9104
 *
 * Legacy keyed mode reads .runtime/.env.runtime (hub chain config) plus local
 * key material. This is disabled by default because production Trust Centers
 * must generate/store identity on the target machine.
 *
 * SECURITY: use the keyless Trust Center installer/package for real nodes.
 * Set STEP_ALLOW_KEYED_BUNDLE=1 only for local-dev migration.
 */
import { execSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, copyFileSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const RUNTIME = join(ROOT, ".runtime");
const PATH_EXT = `${process.env.HOME}/.cargo/bin:${process.env.HOME}/.foundry/bin:${process.env.PATH}`;
const die = (m) => { console.error(`[agent-bundle] ${m}`); process.exit(1); };
const log = (m) => process.stdout.write(`[agent-bundle] ${m}\n`);
const sh = (c) => execSync(c, { cwd: ROOT, stdio: "pipe", env: { ...process.env, PATH: PATH_EXT } }).toString().trim();

const args = (() => {
  const a = {}; const v = process.argv.slice(2);
  for (let i = 0; i < v.length; i++) if (v[i].startsWith("--")) a[v[i].slice(2)] = v[i + 1] && !v[i + 1].startsWith("--") ? v[++i] : "true";
  return a;
})();
if (!args.name) die("--name required");
if (process.env.STEP_ALLOW_KEYED_BUNDLE !== "1") {
  die("legacy keyed agent bundles are disabled. Use scripts/node/install.sh or scripts/release/build-macos-pkg.mjs so the node generates its own local Keychain identity.");
}
// L2 (audit): this bundle EMBEDS the node's private key (provision-secrets.sh), so
// it must travel only over a trusted channel (LAN/scp/USB). For anything off a
// trusted LAN, prefer the keyless installer — the node generates its own key and
// nothing secret transits:  scripts/node/install.sh (see ADR-023).
log("note: keyed bundle (trusted-LAN delivery only). Off-LAN? use scripts/node/install.sh (keyless).");

function loadRuntimeEnv() {
  const out = {};
  for (const line of readFileSync(join(RUNTIME, ".env.runtime"), "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/); if (m) out[m[1]] = m[2];
  }
  return out;
}
function keychainGet(address, key) {
  const service = process.env.SECRET_SERVICE ?? "app.step.node";
  const out = spawnSync("security", [
    "find-generic-password",
    "-s",
    service,
    "-a",
    `step.node.${address.toLowerCase()}.${key}`,
    "-w",
  ], { encoding: "utf8" });
  return out.status === 0 ? out.stdout.trim() : null;
}

const cfgFile = join(RUNTIME, "nodes", `${args.name}.json`);
if (!existsSync(cfgFile)) die(`no saved identity for "${args.name}" — register it first (node join … --no-launch)`);
const node = JSON.parse(readFileSync(cfgFile, "utf8"));
const nodePrivateKey = node.privateKey ?? keychainGet(node.address, "validatorKey");
if (!nodePrivateKey) die(`no local key material for "${args.name}" — use the keyless installer/package on the target node`);
const env = loadRuntimeEnv();

const platform = args.platform ?? "darwin-arm64";
const platformId = sh(`cast keccak "${platform}"`);
const advertiseHost = args["advertise-host"] ?? "127.0.0.1";
const port = Number(args.port ?? node.port ?? 9104);
const agentPort = Number(args["agent-port"] ?? 9200);
// Hub host resolution (#48), in priority order — third-party-free first:
//   --hub-host <name|ip>  (LAN mDNS like `tribecca.local`, a reserved IP, or a
//                          self-hosted WireGuard tunnel IP) → derives both ports
//   --hub-rpc / --hub-artifacts  (full override)
//   else Tailscale IP (OPTIONAL convenience), else loopback.
const tailnetIp = (() => {
  for (const b of ["tailscale", "/Applications/Tailscale.app/Contents/MacOS/Tailscale"]) {
    try { const ip = execSync(`${b} ip -4`, { stdio: "pipe" }).toString().trim().split("\n")[0].trim(); if (/^\d+\.\d+\.\d+\.\d+$/.test(ip)) return ip; } catch { /* next */ }
  }
  return "127.0.0.1";
})();
const hubHost = args["hub-host"]; // explicit, third-party-free
const defaultHost = hubHost ?? tailnetIp;
const transport = hubHost ? (/^\d/.test(hubHost) ? "lan/wireguard (ip)" : "lan (mDNS)") : "tailscale (optional)";
const hubRpc = args["hub-rpc"] ?? `http://${defaultHost}:8545`;
const hubArtifacts = args["hub-artifacts"] ?? `http://${defaultHost}:8078`;
const verifier = JSON.parse(readFileSync(env.STEP_DEPLOYMENTS_FILE, "utf8")).MiningClaimVerifier;
const keychainService = "app.step.node";
const acct = (k) => `step.node.${node.address.toLowerCase()}.${k}`;

// build the agent binary (the validator is fetched from the hub, not bundled)
const agentBin = join(ROOT, "target/release/step-node-agent");
if (!existsSync(agentBin)) { log("building step-node-agent (release)…"); execSync("cargo build -p step-node-agent --release", { cwd: ROOT, stdio: "inherit", env: { ...process.env, PATH: PATH_EXT } }); }
const arch = sh("uname -sm");

const stage = join(RUNTIME, `agent-bundle-${args.name}`);
rmSync(stage, { recursive: true, force: true });
mkdirSync(stage, { recursive: true });
copyFileSync(agentBin, join(stage, "step-node-agent"));
// shared params/config must byte-match the published hashes (the agent re-verifies)
copyFileSync(env.STEP_PROTOCOL_PARAMS, join(stage, "protocol-params.json"));
const cfgSrc = join(RUNTIME, "releases", "config-1.0.0.json");
if (existsSync(cfgSrc)) copyFileSync(cfgSrc, join(stage, "config.json"));
else die("no released config (config-1.0.0.json) — publish a release first");

writeFileSync(join(stage, "provision-secrets.sh"), `#!/usr/bin/env bash
# Store this node's secrets in the macOS keychain (run ONCE).
set -euo pipefail
security add-generic-password -U -s "${keychainService}" -a "${acct("validatorKey")}" -w "${nodePrivateKey}"
security add-generic-password -U -s "${keychainService}" -a "${acct("nonceSecret")}" -w "${env.GATEWAY_NONCE_SECRET}"
echo "secrets provisioned for ${args.name}."
`, { mode: 0o700 });

writeFileSync(join(stage, "run-agent.sh"), `#!/usr/bin/env bash
# STEP self-maintaining trust center "${args.name}" — runs the node-agent.
# Built for: ${arch}.  Run ./provision-secrets.sh ONCE first.
set -euo pipefail
cd "$(dirname "$0")"
chmod +x ./step-node-agent
ROOT_DIR="\${AGENT_ROOT:-$HOME/step-node}"
mkdir -p "$ROOT_DIR/releases"
# shared params/config the agent re-verifies against the on-chain release hashes
cp -f ./protocol-params.json "$ROOT_DIR/shared-params.json"
cp -f ./config.json          "$ROOT_DIR/shared-config.json"
export AGENT_ROOT="$ROOT_DIR"
export STEP_RPC_URL="${hubRpc}"
export RELEASE_REGISTRY="${env.RELEASE_REGISTRY}"
export NODE_ADDRESS="${node.address}"
export PLATFORM_ID="${platformId}"
export PLATFORM="${platform}"
export ARTIFACT_BASE_URL="${hubArtifacts}"
export VERIFIER_CONTRACT_ADDRESS="${verifier}"
export STEP_CHAIN_ID="${env.STEP_CHAIN_ID}"
export VALIDATOR_PORT="${port}"
export AGENT_PORT="${agentPort}"
export AGENT_POLL_INTERVAL="\${AGENT_POLL_INTERVAL:-30}"
export AGENT_INTEGRITY_INTERVAL="\${AGENT_INTEGRITY_INTERVAL:-300}"
export SECRET_BACKEND="keychain"
echo "Starting node-agent for ${args.name}: validator :${port} (advertised ${advertiseHost}:${port}), agent status :${agentPort}"
echo "It will fetch + verify + activate the authorized release from the hub."
exec ./step-node-agent
`, { mode: 0o755 });

// Self-contained boot-persistence (#49): install run-agent.sh as a LaunchAgent so
// the node-agent starts at login and restarts on crash — no repo needed on the
// target. (LaunchAgent runs on user login; for a headless Mac mini enable
// auto-login, or adapt to a LaunchDaemon with sudo for true boot start.)
const svcLabel = "app.step.node-agent";
writeFileSync(join(stage, "install-service.sh"), `#!/usr/bin/env bash
# Make this trust center boot-persistent (LaunchAgent). Run after provision-secrets.sh.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
DEST="$HOME/Library/Application Support/step-node-agent"
mkdir -p "$DEST" "$HOME/Library/LaunchAgents"
cp -f "$HERE"/step-node-agent "$HERE"/protocol-params.json "$HERE"/config.json "$HERE"/run-agent.sh "$DEST"/
chmod +x "$DEST/step-node-agent" "$DEST/run-agent.sh"
PLIST="$HOME/Library/LaunchAgents/${svcLabel}.plist"
cat > "$PLIST" <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>${svcLabel}</string>
  <key>ProgramArguments</key><array><string>$DEST/run-agent.sh</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
  <key>StandardOutPath</key><string>$DEST/agent.out.log</string>
  <key>StandardErrorPath</key><string>$DEST/agent.err.log</string>
</dict></plist>
PL
launchctl bootout "gui/$(id -u)/${svcLabel}" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
launchctl enable "gui/$(id -u)/${svcLabel}"
echo "✓ ${args.name} installed as a LaunchAgent (starts at login, restarts on crash)."
echo "  stop:    launchctl bootout gui/$(id -u)/${svcLabel}"
echo "  logs:    $DEST/agent.out.log"
`, { mode: 0o755 });

writeFileSync(join(stage, "README.txt"), `STEP self-maintaining trust center: ${args.name}
================================================
Built for: ${arch}

This runs the node-AGENT (hardened): it fetches the foundation-authorized release
from the hub, verifies its sha256 against the on-chain ReleaseRegistry, canaries
it, activates, auto-rolls-back on failure, and continuously self-checks integrity
(quarantining itself if tampered). The validator binary is downloaded from the hub
— not shipped here.

Prerequisites on this machine:
  - reachable over the tailnet to the hub RPC ${hubRpc} and artifacts ${hubArtifacts}
  - inbound :${port} open so the hub gateway can reach the validator

Run (in this folder):
  1. ./provision-secrets.sh           # store key + nonce in the keychain (once)
  2a. ./run-agent.sh                  # foreground (stops when the terminal closes)
  2b. ./install-service.sh            # RECOMMENDED: boot-persistent LaunchAgent
                                      #   (starts at login, restarts on crash; no repo needed)

Verify on the hub:
  node scripts/node/list.mjs          # ${args.name} flips DOWN -> up
  curl -s http://127.0.0.1:8099/v1/fleet | jq   # fleet view

SECURITY: provision-secrets.sh contains this node's private key + the shared nonce
secret. This legacy bundle is only for explicit local-dev migration. Use the
keyless Trust Center installer/package for real nodes.
`);

const tgz = join(RUNTIME, `agent-${args.name}.tgz`);
execSync(`tar -czf "${tgz}" -C "${RUNTIME}" "agent-bundle-${args.name}"`, { stdio: "pipe" });
rmSync(stage, { recursive: true, force: true });

log("");
log(`✓ agent bundle ready: ${tgz}`);
log(`  built for:  ${arch}`);
log(`  transport:  ${transport}`);
log(`  hub RPC:    ${hubRpc}`);
log(`  artifacts:  ${hubArtifacts}`);
log(`  advertised: ${advertiseHost}:${port}`);
log("");
log(`Deliver + run on ${args.name}:`);
log(`  tailscale file cp "${tgz}" ${args.name}:`);
log(`  # on ${args.name}: tar -xzf agent-${args.name}.tgz && cd agent-bundle-${args.name}`);
log(`  #                  ./provision-secrets.sh && ./run-agent.sh`);
