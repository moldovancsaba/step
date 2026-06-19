#!/usr/bin/env node
/**
 * `node join` — add a trust-center node to the STEP federation.
 *
 * A STEP node is a trust center: it holds its own key, independently re-checks
 * every mining claim against the deterministic rules, and signs a weighted vote.
 * Joining the federation is three acts (see
 * docs/architecture/STEP_local_node_and_trust_federation.md):
 *
 *   1. identity  — a keypair (generated here unless you pass one)
 *   2. trust     — registered on-chain in ValidatorRegistry with a weight (the
 *                  "blockchain trust service"); this is the explicit grant
 *   3. operation — the validator binary runs, re-checking claims and voting
 *
 * The node is then appended to the federation directory (.runtime/nodes.json),
 * which the gateway reads live — so the new node joins quorum with no restart.
 *
 * Usage:
 *   node scripts/node/join.mjs --name vienna --port 9104 --weight 50 \
 *        --type Infrastructure --location "Vienna, AT"
 *
 * Local dev reads .runtime/.env.runtime (written by scripts/dev/up.mjs) for the
 * chain/contracts/secrets. On a REMOTE machine, set STEP_RPC_URL,
 * STEP_DEPLOYMENTS_FILE (or VERIFIER_CONTRACT_ADDRESS + VALIDATOR_REGISTRY),
 * STEP_CHAIN_ID, GATEWAY_NONCE_SECRET, STEP_PROTOCOL_PARAMS and a funded
 * STEP_ADMIN_KEY in the environment, and run the same command.
 */
import { execSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const RUNTIME = join(ROOT, ".runtime");
const LOGS = join(RUNTIME, "logs");
const PID_FILE = join(RUNTIME, "pids.json");
const PATH_EXT = `${process.env.HOME}/.cargo/bin:${process.env.HOME}/.foundry/bin:${process.env.PATH}`;

// ValidatorRegistry.ValidatorType (contracts/src/ValidatorRegistry.sol).
const VALIDATOR_TYPES = {
  MobilePeer: 0,
  ApprovedPoint: 1,
  Merchant: 2,
  Venue: 3,
  Infrastructure: 4,
  Protocol: 5,
};
// Anvil deterministic admin (acct 0) — the local dev StepManaged admin. On a
// real chain the foundation admin key is supplied via STEP_ADMIN_KEY.
const DEV_ADMIN_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

function die(msg) {
  console.error(`[join] ${msg}`);
  process.exit(1);
}
function log(msg) {
  process.stdout.write(`[join] ${msg}\n`);
}
function sh(cmd, env = {}) {
  return execSync(cmd, { stdio: "pipe", env: { ...process.env, PATH: PATH_EXT, ...env } })
    .toString()
    .trim();
}

function parseArgs(argv) {
  const a = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) {
      const key = argv[i].slice(2);
      const val = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[(i += 1)] : "true";
      a[key] = val;
    }
  }
  return a;
}

/** Load .runtime/.env.runtime (if present) without polluting real env. */
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
if (!args.name) die("--name is required (e.g. --name vienna)");
if (!args.port) die("--port is required (e.g. --port 9104)");

const rt = loadRuntimeEnv();
const pick = (k, fallback) => process.env[k] ?? rt[k] ?? fallback;

const rpcUrl = pick("STEP_RPC_URL");
const chainId = pick("STEP_CHAIN_ID");
const nonceSecret = pick("GATEWAY_NONCE_SECRET");
const paramsFile = pick("STEP_PROTOCOL_PARAMS");
const deploymentsFile = pick("STEP_DEPLOYMENTS_FILE");
const adminKey = pick("STEP_ADMIN_KEY", DEV_ADMIN_KEY);
const corsOrigins = pick("STEP_CORS_ORIGINS", "");
if (!rpcUrl || !chainId || !nonceSecret || !paramsFile) {
  die("missing chain config — start the stack (scripts/dev/up.mjs) or set STEP_RPC_URL/STEP_CHAIN_ID/GATEWAY_NONCE_SECRET/STEP_PROTOCOL_PARAMS");
}

// Resolve the contract addresses (explicit env wins; else the deployments file).
let verifier = process.env.VERIFIER_CONTRACT_ADDRESS;
let registry = process.env.VALIDATOR_REGISTRY;
if ((!verifier || !registry) && deploymentsFile && existsSync(deploymentsFile)) {
  const d = JSON.parse(readFileSync(deploymentsFile, "utf8"));
  verifier ??= d.MiningClaimVerifier;
  registry ??= d.ValidatorRegistry;
}
if (!verifier || !registry) die("could not resolve MiningClaimVerifier/ValidatorRegistry addresses");

