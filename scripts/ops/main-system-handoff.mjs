#!/usr/bin/env node
/**
 * Main-system handoff / canary-to-primary transfer.
 *
 * This operator flow proves intentional ownership transfer at the on-chain release
 * layer while keeping runtime autonomy:
 *   1) resolve source/target node identities (name/address)
 *   2) compute the exact handoff release version
 *   3) setNodeTarget(target, version)
 *   4) clear source pin (or keep if requested)
 *   5) optional promote(version) if requested
 *   6) write an evidence artifact that can be audited and replayed.
 *
 * Usage:
 *   node scripts/ops/main-system-handoff.mjs \
 *     --source-name tribecca --target-name chappie --platform darwin-arm64 --version 1.0.15
 *
 * Optional flags:
 *   --dry-run            print actions without sending any transaction
 *   --promote            promote the handed version to platform default
 *   --keep-source-pin    keep source pin when transferring ownership
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { packSemver, formatSemver } from "../release/lib.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const RUNTIME = join(ROOT, ".runtime");
const PATH_EXT = `${process.env.HOME}/.cargo/bin:${process.env.HOME}/.foundry/bin:${process.env.PATH}`;

const fail = (message) => {
  console.error(`[main-system-handoff] ${message}`);
  process.exit(1);
};
const ok = (message) => process.stdout.write(`[main-system-handoff] ${message}\n`);

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith("--")) continue;
    const key = argv[i].slice(2);
    const rawValue = argv[i + 1];
    const nextIsValue = rawValue && !rawValue.startsWith("--");
    args[key] = nextIsValue ? argv[(i += 1)] : "true";
  }
  return args;
}

function parseBoolean(raw, fallback = false) {
  if (raw === undefined) return fallback;
  if (raw === true || raw === false) return raw;
  const normalized = String(raw).toLowerCase();
  if (["1", "true", "yes", "on", "y"].includes(normalized)) return true;
  if (["0", "false", "no", "off", "n"].includes(normalized)) return false;
  return fallback;
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

function castOut(args, debugCommand) {
  const response = spawnSync("cast", args, {
    cwd: ROOT,
    env: { ...process.env, PATH: PATH_EXT },
    encoding: "utf8",
  });
  if (response.status !== 0) {
    const reason = (response.stderr || response.stdout || "unknown").toString().trim();
    fail(`cast command failed: cast ${debugCommand} - ${reason}`);
  }
  return (response.stdout || "").toString().trim();
}

function isAddress(value) {
  return /^0x[0-9a-fA-F]{40}$/.test(value);
}

function isUint64(value) {
  return /^\d+$/.test(value) && BigInt(value) >= 0n && BigInt(value) <= 18446744073709551615n;
}

function parseVersion(raw) {
  if (!raw) return null;
  if (/^\d+$/.test(raw)) return String(BigInt(raw));
  try {
    return String(packSemver(raw));
  } catch {
    return fail(`--version must be uint64 or semver x.y.z, got ${raw}`);
  }
}

function readNodeDirectory(file) {
  if (!existsSync(file)) return [];
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    return Array.isArray(parsed.nodes) ? parsed.nodes : [];
  } catch (error) {
    fail(`unable to read federation directory ${file}: ${error.message}`);
  }
}

function resolveNodeIdentity(args, rt, direction) {
  const nameKey = `${direction}-name`;
  const addrKey = `${direction}-address`;
  const dir = readNodeDirectory(rt.NODE_DIRECTORY_FILE ?? join(RUNTIME, "nodes.json"));
  const directAddress = args[addrKey];
  if (directAddress) {
    if (!isAddress(directAddress)) fail(`--${addrKey} must be hex address`);
    return { address: directAddress.toLowerCase(), name: null };
  }

  const name = args[nameKey];
  if (!name) fail(`one of --${nameKey} or --${addrKey} is required`);
  const match = dir.find((node) => (node.name ?? "").toLowerCase() === name.toLowerCase());
  if (!match || !match.address) fail(`node not found in directory by name: ${name}`);
  if (!isAddress(match.address)) fail(`directory entry for ${name} has invalid address ${match.address}`);
  return { address: match.address.toLowerCase(), name: match.name ?? name };
}

function loadRuntimeContractAddress(rt) {
  const deploymentsFile = process.env.STEP_DEPLOYMENTS_FILE ?? rt.STEP_DEPLOYMENTS_FILE;
  if (!deploymentsFile || !existsSync(deploymentsFile)) {
    return {};
  }

  const payload = JSON.parse(readFileSync(deploymentsFile, "utf8"));
  if (typeof payload !== "object") return {};

  const candidates = [
    payload.ReleaseRegistry,
    payload.releaseRegistry,
    payload.contracts?.ReleaseRegistry,
    payload.contracts?.releaseRegistry,
    payload.networks?.default?.ReleaseRegistry,
    payload.deployments?.ReleaseRegistry,
  ];

  return {
    ReleaseRegistry: candidates.find((value) => typeof value === "string" && isAddress(value)),
  };
}

function runSetNodeTarget(registry, rpcUrl, privateKey, nodeAddress, version) {
  castOut(
    [
      "send",
      registry,
      "setNodeTarget(address,uint64)",
      nodeAddress,
      String(version),
      "--rpc-url",
      rpcUrl,
      "--private-key",
      privateKey,
    ],
    `send ${registry} "setNodeTarget(address,uint64)" ${nodeAddress} ${version} --rpc-url ${rpcUrl} --private-key ${privateKey}`,
  );
}

function runPromote(registry, rpcUrl, privateKey, platformId, version) {
  castOut(
    [
      "send",
      registry,
      "promote(bytes32,uint64)",
      platformId,
      String(version),
      "--rpc-url",
      rpcUrl,
      "--private-key",
      privateKey,
    ],
    `send ${registry} "promote(bytes32,uint64)" ${platformId} ${version} --rpc-url ${rpcUrl} --private-key ${privateKey}`,
  );
}

const args = parseArgs(process.argv.slice(2));
const rt = loadRuntimeEnv();
const deployments = loadRuntimeContractAddress(rt);

const runtimeNodeUrl = process.env.STEP_RPC_URL ?? rt.STEP_RPC_URL;
if (!runtimeNodeUrl) fail("STEP_RPC_URL is required in env or .runtime/.env.runtime");

const registry =
  args.registry ||
  process.env.RELEASE_REGISTRY ||
  rt.RELEASE_REGISTRY ||
  rt.STEP_RELEASE_REGISTRY ||
  deployments.ReleaseRegistry;
if (!registry) {
  fail("release registry is required (RELEASE_REGISTRY / --registry / .runtime/.env.runtime / STEP_DEPLOYMENTS_FILE)");
}

const releaseSigner = process.env.RELEASE_SIGNER_KEY || rt.RELEASE_SIGNER_KEY || rt.STEP_ADMIN_KEY;
if (!releaseSigner) fail("RELEASE_SIGNER_KEY is required to execute on-chain pinning");

const source = resolveNodeIdentity(args, rt, "source");
const target = resolveNodeIdentity(args, rt, "target");
if (source.address === target.address) fail("source and target must be different addresses");

const platform = args.platform || rt.STEP_PLATFORM || "darwin-arm64";
const platformId = castOut(["keccak", platform], `keccak "${platform}"`);
const doPromote = parseBoolean(args.promote, false);
const clearSource = !parseBoolean(args["keep-source-pin"], false);

const requestedVersion = parseVersion(args.version);
const platformDefaultVersion = castOut(
  [
    "call",
    registry,
    "platformTargetVersion(bytes32)(uint64)",
    platformId,
    "--rpc-url",
    runtimeNodeUrl,
  ],
  `call ${registry} "platformTargetVersion(bytes32)(uint64)" ${platformId} --rpc-url ${runtimeNodeUrl}`,
).split(" ")[0];

if (!platformDefaultVersion || platformDefaultVersion === "0") {
  fail(`platform target is unset for ${platform}; publish a release first`);
}

const version = requestedVersion ?? platformDefaultVersion;
if (!isUint64(version)) fail(`invalid target version ${version}`);

if (requestedVersion) {
  ok(`using explicit version ${formatSemver(version)} (${version})`);
} else {
  ok(`defaulting to current platform target ${formatSemver(platformDefaultVersion)} (${platformDefaultVersion})`);
}

const sourceOriginalPin = castOut(
  [
    "call",
    registry,
    "nodeTargetVersion(address)(uint64)",
    source.address,
    "--rpc-url",
    runtimeNodeUrl,
  ],
  `call ${registry} "nodeTargetVersion(address)(uint64)" ${source.address} --rpc-url ${runtimeNodeUrl}`,
).split(" ")[0];
const targetOriginalPin = castOut(
  [
    "call",
    registry,
    "nodeTargetVersion(address)(uint64)",
    target.address,
    "--rpc-url",
    runtimeNodeUrl,
  ],
  `call ${registry} "nodeTargetVersion(address)(uint64)" ${target.address} --rpc-url ${runtimeNodeUrl}`,
).split(" ")[0];
const beforeDefault = castOut(
  [
    "call",
    registry,
    "platformTargetVersion(bytes32)(uint64)",
    platformId,
    "--rpc-url",
    runtimeNodeUrl,
  ],
  `call ${registry} "platformTargetVersion(bytes32)(uint64)" ${platformId} --rpc-url ${runtimeNodeUrl}`,
).split(" ")[0];

ok(
  `preflight ok\n` +
    `  source: ${source.name || "(direct)"} ${source.address}\n` +
    `  target: ${target.name || "(direct)"} ${target.address}\n` +
    `  sourcePin: ${sourceOriginalPin}\n` +
    `  targetPin: ${targetOriginalPin}\n` +
    `  platform default before: ${beforeDefault}`,
);

const dryRun = parseBoolean(args["dry-run"], false);
if (dryRun) {
  ok("dry run mode: no on-chain actions were sent");
  ok(
    `planned actions: setNodeTarget(${target.address}, ${version}), ` +
      `${clearSource ? `setNodeTarget(${source.address}, 0)` : "keep source pin"}` +
      `${doPromote ? `, promote(${platformId}, ${version})` : ""}`,
  );
  process.exit(0);
}

runSetNodeTarget(registry, runtimeNodeUrl, releaseSigner, target.address, version);
ok(`pinned target ${target.address} to ${version}`);

if (clearSource) {
  runSetNodeTarget(registry, runtimeNodeUrl, releaseSigner, source.address, 0);
  ok(`cleared source ${source.address} pin to 0 (follows platform default)`);
}

if (doPromote) {
  runPromote(registry, runtimeNodeUrl, releaseSigner, platformId, version);
  ok(`promoted platform ${platform} default to ${version}`);
}

const sourceFinalPin = castOut(
  [
    "call",
    registry,
    "nodeTargetVersion(address)(uint64)",
    source.address,
    "--rpc-url",
    runtimeNodeUrl,
  ],
  `call ${registry} "nodeTargetVersion(address)(uint64)" ${source.address} --rpc-url ${runtimeNodeUrl}`,
).split(" ")[0];
const targetFinalPin = castOut(
  [
    "call",
    registry,
    "nodeTargetVersion(address)(uint64)",
    target.address,
    "--rpc-url",
    runtimeNodeUrl,
  ],
  `call ${registry} "nodeTargetVersion(address)(uint64)" ${target.address} --rpc-url ${runtimeNodeUrl}`,
).split(" ")[0];
const defaultFinal = castOut(
  [
    "call",
    registry,
    "platformTargetVersion(bytes32)(uint64)",
    platformId,
    "--rpc-url",
    runtimeNodeUrl,
  ],
  `call ${registry} "platformTargetVersion(bytes32)(uint64)" ${platformId} --rpc-url ${runtimeNodeUrl}`,
).split(" ")[0];

if (targetFinalPin !== version) {
  fail(`postcheck failed: target pin is ${targetFinalPin}, expected ${version}`);
}
if (clearSource && sourceFinalPin !== "0") {
  fail(`postcheck failed: source pin is ${sourceFinalPin}, expected 0`);
}
if (doPromote && defaultFinal !== version) {
  fail(`postcheck failed: platform default is ${defaultFinal}, expected ${version}`);
}

const evidence = {
  createdAt: new Date().toISOString(),
  platform,
  platformId,
  releaseRegistry: registry,
  rpcUrl: runtimeNodeUrl,
  handoff: {
    source: { address: source.address, beforePin: sourceOriginalPin, afterPin: sourceFinalPin },
    target: { address: target.address, beforePin: targetOriginalPin, afterPin: targetFinalPin },
    version,
    versionSemver: formatSemver(version),
    defaultBefore: beforeDefault,
    defaultAfter: defaultFinal,
    promoted: doPromote,
    keptSourcePin: !clearSource,
  },
};

const outDir = join(RUNTIME, "handoff");
mkdirSync(outDir, { recursive: true });
const slug = new Date().toISOString().replace(/[T:\-:.]/g, "-").replace("Z", "");
const outPath = join(outDir, `${slug}-${source.address.slice(2, 10)}-to-${target.address.slice(2, 10)}.json`);
writeFileSync(outPath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");

ok(`handoff complete — evidence saved to ${outPath}`);
ok(
  `rollback: setNodeTarget(${target.address}, ${targetOriginalPin === "0" ? "0" : targetOriginalPin}), ` +
    `setNodeTarget(${source.address}, ${sourceOriginalPin}), ` +
    `${doPromote ? `promote(${platformId}, ${beforeDefault})` : "(no promotion rollback requested)"}`,
);
