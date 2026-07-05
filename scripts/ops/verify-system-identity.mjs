#!/usr/bin/env node
/**
 * Release proof gate for identical STEP system capability.
 *
 * This is deliberately stricter than a smoke test:
 * - a full Trust Center installer must be fail-closed unless it carries a
 *   verified fullstack runtime payload;
 * - full Trust Center manifests must expose the same baseline task profile;
 * - live fleet endpoints, when present, must prove quorum-capable independent
 *   nodes with no alerts;
 * - the iOS app is proven as a mobile peer/client, not falsely treated as an
 *   always-on full Trust Center.
 */
import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const root = new URL("../..", import.meta.url).pathname;
const requiredFullRoles = ["agent", "validator", "gossip", "chain", "gateway", "fleet", "account", "indexer", "nft"];
const requiredFullServices = ["agent", "validator", "gossip", "chain_rpc", "gateway", "fleet", "account", "indexer", "nft"];
const expectedQuorum = BigInt(process.env.STEP_EXPECTED_QUORUM ?? "101");
const fleetUrls = (process.env.STEP_PROOF_FLEET_URLS ?? "http://127.0.0.1:8099/v1/fleet,http://chappie.local:8099/v1/fleet")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const fail = (msg) => {
  console.error(`[system-identity-proof] ${msg}`);
  process.exit(1);
};
const ok = (msg) => process.stdout.write(`[system-identity-proof] ${msg}\n`);
const read = (path) => {
  const full = join(root, path);
  if (!existsSync(full)) fail(`missing expected file ${path}`);
  return readFileSync(full, "utf8");
};
const json = (path) => JSON.parse(read(path));

function requireText(file, tokens) {
  const body = read(file);
  for (const token of tokens) {
    if (!body.includes(token)) fail(`${file} missing required token: ${token}`);
  }
}

function validateManifest(path) {
  const result = spawnSync(process.execPath, ["scripts/node/validate-manifest.mjs", path], {
    cwd: root,
    encoding: "utf8"
  });
  if (result.status !== 0) fail(`manifest validation failed for ${path}: ${(result.stderr || result.stdout).trim()}`);
  const manifest = json(path);
  if (manifest.recovery?.disaster_survival?.tier !== "full") fail(`${path} must be full disaster-survival tier`);
  for (const role of requiredFullRoles) {
    if (!manifest.roles.includes(role)) fail(`${path} missing full Trust Center role ${role}`);
  }
  for (const service of requiredFullServices) {
    if (manifest.services?.[service]?.enabled !== true) fail(`${path} missing enabled service ${service}`);
  }
  return manifest;
}

function verifyInstallerContracts() {
  requireText("scripts/release/build-macos-pkg.mjs", [
    "--fullstack-dir",
    "survivalTier === \"full\"",
    "fullstack payload missing",
    "gateway-api.mjs",
    "fleet-api.mjs",
    "chain-rpc.mjs",
    "account-api.mjs",
    "indexer.mjs",
    "nft-indexer.mjs",
    "validator-node",
    "gossip-node",
    "install_full_services",
    "app.step.chain",
    "app.step.gateway",
    "app.step.fleet",
    "app.step.gossip",
    "app.step.validator",
    "app.step.account-api",
    "app.step.indexer",
    "app.step.nft-indexer",
    "\"roles\": $roles",
    "\"chain_rpc\"",
    "\"gateway\"",
    "\"fleet\"",
    "\"account\"",
    "\"indexer\"",
    "\"nft\""
  ]);
  requireText("scripts/node/install.sh", [
    "--fullstack-artifact",
    "--fullstack-sha256",
    "install_fullstack_payload",
    "fullstack payload missing",
    "app.step.chain",
    "app.step.gateway",
    "app.step.fleet",
    "app.step.gossip",
    "app.step.validator",
    "app.step.account-api",
    "app.step.indexer",
    "app.step.nft-indexer",
    "\"chain_rpc\"",
    "\"gateway\"",
    "\"fleet\"",
    "\"account\"",
    "\"indexer\"",
    "\"nft\""
  ]);
  ok("installer contracts are fail-closed for full Trust Center payloads");
}