const weight = Number(args.weight ?? 50);
if (!Number.isInteger(weight) || weight <= 0) die("--weight must be a positive integer");
const typeName = args.type ?? "Infrastructure";
const typeNum = VALIDATOR_TYPES[typeName];
if (typeNum === undefined) die(`--type must be one of ${Object.keys(VALIDATOR_TYPES).join(", ")}`);
const location = args.location ?? "remote";
const port = Number(args.port);

// 1. Identity — use the supplied key or mint a fresh one.
const privateKey =
  args.key ?? `0x${randomBytes(32).toString("hex")}`;
const address = sh(`cast wallet address ${privateKey}`).toLowerCase();
log(`node "${args.name}" identity ${address}`);

// 2. Trust — register the node on-chain (explicit grant; weighted).
log(`registering on-chain (type ${typeName}=${typeNum}, weight ${weight})…`);
sh(
  `cast send ${registry} "registerValidator(address,uint8,uint32)" ${address} ${typeNum} ${weight} ` +
    `--rpc-url ${rpcUrl} --private-key ${adminKey}`,
);
const activeWeight = sh(
  `cast call ${registry} "activeWeight(address)(uint256)" ${address} --rpc-url ${rpcUrl}`,
);
log(`on-chain active weight: ${activeWeight}`);

// 3. Operation — run the validator binary (release). Build if missing.
const validatorBin = join(ROOT, "target/release/step-validator-node");
if (!existsSync(validatorBin)) {
  log("building validator-node (release)…");
  execSync("cargo build -p step-validator-node --release", {
    cwd: ROOT,
    stdio: "inherit",
    env: { ...process.env, PATH: PATH_EXT },
  });
}
mkdirSync(LOGS, { recursive: true });
const out = openSync(join(LOGS, `node-${args.name}.log`), "a");
const child = spawn(validatorBin, [], {
  cwd: ROOT,
  env: {
    ...process.env,
    PATH: PATH_EXT,
    VALIDATOR_PORT: String(port),
    STEP_CHAIN_ID: chainId,
    VERIFIER_CONTRACT_ADDRESS: verifier,
    VALIDATOR_PRIVATE_KEY: privateKey,
    GATEWAY_NONCE_SECRET: nonceSecret,
    STEP_PROTOCOL_PARAMS: paramsFile,
    STEP_CORS_ORIGINS: corsOrigins,
    VALIDATOR_ALLOW_DEV_CLAIMS: process.env.VALIDATOR_ALLOW_DEV_CLAIMS ?? "true",
    NODE_NAME: args.name,
    NODE_TYPE: typeName,
    NODE_LOCATION: location,
  },
  stdio: ["ignore", out, out],
  detached: true,
});
child.unref();
log(`validator running (pid ${child.pid}) → .runtime/logs/node-${args.name}.log`);

// Track the pid so `scripts/dev/down.mjs` stops this node too.
if (existsSync(PID_FILE)) {
  const procs = JSON.parse(readFileSync(PID_FILE, "utf8"));
  procs.push({ name: `node-${args.name}`, pid: child.pid });
  writeFileSync(PID_FILE, JSON.stringify(procs, null, 2));
}

// Wait for health, then add to the federation directory so the gateway fans out.
const url = `http://127.0.0.1:${port}`;
await waitHealthy(url);
addToDirectory({
  name: args.name,
  address,
  url,
  weight,
  type: typeName,
  location,
  status: "active",
});

log("");
log(`✓ node "${args.name}" joined the federation`);
log(`  address  ${address}`);
log(`  url      ${url}`);
log(`  weight   ${weight} (${typeName})`);
log(`  location ${location}`);
log("");
log("verify:  node scripts/node/list.mjs");
log(`stop:    node scripts/dev/down.mjs   (stops the whole stack incl. this node)`);

async function waitHealthy(base, timeoutMs = 30_000) {
  const start = Date.now();
  for (;;) {
    try {
      const r = await fetch(`${base}/healthz`);
      if (r.ok) return;
    } catch {
      /* not up yet */
    }
    if (Date.now() - start > timeoutMs) die(`node did not become healthy at ${base}`);
    await new Promise((r) => setTimeout(r, 300));
  }
}

function addToDirectory(node) {
  const file = rt.NODE_DIRECTORY_FILE ?? join(RUNTIME, "nodes.json");
  const dir = existsSync(file)
    ? JSON.parse(readFileSync(file, "utf8"))
    : { nodes: [] };
  dir.nodes = (dir.nodes ?? []).filter((n) => n.address !== node.address);
  dir.nodes.push(node);
  writeFileSync(file, JSON.stringify(dir, null, 2) + "\n");
  log(`directory updated → ${file}`);
}
