import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { publicKeyAddressesIn, isProductionSafe } from "./genesis-check.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");

test("the committed devnet sample IS flagged (it uses public dev keys)", () => {
  const g = JSON.parse(readFileSync(join(ROOT, "chain/genesis.devnet.sample.json"), "utf8"));
  const found = publicKeyAddressesIn(g);
  assert.ok(found.length > 0, "devnet sample must be detected as public-key controlled");
  assert.equal(isProductionSafe(g), false);
});

test("a clean genesis passes", () => {
  const clean = { app_state: { bank: { balances: [{ address: "cosmos1secretsecretsecretsecretsecretsecretxx", coins: [] }] }, genutil: { gen_txs: [] } } };
  assert.deepEqual(publicKeyAddressesIn(clean), []);
  assert.equal(isProductionSafe(clean), true);
});
