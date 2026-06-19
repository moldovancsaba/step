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
 * Reads .runtime/.env.runtime (hub chain config) + .runtime/nodes/<name>.json
 * (the node's saved key/identity). The remote node needs NO repo, foundry, or
 * chain write access — only this bundle + the hub reachable over the tailnet.
 *
 * SECURITY: provision-secrets.sh carries the node's key + nonce secret; move the
 * bundle only to a trusted machine over the tailnet. Written under .runtime/.
 */
import { execSync } from "node:child_process";
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

function loadRuntimeEnv() {
  const out = {};
  for (const line of readFileSync(join(RUNTIME, ".env.runtime"), "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/); if (m) out[m[1]] = m[2];
  }
  return out;
}

const cfgFile = join(RUNTIME, "nodes", `${args.name}.json`);
if (!existsSync(cfgFile)) die(`no saved identity for "${args.name}" — register it first (node join … --no-launch)`);
const node = JSON.parse(readFileSync(cfgFile, "utf8"));
const env = loadRuntimeEnv();

const platform = args.platform ?? "darwin-arm64";
const platformId = sh(`cast keccak "${platform}"`);
const advertiseHost = args["advertise-host"] ?? "127.0.0.1";
const port = Number(args.port ?? node.port ?? 9104);
const agentPort = Number(args["agent-port"] ?? 9200);
const tailnetIp = (() => {
  for (const b of ["tailscale", "/Applications/Tailscale.app/Contents/MacOS/Tailscale"]) {
    try { const ip = execSync(`${b} ip -4`, { stdio: "pipe" }).toString().trim().split("\n")[0].trim(); if (/^\d+\.\d+\.\d+\.\d+$/.test(ip)) return ip; } catch { /* next */ }
  }
  return "127.0.0.1";
})();
const hubRpc = args["hub-rpc"] ?? `http://${tailnetIp}:8545`;
const hubArtifacts = args["hub-artifacts"] ?? `http://${tailnetIp}:8078`;
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
security add-generic-password -U -s "${keychainService}" -a "${acct("validatorKey")}" -w "${node.privateKey}"
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
  2. ./run-agent.sh                   # start the agent (foreground)
     # for boot-persistence, install as a service instead (see the hub repo's
     # scripts/node/install-agent.mjs and trust-center runbook).

Verify on the hub:
  node scripts/node/list.mjs          # ${args.name} flips DOWN -> up
  curl -s http://127.0.0.1:8099/v1/fleet | jq   # fleet view

SECURITY: provision-secrets.sh contains this node's private key + the shared nonce
secret. Keep this bundle on trusted machines only.
`);

const tgz = join(RUNTIME, `agent-${args.name}.tgz`);
execSync(`tar -czf "${tgz}" -C "${RUNTIME}" "agent-bundle-${args.name}"`, { stdio: "pipe" });
rmSync(stage, { recursive: true, force: true });

log("");
log(`✓ agent bundle ready: ${tgz}`);
log(`  built for:  ${arch}`);
log(`  hub RPC:    ${hubRpc}`);
log(`  artifacts:  ${hubArtifacts}`);
log(`  advertised: ${advertiseHost}:${port}`);
log("");
log(`Deliver + run on ${args.name}:`);
log(`  tailscale file cp "${tgz}" ${args.name}:`);
log(`  # on ${args.name}: tar -xzf agent-${args.name}.tgz && cd agent-bundle-${args.name}`);
log(`  #                  ./provision-secrets.sh && ./run-agent.sh`);
