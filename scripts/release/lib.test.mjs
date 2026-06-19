import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sha256File, sha256Bytes, packSemver, formatSemver } from "./lib.mjs";

test("sha256 known vector", async () => {
  assert.equal(
    sha256Bytes("abc"),
    "0xba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  );
  const dir = mkdtempSync(join(tmpdir(), "rel-"));
  const p = join(dir, "f");
  writeFileSync(p, "abc");
  assert.equal(await sha256File(p), sha256Bytes("abc"));
});

test("semver packs and unpacks", () => {
  const v = packSemver("1.2.3");
  assert.equal(v, (1n << 32n) | (2n << 16n) | 3n);
  assert.equal(formatSemver(v), "1.2.3");
});

test("semver rejects garbage and overflow", () => {
  assert.throws(() => packSemver("1.2"));
  assert.throws(() => packSemver("x.y.z"));
  assert.throws(() => packSemver(`1.${0x1_0000}.0`));
});
