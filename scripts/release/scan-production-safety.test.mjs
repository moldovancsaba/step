import { test } from "node:test";
import assert from "node:assert/strict";
import {
  forbiddenUrlIn,
  committedSecretIn,
  isExcludedPath,
  isProductionConfig,
  scanFiles,
} from "./scan-production-safety.mjs";

test("forbidden URLs: localhost, private, and plaintext http are caught", () => {
  assert.equal(forbiddenUrlIn('URL = "http://127.0.0.1:8080"'), "http://127.0.0.1:8080");
  assert.equal(forbiddenUrlIn("URL = https://localhost:9101"), "https://localhost:9101");
  assert.equal(forbiddenUrlIn("URL = https://192.168.1.10/api"), "https://192.168.1.10/api");
  assert.equal(forbiddenUrlIn("URL = https://10.0.0.5"), "https://10.0.0.5");
  assert.equal(forbiddenUrlIn("URL = http://gw.step.regiominer.com"), "http://gw.step.regiominer.com"); // plaintext http
});

test("forbidden URLs: HTTPS public host, comments, and allow-marker pass", () => {
  assert.equal(forbiddenUrlIn('STEP_BACKEND_GATEWAY_URL = "https://gw.step.regiominer.com"'), null);
  assert.equal(forbiddenUrlIn("# dev fallback http://localhost:8080"), null);
  assert.equal(forbiddenUrlIn("URL = http://localhost:8080 # safety:allow-local"), null);
  assert.equal(forbiddenUrlIn("compatibility_date = 2026-06-15"), null);
});

test("committed secrets: real key on a secret field is caught", () => {
  const key = "0x" + "a1".repeat(32); // 64 hex
  assert.equal(committedSecretIn(`PRIVATE_KEY=${key}`), key);
  assert.equal(committedSecretIn(`relayerKey: "${key}"`), key);
  assert.equal(committedSecretIn(`SESSION_SIGNING_KEY = ${key}`), key);
});

test("committed secrets: placeholders, non-secret hashes, and public hosts pass", () => {
  assert.equal(committedSecretIn("PRIVATE_KEY=0x" + "0".repeat(64)), null); // all-zero placeholder
  assert.equal(committedSecretIn("PRIVATE_KEY=<CHANGEME>"), null);
  assert.equal(committedSecretIn("claim_hash = 0x" + "b".repeat(64)), null); // not a secret field
  assert.equal(committedSecretIn("wallet = 0x" + "c".repeat(40)), null); // 40-hex address, not a key
});

test("exclusions: samples, examples, tests, and lockfiles are skipped", () => {
  assert.equal(isExcludedPath("chain/genesis.devnet.sample.json"), true);
  assert.equal(isExcludedPath("config/trust-center.chappie.example.json"), true);
  assert.equal(isExcludedPath("services/gateway-api/test/gateway.test.ts"), true);
  assert.equal(isExcludedPath("scripts/release/scan-production-safety.test.mjs"), true);
  assert.equal(isExcludedPath("pnpm-lock.yaml"), true);
  assert.equal(isExcludedPath("wrangler.toml"), false);
});

test("production config surface is recognised", () => {
  assert.equal(isProductionConfig("wrangler.toml"), true);
  assert.equal(isProductionConfig("services/account-api/wrangler.toml"), true);
  assert.equal(isProductionConfig("apps/web-app/.env.production"), true);
  assert.equal(isProductionConfig("worker.js"), true);
  assert.equal(isProductionConfig("apps/web-app/src/api.ts"), false);
});

test("scanFiles integrates predicates over an in-memory tree", () => {
  const files = {
    "wrangler.toml": 'STEP_BACKEND_GATEWAY_URL = "https://gw.step.regiominer.com"\n', // clean
    "services/dev/wrangler.toml": 'URL = "http://127.0.0.1:8080"\n', // localhost in prod config → flag
    ".env.production": "API=http://localhost:9101\n", // flag
    "chain/genesis.devnet.sample.json": '{"key":"0x' + "a1".repeat(32) + '"}\n', // sample → skipped
    "deploy/prod.env": "DEPLOYER_KEY=0x" + "a1".repeat(32) + "\n", // secret anywhere → flag
    "docs/readme.md": "PRIVATE_KEY=0x" + "a1".repeat(32) + "\n", // md doc example key → still a secret field, flagged
  };
  const findings = scanFiles("/root", Object.keys(files), (p) => files[p]);
  const byFile = (f) => findings.filter((x) => x.file === f).map((x) => x.kind);
  assert.deepEqual(byFile("wrangler.toml"), []);
  assert.deepEqual(byFile("services/dev/wrangler.toml"), ["local-url"]);
  assert.deepEqual(byFile(".env.production"), ["local-url"]);
  assert.deepEqual(byFile("chain/genesis.devnet.sample.json"), []);
  assert.deepEqual(byFile("deploy/prod.env"), ["committed-secret"]);
  assert.deepEqual(byFile("docs/readme.md"), ["committed-secret"]);
});
