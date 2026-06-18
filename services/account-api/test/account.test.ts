/**
 * Account API tests: contract behaviour, zero-knowledge storage assertions, and
 * a full client-side crypto round-trip (KDF → AES-GCM encrypt → store → login →
 * decrypt) proving the server never needs the wallet key or password.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { gcm } from "@noble/ciphers/aes";
import { argon2id } from "@noble/hashes/argon2";
import { createApp, normalizeIdentity, type AccountDeps } from "../src/app.js";
import { InMemoryAccountStore } from "../src/store.js";

const utf8 = (s: string) => new TextEncoder().encode(s);
const b64 = (b: Uint8Array) => Buffer.from(b).toString("base64");

// Simulate the browser KDF: password → Argon2id → 64 bytes split into
// authKey (sent to server) + wrapKey (never leaves the client).
function clientKdf(password: string, salt: Uint8Array) {
  const dk = argon2id(utf8(password), salt, { m: 8192, t: 2, p: 1, dkLen: 64 });
  return { authKey: b64(dk.slice(0, 32)), wrapKey: dk.slice(32, 64) };
}

function makeApp() {
  let store = new InMemoryAccountStore(() => "2026-06-17T00:00:00.000Z");
  const deps: AccountDeps = {
    store,
    sessionSecret: "test-secret-0123456789", // gitleaks:allow — unit-test fixture, not a real secret
    sessionTtlSeconds: 3600,
    secureCookies: false,
    nowUnix: () => 1_750_000_000,
  };
  return { ...createApp(deps), store };
}

// A registration payload mirroring what a real client would compute.
function buildRegistration(password: string, walletKey: Uint8Array, address: `0x${string}`) {
  const salt = new Uint8Array(16).fill(7);
  const iv = new Uint8Array(12).fill(9);
  const { authKey, wrapKey } = clientKdf(password, salt);
  const ciphertext = gcm(wrapKey, iv).encrypt(walletKey);
  return {
    body: {
      identity: "Alice@example.com",
      authKey,
      address,
      vault_ciphertext: b64(ciphertext),
      iv: b64(iv),
      kdf_params: { algo: "argon2id", m: 8192, t: 2, p: 1, salt: b64(salt) },
    },
    salt,
    iv,
  };
}

describe("identity normalization", () => {
  it("lowercases and trims; rejects junk", () => {
    expect(normalizeIdentity("  Bob@Example.com ")).toBe("bob@example.com");
    expect(normalizeIdentity("alice123")).toBe("alice123");
    expect(normalizeIdentity("a")).toBeUndefined();
    expect(normalizeIdentity("has space")).toBeUndefined();
    expect(normalizeIdentity(42)).toBeUndefined();
  });
});

describe("account api", () => {
  let app: ReturnType<typeof makeApp>["app"];
  let store: InMemoryAccountStore;

  beforeEach(() => {
    const made = makeApp();
    app = made.app;
    store = made.store;
  });

  const walletKey = new Uint8Array(32).fill(0x42);
  const address = "0x1111111111111111111111111111111111111111" as const;

  it("register → login → session → logout, with full crypto round-trip", async () => {
    const reg = buildRegistration("correct horse battery staple", walletKey, address);

    const r1 = await app.request("/v1/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(reg.body),
    });
    expect(r1.status).toBe(201);

    // Login from a "fresh device": only the password + identity are known.
    const { authKey } = clientKdf("correct horse battery staple", reg.salt);
    const r2 = await app.request("/v1/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ identity: "alice@example.com", authKey }),
    });
    expect(r2.status).toBe(200);
    const loginBody = (await r2.json()) as {
      vault_ciphertext: string;
      iv: string;
      address: string;
      kdf_params: { salt: string };
    };
    expect(loginBody.address).toBe(address);

    // Client reconstructs wrapKey from password + returned salt, decrypts.
    const { wrapKey } = clientKdf(
      "correct horse battery staple",
      Buffer.from(loginBody.kdf_params.salt, "base64"),
    );
    const decrypted = gcm(wrapKey, Buffer.from(loginBody.iv, "base64")).decrypt(
      Buffer.from(loginBody.vault_ciphertext, "base64"),
    );
    expect(Buffer.from(decrypted).equals(Buffer.from(walletKey))).toBe(true);

    // Session cookie works.
    const cookie = r2.headers.get("set-cookie")!.split(";")[0]!;
    const r3 = await app.request("/v1/session", { headers: { cookie } });
    expect(r3.status).toBe(200);
    expect(await r3.json()).toEqual({ identity: "alice@example.com", address });

    // Logout clears the cookie; the OLD token still verifies (stateless) but a
    // logged-out client drops it. Session endpoint with no cookie → 401.
    const r4 = await app.request("/v1/logout", { method: "POST" });
    expect(r4.status).toBe(204);
    const r5 = await app.request("/v1/session");
    expect(r5.status).toBe(401);
  });

  it("wrong password returns generic 401", async () => {
    const reg = buildRegistration("rightpass-rightpass", walletKey, address);
    await app.request("/v1/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(reg.body),
    });
    const { authKey } = clientKdf("WRONGpass-WRONGpass", reg.salt);
    const r = await app.request("/v1/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ identity: "alice@example.com", authKey }),
    });
    expect(r.status).toBe(401);
    expect(await r.json()).toEqual({ error: "invalid credentials" });
  });

  it("unknown identity returns the same generic 401 (no enumeration)", async () => {
    const r = await app.request("/v1/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ identity: "nobody@example.com", authKey: "x".repeat(32) }),
    });
    expect(r.status).toBe(401);
    expect(await r.json()).toEqual({ error: "invalid credentials" });
  });

  it("duplicate identity returns 409", async () => {
    const reg = buildRegistration("pw-pw-pw-pw-pw-pw", walletKey, address);
    const opts = {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(reg.body),
    };
    expect((await app.request("/v1/register", opts)).status).toBe(201);
    const dup = await app.request("/v1/register", opts);
    expect(dup.status).toBe(409);
    expect(await dup.json()).toEqual({ error: "identity taken" });
  });

  it("validation errors are 400", async () => {
    const bad = await app.request("/v1/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ identity: "alice@example.com", authKey: "short", address }),
    });
    expect(bad.status).toBe(400);
  });

  it("stored row contains ONLY a verifier + opaque ciphertext + address (no key, no password)", async () => {
    const password = "super-secret-password-123"; // gitleaks:allow — unit-test fixture
    const reg = buildRegistration(password, walletKey, address);
    await app.request("/v1/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(reg.body),
    });
    const row = await store.byIdentity("alice@example.com");
    expect(row).toBeDefined();
    const serialized = JSON.stringify(row);
    // No plaintext password, authKey, or raw wallet key anywhere in storage.
    expect(serialized).not.toContain(password);
    expect(serialized).not.toContain(reg.body.authKey);
    expect(serialized).not.toContain(Buffer.from(walletKey).toString("hex"));
    expect(row!.auth_hash.startsWith("hmac-sha256$")).toBe(true);
    expect(row!.address).toBe(address);
  });

  it("vault rotation requires a session and updates the ciphertext", async () => {
    const reg = buildRegistration("rotate-me-rotate-me", walletKey, address);
    await app.request("/v1/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(reg.body),
    });
    // Unauthenticated rotation rejected.
    const unauth = await app.request("/v1/vault", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ vault_ciphertext: "QUJD", iv: "QUJD" }),
    });
    expect(unauth.status).toBe(401);

    const { authKey } = clientKdf("rotate-me-rotate-me", reg.salt);
    const login = await app.request("/v1/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ identity: "alice@example.com", authKey }),
    });
    const cookie = login.headers.get("set-cookie")!.split(";")[0]!;
    const rot = await app.request("/v1/vault", {
      method: "PUT",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ vault_ciphertext: "QUJDREVG", iv: "R0hJSktM" }),
    });
    expect(rot.status).toBe(200);
    expect((await store.byIdentity("alice@example.com"))!.vault_ciphertext).toBe("QUJDREVG");
  });
});
