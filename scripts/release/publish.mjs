#!/usr/bin/env node
/**
 * `release publish` (#38) — the ONLY way authorized trust-center code enters the
 * system. Builds the validator artifacts reproducibly, hashes them, and publishes
 * the hashes to the on-chain ReleaseRegistry (through RELEASE_ROLE / the timelock).
 * A node will run a binary only if its sha256 matches what this command published.
 *
 * Usage:
 *   node scripts/release/publish.mjs --version 1.2.0 --platform darwin-arm64 [--dry-run]
 *
 * Reads .runtime/.env.runtime (local hub) for chain config, or env:
 *   STEP_RPC_URL, RELEASE_REGISTRY (or STEP_DEPLOYMENTS_FILE), RELEASE_SIGNER_KEY,
 *   STEP_PROTOCOL_PARAMS.
 *
 * Guards: refuses a dirty git tree and a non-monotonic version (provenance).
 */
import { execSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { sha256File, sha256Bytes, packSemver } from "./lib.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const RUNTIME = join(ROOT, ".runtime");
const PATH_EXT = `${process.env.HOME}/.cargo/bin:${process.env.HOME}/.foundry/bin:${process.env.PATH}`;

const die = (m) => {
  console.error(`[publish] ${m}`);
  process.exit(1);
};
const log = (m) => process.stdout.write(`[publish] ${m}\n`);
const sh = (cmd, env = {}) =>
  execSync(cmd, { cwd: ROOT, stdio: "pipe", env: { ...process.env, PATH: PATH_EXT, ...env } })
    .toString()
    .trim();

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
  const f = join(RUNTIME, ".env.runtime");
  const out = {};
  if (existsSync(f)) {
    for (const line of readFileSync(f, "utf8").split("\n")) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m) out[m[1]] = m[2];
    }
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const dryRun = args["dry-run"] === "true";
if (!args.version) die("--version x.y.z is required");
const platform = args.platform ?? "darwin-arm64";
const version = packSemver(args.version);

const rt = loadRuntimeEnv();
const pick = (k) => process.env[k] ?? rt[k];
const rpcUrl = pick("STEP_RPC_URL");
const signerKey = pick("RELEASE_SIGNER_KEY") ?? pick("STEP_ADMIN_KEY");
const paramsFile = pick("STEP_PROTOCOL_PARAMS") ?? join(ROOT, "config/protocol-params.alpha.json");
let registry = process.env.RELEASE_REGISTRY;
const deploymentsFile = pick("STEP_DEPLOYMENTS_FILE");
if (!registry && deploymentsFile && existsSync(deploymentsFile)) {
  registry = JSON.parse(readFileSync(deploymentsFile, "utf8")).ReleaseRegistry;
}

// Provenance guard: never publish from a dirty tree.
const dirty = sh("git status --porcelain");
if (dirty && !dryRun) die("working tree is dirty — commit or stash before publishing");

// 1. Build the validator binary reproducibly (locked toolchain).
log(`building validator (release, locked) for ${platform}…`);
sh("cargo build -p step-validator-node --release --locked");
const binary = join(ROOT, "target/release/step-validator-node");
if (!existsSync(binary)) die("build produced no binary");

// 2. Canonical runtime config (non-secret) hashed alongside binary + params.
const config = {
  platform,
  schema: "step.node.config.v1",
  mesh_spec_version: "step-mesh-v1",
};
const configStr = JSON.stringify(config, Object.keys(config).sort());

// 3. Hash the three authorized artifacts.
const binaryHash = await sha256File(binary);
const paramsHash = await sha256File(paramsFile);
const configHash = sha256Bytes(configStr);
const platformId = sh(`cast keccak "${platform}"`); // bytes32 platform id

log(`version       ${args.version}  (packed ${version})`);
log(`platform      ${platform}  (${platformId})`);
log(`binary  sha256 ${binaryHash}`);
log(`params  sha256 ${paramsHash}`);
log(`config  sha256 ${configHash}`);

// 4. Write the signed manifest (off-chain record; second integrity factor).
mkdirSync(join(RUNTIME, "releases"), { recursive: true });
const manifest = {
  version: args.version,
  platform,
  platform_id: platformId,
  binary_sha256: binaryHash,
  params_sha256: paramsHash,
  config_sha256: configHash,
  git_commit: sh("git rev-parse HEAD"),
};
const manifestPath = join(RUNTIME, "releases", `release-${args.version}.json`);
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
// Write EXACTLY the hashed bytes (no trailing newline) so sha256(file) == configHash.
writeFileSync(join(RUNTIME, "releases", `config-${args.version}.json`), configStr);
log(`manifest      ${manifestPath}`);

if (dryRun) {
  log("--dry-run: not publishing on-chain.");
  process.exit(0);
}

if (!rpcUrl || !registry || !signerKey) {
  die("missing chain config — set STEP_RPC_URL, RELEASE_REGISTRY (or STEP_DEPLOYMENTS_FILE), RELEASE_SIGNER_KEY");
}

// 5. Publish to ReleaseRegistry (RELEASE_ROLE). On-chain monotonicity is enforced
//    by the contract; surface its revert reason verbatim on failure.
log("publishing to ReleaseRegistry…");
try {
  sh(
    `cast send ${registry} ` +
      `"publishRelease(bytes32,uint64,bytes32,bytes32,bytes32,uint64)" ` +
      `${platformId} ${version} ${binaryHash} ${paramsHash} ${configHash} 0 ` +
      `--rpc-url ${rpcUrl} --private-key ${signerKey}`,
  );
} catch (e) {
  die(`on-chain publish failed: ${String(e.stderr ?? e).split("\n").slice(-3).join(" ")}`);
}
const authorized = sh(
  `cast call ${registry} "isAuthorized(bytes32,bytes32,bytes32,bytes32)(bool)" ` +
    `${platformId} ${binaryHash} ${paramsHash} ${configHash} --rpc-url ${rpcUrl}`,
);
if (authorized !== "true") die("post-publish check failed: registry does not authorize the hashes");

log("");
log(`✓ published ${args.version} for ${platform} — on-chain authorized`);
log(`  agents targeting this platform will fetch + verify + activate it.`);
