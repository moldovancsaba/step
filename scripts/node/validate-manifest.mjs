#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = new URL("../..", import.meta.url).pathname;
const file = process.argv[2];
const fail = (msg) => {
  console.error(`[trust-center-manifest] ${msg}`);
  process.exit(1);
};

if (!file) fail("usage: node scripts/node/validate-manifest.mjs <manifest.json>");
if (!existsSync(file)) fail(`manifest not found: ${file}`);

const schema = JSON.parse(readFileSync(join(root, "packages/schemas/step.trust-center.manifest.v1.json"), "utf8"));
const manifest = JSON.parse(readFileSync(file, "utf8"));

const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const expectObject = (value, path) => {
  if (!isObject(value)) fail(`${path} must be an object`);
};
const expectString = (value, path, pattern) => {
  if (typeof value !== "string" || value.length === 0) fail(`${path} must be a non-empty string`);
  if (pattern && !pattern.test(value)) fail(`${path} has invalid format`);
};
const expectNumber = (value, path, min = 0) => {
  if (!Number.isFinite(value) || value < min) fail(`${path} must be a number >= ${min}`);
};
const expectBoolean = (value, path) => {
  if (typeof value !== "boolean") fail(`${path} must be boolean`);
};
const expectStringArray = (value, path, allowEmpty = false) => {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0)) fail(`${path} must be a non-empty string array`);
  for (const [index, item] of value.entries()) expectString(item, `${path}[${index}]`);
};

if (schema.$id !== "https://step.protocol/schemas/step.trust-center.manifest.v1.json") {
  fail("manifest schema id is not the canonical Trust Center schema");
}
if (manifest.schema_version !== "step.trust-center.manifest.v1") {
  fail("schema_version must be step.trust-center.manifest.v1");
}

expectObject(manifest.node, "node");
expectString(manifest.node.name, "node.name", /^[a-z0-9][a-z0-9-]{1,62}$/);
expectString(manifest.node.address, "node.address", /^0x[0-9a-fA-F]{40}$/);
expectString(manifest.node.transport, "node.transport", /^(http|peer)$/);
expectString(manifest.node.platform, "node.platform");
expectString(manifest.node.location, "node.location");
expectString(manifest.node.identity_backend, "node.identity_backend");

expectStringArray(manifest.roles, "roles");
const allowedRoles = new Set([
  "agent",
  "validator",
  "gossip",
  "chain",
  "bootstrap",
  "relay",
  "gateway",
  "indexer",
  "fleet",
  "artifact"
]);
for (const role of manifest.roles) {
  if (!allowedRoles.has(role)) fail(`unknown role ${role}`);
}
if (new Set(manifest.roles).size !== manifest.roles.length) fail("roles must not contain duplicates");

