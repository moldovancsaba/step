/**
 * SqliteAccountStore: durability + the same contract as the in-memory store.
 * The key assertion is persistence — a store reopened on the same file returns
 * the previously-inserted account (what makes the local backend a real solution).
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { IdentityTakenError, type NewAccount } from "../src/store.js";
import { SqliteAccountStore } from "../src/sqlite-store.js";

const sample: NewAccount = {
  identity: "pilot@example.com",
  auth_hash: "deadbeef",
  address: "0x1111111111111111111111111111111111111111",
  vault_ciphertext: "Y2lwaGVy",
  kdf_params: { algo: "argon2id", m: 19456, t: 2, p: 1, salt: "c2FsdA==" },
  iv: "aXY=",
};

let dir: string;
let file: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "step-acct-"));
  file = join(dir, "account.db");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("SqliteAccountStore", () => {
  it("inserts and reads back an account", async () => {
    const store = new SqliteAccountStore(file);
    const row = await store.insert(sample);
    expect(row.identity).toBe(sample.identity);
    const got = await store.byIdentity(sample.identity);
    expect(got?.address).toBe(sample.address);
    expect(got?.kdf_params).toEqual(sample.kdf_params);
  });

  it("persists across reopen (survives a restart)", async () => {
    const first = new SqliteAccountStore(file);
    await first.insert(sample);
    // A new store on the same file = a process restart.
    const second = new SqliteAccountStore(file);
    const got = await second.byIdentity(sample.identity);
    expect(got?.address).toBe(sample.address);
  });

  it("rejects a duplicate identity", async () => {
    const store = new SqliteAccountStore(file);
    await store.insert(sample);
    await expect(store.insert(sample)).rejects.toBeInstanceOf(IdentityTakenError);
  });

  it("rotates the vault ciphertext", async () => {
    const store = new SqliteAccountStore(file);
    await store.insert(sample);
    expect(await store.updateVault(sample.identity, "bmV3Q2lwaGVy", "bmV3SXY=")).toBe(true);
    const got = await store.byIdentity(sample.identity);
    expect(got?.vault_ciphertext).toBe("bmV3Q2lwaGVy");
    expect(await store.updateVault("nobody@example.com", "x", "y")).toBe(false);
  });
});
