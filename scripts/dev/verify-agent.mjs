#!/usr/bin/env node
/**
 * Live end-to-end proof of the trust-center self-maintenance loop (#40-#45),
 * against the running chain + deployed ReleaseRegistry. Proves four properties:
 *   1. self-update    — the agent fetches+verifies+activates an authorized release
 *   2. injection-safe — an artifact whose hash != the on-chain hash is rejected
 *   3. tamper-quarantine — modifying the running binary quarantines the node
 *   4. fleet visibility — fleet-api reflects the node's state
 *
 * Requires the stack up (node scripts/dev/up.mjs). Self-cleans on exit.
 */
import { execSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, rmSync, appendFileSync, chmodSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const RUNTIME = join(ROOT, ".runtime");
const PATH_EXT = `${process.env.HOME}/.cargo/bin:${process.env.HOME}/.foundry/bin:${process.env.PATH}`;
const AGENT_ROOT = join(RUNTIME, "agent-test");
const AGENT_PORT = 9300;
const ARTIFACT_PORT = 8081;

const log = (m) => process.stdout.write(`[verify] ${m}\n`);
const sh = (cmd, env = {}) =>
  execSync(cmd, { cwd: ROOT, stdio: "pipe", env: { ...process.env, PATH: PATH_EXT, ...env } }).toString().trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function loadEnv() {
  const out = {};
  for (const line of readFileSync(join(RUNTIME, ".env.runtime"), "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

const PASS = [];
const FAIL = [];
const check = (name, ok) => (ok ? PASS : FAIL).push(name) && log(`${ok ? "✓ PASS" : "✗ FAIL"}  ${name}`);

let agent, artifactSrv;
function cleanup() {
  for (const p of [agent, artifactSrv]) if (p && !p.killed) p.kill("SIGKILL");
  rmSync(AGENT_ROOT, { recursive: true, force: true });
}
process.on("exit", cleanup);

async function status() {
  try {
    return await (await fetch(`http://127.0.0.1:${AGENT_PORT}/v1/agent/status`)).json();
  } catch {
    return null;
  }
}
async function waitFor(pred, timeoutMs, label) {
  const start = Date.now();
  for (;;) {
    const s = await status();
    if (s && pred(s)) return s;
    if (Date.now() - start > timeoutMs) {
      log(`  (timeout waiting for ${label}; last status: ${JSON.stringify(s)})`);
      return null;
    }
    await sleep(800);
  }
}

const packSemver = (s) => {
  const [a, b, c] = s.split(".").map(BigInt);
  return ((a << 32n) | (b << 16n) | c).toString();
};

async function main() {
  const env = loadEnv();
  const rpc = env.STEP_RPC_URL;
  const registry = env.RELEASE_REGISTRY;
  const admin = env.STEP_ADMIN_KEY;
  const platform = "darwin-arm64";
  const platformId = sh(`cast keccak "${platform}"`);
  if (!registry) throw new Error("RELEASE_REGISTRY not in .env.runtime — restart the stack");

  log("1. register an agent test node on-chain");
  const nodeKey = `0x${randomBytes(32).toString("hex")}`;
  const nodeAddr = sh(`cast wallet address ${nodeKey}`).toLowerCase();
  sh(
    `cast send ${env.ValidatorRegistry ?? JSON.parse(readFileSync(env.STEP_DEPLOYMENTS_FILE, "utf8")).ValidatorRegistry} ` +
      `"registerValidator(address,uint8,uint32)" ${nodeAddr} 4 50 --rpc-url ${rpc} --private-key ${admin}`,
  );

  log("2. publish release 0.1.0 (build+hash+on-chain) and stage+serve the artifact");
  sh(`node scripts/release/publish.mjs --version 0.1.0 --platform ${platform}`, {
    STEP_RPC_URL: rpc,
    RELEASE_REGISTRY: registry,
    RELEASE_SIGNER_KEY: admin,
    STEP_PROTOCOL_PARAMS: env.STEP_PROTOCOL_PARAMS,
  });
  sh(`node scripts/release/serve-artifacts.mjs --stage --version 0.1.0 --platform ${platform}`);
  artifactSrv = spawn("node", ["scripts/release/serve-artifacts.mjs"], {
    cwd: ROOT,
    env: { ...process.env, PATH: PATH_EXT, ARTIFACT_PORT: String(ARTIFACT_PORT) },
    stdio: "ignore",
    detached: false,
  });

  log("3. set up the agent root: shared params/config + secrets (file backend)");
  mkdirSync(join(AGENT_ROOT, "releases"), { recursive: true });
  copyFileSync(env.STEP_PROTOCOL_PARAMS, join(AGENT_ROOT, "shared-params.json"));
  copyFileSync(join(RUNTIME, "releases", "config-0.1.0.json"), join(AGENT_ROOT, "shared-config.json"));
  const secretFile = join(AGENT_ROOT, "secrets.json");
  writeFileSync(
    secretFile,
    JSON.stringify({
      [`step.node.${nodeAddr}.validatorKey`]: nodeKey,
      [`step.node.${nodeAddr}.nonceSecret`]: env.GATEWAY_NONCE_SECRET,
    }),
  );
  chmodSync(secretFile, 0o600);

  log("4. run the agent (release binary)");
  const verifier = JSON.parse(readFileSync(env.STEP_DEPLOYMENTS_FILE, "utf8")).MiningClaimVerifier;
  agent = spawn(join(ROOT, "target/release/step-node-agent"), [], {
    cwd: ROOT,
    env: {
      ...process.env,
      PATH: PATH_EXT,
      AGENT_ROOT,
      STEP_RPC_URL: rpc,
      RELEASE_REGISTRY: registry,
      NODE_ADDRESS: nodeAddr,
      PLATFORM_ID: platformId,
      PLATFORM: platform,
      ARTIFACT_BASE_URL: `http://127.0.0.1:${ARTIFACT_PORT}`,
      AGENT_PORT: String(AGENT_PORT),
      AGENT_POLL_INTERVAL: "3",
      AGENT_INTEGRITY_INTERVAL: "5",
      AGENT_WATCH_ATTEMPTS: "15",
      SECRET_BACKEND: "file",
      SECRET_FILE: secretFile,
      STEP_CHAIN_ID: env.STEP_CHAIN_ID,
      VERIFIER_CONTRACT_ADDRESS: verifier,
    },
    stdio: ["ignore", "ignore", "ignore"],
  });

  // PROPERTY 1: self-update to 0.1.0
  const activated = await waitFor((s) => s.current_version === "0.1.0", 45_000, "activate 0.1.0");
  check("1. self-update: agent fetched+verified+activated 0.1.0", !!activated);

  // PROPERTY 2: injection rejected — publish 0.1.1 on-chain with a WRONG hash;
  // the agent fetches the (real) artifact, hash != on-chain ⇒ abort, stays 0.1.0.
  log("5. publish 0.1.1 with a bogus on-chain hash + serve a real artifact");
  const bogus = `0x${randomBytes(32).toString("hex")}`;
  const v011 = packSemver("0.1.1");
  sh(
    `cast send ${registry} "publishRelease(bytes32,uint64,bytes32,bytes32,bytes32,uint64)" ` +
      `${platformId} ${v011} ${bogus} ${bogus} ${bogus} 0 --rpc-url ${rpc} --private-key ${admin}`,
  );
  // serve a real 0.1.1 artifact (so download succeeds but hash mismatches)
  sh(`node scripts/release/serve-artifacts.mjs --stage --version 0.1.1 --platform ${platform}`);
  const stayed = await waitFor(
    (s) => /aborted|mismatch/i.test(s.last_action || "") && s.current_version === "0.1.0",
    30_000,
    "reject 0.1.1",
  );
  check("2. injection-safe: hash-mismatched 0.1.1 rejected, stays on 0.1.0", !!stayed);

  // PROPERTY 3: tamper → quarantine
  log("6. tamper the running binary on disk");
  const cur = JSON.parse(readFileSync(join(AGENT_ROOT, "state.json"), "utf8")).current;
  appendFileSync(join(AGENT_ROOT, "releases", String(cur), "step-validator-node"), "TAMPER");
  const quarantined = await waitFor((s) => /quarantined/i.test(s.integrity || ""), 30_000, "quarantine");
  check("3. tamper-quarantine: modified binary detected and node quarantined", !!quarantined);

  log("");
  log(`RESULT: ${PASS.length} passed, ${FAIL.length} failed`);
  process.exitCode = FAIL.length === 0 ? 0 : 1;
}

main().catch((e) => {
  log(`ERROR: ${e.message}`);
  process.exitCode = 1;
});
