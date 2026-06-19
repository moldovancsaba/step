#!/usr/bin/env node
/**
 * `node bundle` — build a self-contained run bundle for a REMOTE trust-center
 * node (one you registered with `join --no-launch`).
 *
 * The validator binary does NOT talk to the chain — it only needs the verifier
 * address + chain id + protocol params + its key + the shared nonce secret. So a
 * remote node needs no RPC access and no repo: just this bundle. The hub
 * (tribecca) already did the on-chain registration and added the node to the
 * gateway directory; the remote machine only has to RUN the binary.
 *
 * Produces .runtime/remote-<name>.tgz containing:
 *   step-validator-node   the release binary (this machine's arch)
 *   protocol-params.json  the validation parameters
 *   run.sh                exports the node's env and execs the binary
 *   README.txt            copy + run instructions
 *
 * Usage:  node scripts/node/bundle.mjs --name vienna --port 9104 \
 *              --url http://vienna.tailnet.ts.net:9104
 *
 * SECURITY: the bundle contains the node's private key and the shared nonce
 * secret. Move it only to a machine you trust, over a trusted transport (the
 * tailnet). It is written under .runtime/ (gitignored).
 */
import { execSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const RUNTIME = join(ROOT, ".runtime");
const PATH_EXT = `${process.env.HOME}/.cargo/bin:${process.env.HOME}/.foundry/bin:${process.env.PATH}`;

function die(m) {
  console.error(`[bundle] ${m}`);
  process.exit(1);
}
function log(m) {
  process.stdout.write(`[bundle] ${m}\n`);
}
function parseArgs(argv) {
  const a = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) {
      const k = argv[i].slice(2);
      a[k] = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[(i += 1)] : "true";
    }
  }
  return a;
}
function loadRuntimeEnv() {
  const file = join(RUNTIME, ".env.runtime");
  const out = {};
  if (existsSync(file)) {
    for (const line of readFileSync(file, "utf8").split("\n")) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m) out[m[1]] = m[2];
    }
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
if (!args.name) die("--name is required");

const nodeCfgFile = join(RUNTIME, "nodes", `${args.name}.json`);
if (!existsSync(nodeCfgFile)) {
  die(`no saved config for "${args.name}". Register it first:\n` +
    `  node scripts/node/join.mjs --name ${args.name} --port <port> --no-launch --url <url>`);
}
const cfg = JSON.parse(readFileSync(nodeCfgFile, "utf8"));
const rt = loadRuntimeEnv();
const pick = (k) => process.env[k] ?? rt[k];

const chainId = pick("STEP_CHAIN_ID");
const nonceSecret = pick("GATEWAY_NONCE_SECRET");
const deploymentsFile = pick("STEP_DEPLOYMENTS_FILE");
let verifier = process.env.VERIFIER_CONTRACT_ADDRESS;
if (!verifier && deploymentsFile && existsSync(deploymentsFile)) {
  verifier = JSON.parse(readFileSync(deploymentsFile, "utf8")).MiningClaimVerifier;
}
if (!chainId || !nonceSecret || !verifier) {
  die("missing chain config — start the hub (scripts/dev/up.mjs) so .runtime/.env.runtime exists");
}

const port = Number(args.port ?? cfg.port);
const url = args.url ?? `http://127.0.0.1:${port}`;

// Build the release binary (this machine's arch) if needed.
const bin = join(ROOT, "target/release/step-validator-node");
if (!existsSync(bin)) {
  log("building validator-node (release)…");
  execSync("cargo build -p step-validator-node --release", {
    cwd: ROOT,
    stdio: "inherit",
    env: { ...process.env, PATH: PATH_EXT },
  });
}
const arch = execSync("uname -sm").toString().trim();

// Assemble the bundle dir.
const stage = join(RUNTIME, `bundle-${args.name}`);
rmSync(stage, { recursive: true, force: true });
mkdirSync(stage, { recursive: true });
copyFileSync(bin, join(stage, "step-validator-node"));
copyFileSync(
  pick("STEP_PROTOCOL_PARAMS") ?? join(ROOT, "config/protocol-params.alpha.json"),
  join(stage, "protocol-params.json"),
);

const corsOrigins = pick("STEP_CORS_ORIGINS") ?? "";
const runSh = `#!/usr/bin/env bash
# STEP trust-center node "${cfg.name}" — run this on the target machine.
# Built for: ${arch}
set -euo pipefail
cd "$(dirname "$0")"
chmod +x ./step-validator-node
export VALIDATOR_PORT=${port}
export STEP_CHAIN_ID=${chainId}
export VERIFIER_CONTRACT_ADDRESS=${verifier}
export VALIDATOR_PRIVATE_KEY=${cfg.privateKey}
export GATEWAY_NONCE_SECRET=${nonceSecret}
export STEP_PROTOCOL_PARAMS=./protocol-params.json
export STEP_CORS_ORIGINS='${corsOrigins}'
export VALIDATOR_ALLOW_DEV_CLAIMS=${process.env.VALIDATOR_ALLOW_DEV_CLAIMS ?? "true"}
export NODE_NAME='${cfg.name}'
export NODE_TYPE='${cfg.type}'
export NODE_LOCATION='${cfg.location}'
echo "Starting STEP node ${cfg.name} on :${port} (advertised ${url})"
exec ./step-validator-node
`;
writeFileSync(join(stage, "run.sh"), runSh, { mode: 0o755 });

const readme = `STEP trust-center node bundle: ${cfg.name}
================================================

This runs an independent STEP trust center: it re-checks every mining claim and
signs a weighted vote. It was already registered on-chain by the hub.

Built for architecture: ${arch}
(If the target machine is a different arch, build from source instead:
 clone the repo and run: cargo build -p step-validator-node --release)

Advertised URL (the hub's gateway reaches the node here): ${url}
  → make sure this machine is reachable at that host:port over your tailnet,
    and that the port (${port}) is open.

To run:
  1. Copy this whole folder to the target machine (over the tailnet), e.g.:
       scp -r <this-folder> <user>@${new URL(url).hostname}:~/step-node
  2. On the target machine:
       cd ~/step-node && ./run.sh
  3. Back on the hub, verify it joined and votes:
       node scripts/node/list.mjs

SECURITY: run.sh contains this node's private key and the shared nonce secret.
Keep the bundle on trusted machines only.
`;
writeFileSync(join(stage, "README.txt"), readme);

// Tar it up.
const tgz = join(RUNTIME, `remote-${args.name}.tgz`);
execSync(`tar -czf "${tgz}" -C "${RUNTIME}" "bundle-${args.name}"`, { stdio: "pipe" });
rmSync(stage, { recursive: true, force: true });

log("");
log(`✓ bundle ready: ${tgz}`);
log(`  built for:  ${arch}`);
log(`  advertised: ${url}`);
log("");
log("Copy it to the target machine and run it:");
log(`  scp "${tgz}" <user>@${new URL(url).hostname}:~/`);
log(`  ssh <user>@${new URL(url).hostname} 'tar -xzf remote-${args.name}.tgz && cd bundle-${args.name} && ./run.sh'`);
log("");
log("Then on the hub:  node scripts/node/list.mjs");