function verifyIosContract() {
  requireText("apps/ios/StepCore/Sources/StepCore/Wallet.swift", [
    "secp256k1",
    "sign(claim",
    "KeyStore"
  ]);
  requireText("apps/ios/StepCore/Sources/StepCore/KeyBackup.swift", [
    "export",
    "uploaded backup file",
    "unlock"
  ]);
  requireText("apps/ios/StepCore/Sources/StepCore/ClaimBuilder.swift", [
    "LocationSample",
    "makeAttestedClaim",
    "anchorProofs",
    "wallet.sign"
  ]);
  requireText("apps/ios/StepCore/Sources/StepCore/GatewayClient.swift", [
    "requestNonce",
    "submit(claim",
    "resolveTriangle"
  ]);
  requireText("apps/ios/StepCore/Sources/StepCore/TrustCenterPairing.swift", [
    "step.trustcenter.pair",
    "signature",
    "v1/trust-centers/pair"
  ]);
  requireText("apps/ios/StepCore/Sources/StepCore/Attestation.swift", [
    "AppAttestAttester",
    "DCAppAttestService",
    "UnattestedAttester"
  ]);
  requireText("apps/ios/StepCore/Sources/StepAppUI/AppModel.swift", [
    "LauncherMode",
    "mobileTrustCenter",
    "startMobileTrustCenter",
    "MineableResolver",
    "makeAttestedClaim",
    "trustThisDevice",
    "exportableBackup"
  ]);
  requireText("apps/ios/StepCore/Sources/StepAppUI/Views.swift", [
    "LauncherView",
    "MobileTrustCenterView",
    "Mobile Trust Center",
    "Future vote signing",
    "Reward model",
    "without requiring the owner to visit new triangles"
  ]);
  requireText("apps/ios/App/Info.plist", [
    "NSLocationWhenInUseUsageDescription",
    "NSBluetoothAlwaysUsageDescription",
    "NFCReaderUsageDescription",
    "NSCameraUsageDescription"
  ]);
  // Version fields must be pinned in project.yml, but the numbers themselves
  // move with every TestFlight build — do not pin exact values here.
  requireText("apps/ios/App/project.yml", [
    "MARKETING_VERSION:",
    "CURRENT_PROJECT_VERSION:",
    "STEP_GATEWAY_URL",
    "STEP_MESH_URL"
  ]);
  const readme = read("apps/ios/README.md");
  if (!readme.includes("Mobile Trust Center") || !readme.includes("choosable launcher")) {
    fail("apps/ios/README.md must explicitly define Mobile Trust Center as a choosable launcher role");
  }
  ok("iOS app contract proves wallet, proof, attestation, pairing, and choosable Mobile Trust Center role");
}

async function verifyLiveFleet() {
  const seen = [];
  for (const url of fleetUrls) {
    let body;
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      body = await response.json();
    } catch (error) {
      fail(`fleet proof endpoint unreachable ${url}: ${error.message}`);
    }
    if (body.quorumReachable !== true) fail(`${url} quorumReachable is not true`);
    if (BigInt(body.totalActiveWeight ?? 0) < expectedQuorum) fail(`${url} active weight ${body.totalActiveWeight} below ${expectedQuorum}`);
    if (Array.isArray(body.alerts) && body.alerts.length > 0) fail(`${url} has fleet alerts: ${JSON.stringify(body.alerts)}`);
    const nodes = Array.isArray(body.nodes) ? body.nodes : [];
    if (!nodes.some((node) => node.reachable === true && node.inQuorum === true)) fail(`${url} has no reachable in-quorum node`);
    seen.push({ url, active: body.totalActiveWeight, threshold: body.quorumThreshold, nodes: nodes.length });
  }
  for (const item of seen) ok(`fleet proof ${item.url}: active=${item.active} threshold=${item.threshold} nodes=${item.nodes}`);
}

verifyInstallerContracts();
const tribecca = validateManifest("config/trust-center.tribecca.example.json");
const chappie = validateManifest("config/trust-center.chappie.example.json");
for (const role of requiredFullRoles) {
  if (!tribecca.roles.includes(role) || !chappie.roles.includes(role)) fail(`manifest role mismatch for ${role}`);
}
ok("full Trust Center manifests share the same baseline capability profile");
verifyIosContract();
await verifyLiveFleet();
ok("system identity proof passed");