expectObject(manifest.services, "services");
for (const [serviceName, service] of Object.entries(manifest.services)) {
  expectObject(service, `services.${serviceName}`);
  expectBoolean(service.enabled, `services.${serviceName}.enabled`);
  if (service.bind !== undefined) expectString(service.bind, `services.${serviceName}.bind`);
  if (service.public_url !== undefined) expectString(service.public_url, `services.${serviceName}.public_url`, /^https?:\/\//);
  if (service.healthz !== undefined) expectString(service.healthz, `services.${serviceName}.healthz`, /^https?:\/\//);
  if (service.pid_file !== undefined) expectString(service.pid_file, `services.${serviceName}.pid_file`);
}

expectObject(manifest.chain, "chain");
expectString(manifest.chain.chain_id, "chain.chain_id");
expectStringArray(manifest.chain.rpc_urls, "chain.rpc_urls");
for (const [index, url] of manifest.chain.rpc_urls.entries()) expectString(url, `chain.rpc_urls[${index}]`, /^https?:\/\//);
expectString(manifest.chain.release_registry, "chain.release_registry", /^0x[0-9a-fA-F]{40}$/);
expectString(manifest.chain.validator_registry, "chain.validator_registry", /^0x[0-9a-fA-F]{40}$/);
if (manifest.chain.genesis_hash !== undefined) expectString(manifest.chain.genesis_hash, "chain.genesis_hash", /^0x[0-9a-fA-F]{64}$/);

expectObject(manifest.update, "update");
expectString(manifest.update.platform_id, "update.platform_id", /^0x[0-9a-fA-F]{64}$/);
expectStringArray(manifest.update.artifact_base_urls, "update.artifact_base_urls");
for (const [index, url] of manifest.update.artifact_base_urls.entries()) expectString(url, `update.artifact_base_urls[${index}]`, /^https?:\/\//);
expectNumber(manifest.update.poll_interval_s, "update.poll_interval_s", 5);
if (manifest.update.integrity_interval_s !== undefined) expectNumber(manifest.update.integrity_interval_s, "update.integrity_interval_s", 30);

expectObject(manifest.recovery, "recovery");
expectString(manifest.recovery.supervisor, "recovery.supervisor");
expectObject(manifest.recovery.restart, "recovery.restart");
expectBoolean(manifest.recovery.restart.enabled, "recovery.restart.enabled");
expectNumber(manifest.recovery.restart.max_attempts, "recovery.restart.max_attempts", 1);
expectObject(manifest.recovery.rollback, "recovery.rollback");
expectBoolean(manifest.recovery.rollback.enabled, "recovery.rollback.enabled");
expectBoolean(manifest.recovery.rollback.last_good_required, "recovery.rollback.last_good_required");

expectObject(manifest.observability, "observability");
expectString(manifest.observability.healthz, "observability.healthz", /^https?:\/\//);
expectStringArray(manifest.observability.logs, "observability.logs", true);
expectBoolean(manifest.observability.fleet_heartbeat, "observability.fleet_heartbeat");

const roles = new Set(manifest.roles);
const serviceRoleMap = {
  agent: "agent",
  validator: "validator",
  gossip: "gossip",
  chain_rpc: "chain",
  gateway: "gateway",
  indexer: "indexer",
  fleet: "fleet",
  artifact: "artifact"
};

for (const [service, role] of Object.entries(serviceRoleMap)) {
  const enabled = manifest.services?.[service]?.enabled === true;
  if (enabled && !roles.has(role)) {
    fail(`service ${service} is enabled but role ${role} is missing`);
  }
}

for (const role of roles) {
  const requiredService = Object.entries(serviceRoleMap).find(([, r]) => r === role)?.[0];
  if (requiredService && manifest.services?.[requiredService]?.enabled !== true) {
    fail(`role ${role} is declared but service ${requiredService} is not enabled`);
  }
}

if (roles.has("bootstrap") && !roles.has("gossip")) fail("bootstrap role requires gossip role");
if (roles.has("relay") && !roles.has("gossip")) fail("relay role requires gossip role");
if (roles.has("validator") && !roles.has("agent")) fail("validator role requires agent role");

if (manifest.peer !== undefined) {
  expectObject(manifest.peer, "peer");
  if (manifest.peer.bootstrap_peers !== undefined) expectStringArray(manifest.peer.bootstrap_peers, "peer.bootstrap_peers", true);
  if (manifest.peer.relay_peers !== undefined) expectStringArray(manifest.peer.relay_peers, "peer.relay_peers", true);
  if (manifest.peer.advertise !== undefined) expectStringArray(manifest.peer.advertise, "peer.advertise", true);
}

if (manifest.node.transport === "peer") {
  const peer = manifest.peer ?? {};
  const peerAddressCount =
    (peer.bootstrap_peers?.length ?? 0) +
    (peer.relay_peers?.length ?? 0) +
    (peer.advertise?.length ?? 0);
  if (!roles.has("gossip")) fail("peer transport requires gossip role");
  if (peerAddressCount === 0) fail("peer transport requires bootstrap, relay, or advertise multiaddr");
}

if (manifest.node.identity_backend !== "keychain" && process.env.STEP_DEPLOY_ENV === "production") {
  fail("production manifests must use keychain identity_backend on macOS");
}

console.log(`[trust-center-manifest] ok ${manifest.node.name} roles=${manifest.roles.join(",")}`);
