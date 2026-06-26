#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const root = new URL("../..", import.meta.url).pathname;
const fail = (msg) => {
  console.error(`[p2p-independence-verify] ${msg}`);
  process.exit(1);
};
const ok = (msg) => process.stdout.write(`[p2p-independence-verify] ${msg}\n`);

function read(path) {
  const full = join(root, path);
  if (!existsSync(full)) fail(`missing expected file ${path}`);
  return readFileSync(full, "utf8");
}

function walkJsonFiles(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    const st = statSync(path);
    if (st.isDirectory()) out.push(...walkJsonFiles(path));
    else if (name.endsWith(".json")) out.push(path);
  }
  return out;
}

// Runtime node records may be gitignored, but a production verification must
// still fail if the local machine is carrying old plaintext node identity files.
for (const file of walkJsonFiles(join(root, ".runtime", "nodes"))) {
  const body = readFileSync(file, "utf8");
  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch {
    fail(`runtime node record is malformed JSON: ${file}`);
  }
  if (Object.prototype.hasOwnProperty.call(parsed, "privateKey")) {
    fail(`runtime node record contains plaintext privateKey: ${file}`);
  }
  if (!parsed.address || !/^0x[0-9a-fA-F]{40}$/.test(parsed.address)) {
    fail(`runtime node record missing valid public address: ${file}`);
  }
}

const joinScript = read("scripts/node/join.mjs");
if (!joinScript.includes("keychainStore(address, \"validatorKey\", privateKey)")) {
  fail("join.mjs does not store generated/imported node keys in the OS secret backend");
}
if (!joinScript.includes("keyBackend: \"keychain\"")) {
  fail("join.mjs does not persist public keyBackend metadata");
}
if (!joinScript.includes("STEP_LOCAL_DEV === \"1\"")) {
  fail("join.mjs can use the public dev admin key without explicit STEP_LOCAL_DEV=1");
}
if (joinScript.includes("JSON.stringify({ name: args.name, address, privateKey")) {
  fail("join.mjs still writes privateKey into runtime node JSON");
}

for (const file of ["scripts/node/bundle.mjs", "scripts/node/bundle-agent.mjs"]) {
  const body = read(file);
  if (!body.includes("STEP_ALLOW_KEYED_BUNDLE")) {
    fail(`${file} does not require explicit opt-in for legacy keyed bundles`);
  }
  if (!body.includes("keyless Trust Center installer/package")) {
    fail(`${file} does not direct operators to the keyless Trust Center installer/package`);
  }
}

const pkgBuilder = read("scripts/release/build-macos-pkg.mjs");
if (!pkgBuilder.includes("step-trustcenter provision")) {
  fail("macOS package builder does not expose step-trustcenter provision");
}
if (!pkgBuilder.includes("SECRET_BACKEND=keychain")) {
  fail("macOS package provisioning is not keychain-backed");
}
if (!pkgBuilder.includes("trust-center.manifest.json") || !pkgBuilder.includes("write_manifest")) {
  fail("macOS package provisioning does not write a Trust Center manifest");
}

const installScript = read("scripts/node/install.sh");
if (!installScript.includes("trust-center.manifest.json")) {
  fail("shell Trust Center installer does not write a Trust Center manifest");
}
if (!installScript.includes('"schema_version": "step.trust-center.manifest.v1"')) {
  fail("shell Trust Center installer manifest is missing schema_version");
}

const handover = read("handover.md");
if (!handover.includes("2/3 + 1 quorum")) {
  fail("handover.md is missing the canonical 2/3 + 1 quorum terminology");
}
if (!handover.includes("Chappie validator identity exists in macOS Keychain")) {
  fail("handover.md does not record the Chappie keychain migration");
}
if (!handover.includes("Trust Center role manifest contract exists")) {
  fail("handover.md does not record the Trust Center manifest contract delivery");
}

read("packages/schemas/step.trust-center.manifest.v1.json");
for (const manifestPath of [
  "config/trust-center.tribecca.example.json",
  "config/trust-center.chappie.example.json"
]) {
  const result = spawnSync(process.execPath, ["scripts/node/validate-manifest.mjs", manifestPath], {
    cwd: root,
    encoding: "utf8"
  });
  if (result.status !== 0) {
    process.stderr.write(result.stderr || result.stdout || "");
    fail(`Trust Center manifest validation failed: ${manifestPath}`);
  }
}

ok("runtime node records contain public metadata only");
ok("join flow stores node identity in the OS secret backend");
ok("legacy keyed bundles are explicit local-dev migration paths only");
ok("keyless macOS Trust Center package path is present");
ok("symmetric Trust Center role manifests validate");
ok("handover records quorum and Chappie identity migration");
