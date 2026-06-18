/**
 * Account API (issue #12): registration, login, session, and an encrypted
 * wallet vault — zero-knowledge. The server stores only a verifier of the
 * client's authKey, the public address, and the opaque AES-GCM vault
 * ciphertext + KDF/IV params. It never sees the password or the wallet key and
 * is cryptographically incapable of recovering either (see
 * docs/services/STEP_account_vault.md).
 *
 * Dependencies (store, session secret, clock, cookie flags) are injected so the
 * service is unit-testable and backend-agnostic (in-memory dev / Postgres
 * deploy). Errors are generic on the auth path to prevent user enumeration; no
 * secret (authKey / ciphertext / token) is ever logged.
 */
import { Hono, type Context } from "hono";
import { cors } from "hono/cors";
import { setCookie, getCookie, deleteCookie } from "hono/cookie";
import {
  hashAuthKey,
  verifyAuthKey,
  signSession,
  verifySession,
  type SessionClaims,
} from "./crypto.js";
import { IdentityTakenError, type AccountStore, type KdfParams } from "./store.js";

export interface AccountDeps {
  store: AccountStore;
  sessionSecret: string;
  sessionTtlSeconds: number;
  /** Secure cookie flag — false only for local http dev. */
  secureCookies: boolean;
  nowUnix: () => number;
  /** Allowed browser origin for CORS (with credentials). Omit to disable CORS
   *  (same-origin / native clients). e.g. "https://step.regiominer.com". */
  corsOrigin?: string;
  /** Session cookie SameSite. Default "Strict" (same-origin). Use "None" when
   *  the browser app is on a different site than the API (cross-site cookies). */
  cookieSameSite?: "Strict" | "Lax" | "None";
}

const COOKIE = "step_session";
const IDENTITY_RE = /^[a-z0-9](?:[a-z0-9._+\-@]{1,253})[a-z0-9]$/;
const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const B64_RE = /^[A-Za-z0-9+/]+={0,2}$/;

/** Normalize identity (trim + lowercase) so logins are case-insensitive. */
export function normalizeIdentity(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const id = raw.trim().toLowerCase();
  return IDENTITY_RE.test(id) ? id : undefined;
}

function validKdf(k: unknown): k is KdfParams {
  const p = k as KdfParams;
  return (
    !!p &&
    p.algo === "argon2id" &&
    Number.isInteger(p.m) &&
    Number.isInteger(p.t) &&
    Number.isInteger(p.p) &&
    typeof p.salt === "string" &&
    B64_RE.test(p.salt)
  );
}

function isB64(s: unknown): s is string {
  return typeof s === "string" && s.length > 0 && s.length < 100_000 && B64_RE.test(s);
}

export function createApp(deps: AccountDeps): { app: Hono } {
  const app = new Hono();

  // Cross-origin browser access (with cookies) when the web app is on a
  // different origin than the API. Specific origin (never "*") + credentials.
  if (deps.corsOrigin) {
    app.use(
      "*",
      cors({
        origin: deps.corsOrigin,
        credentials: true,
        allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
        allowHeaders: ["content-type"],
      }),
    );
  }

  app.get("/healthz", (c) => c.text("ok"));

  app.post("/v1/register", async (c) => {
    let body: Record<string, unknown>;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "validation" }, 400);
    }
    const identity = normalizeIdentity(body.identity);
    const authKey = body.authKey;
    const address = body.address;
    if (
      !identity ||
      typeof authKey !== "string" ||
      authKey.length < 16 ||
      typeof address !== "string" ||
      !ADDRESS_RE.test(address) ||
      !isB64(body.vault_ciphertext) ||
      !isB64(body.iv) ||
      !validKdf(body.kdf_params)
    ) {
      return c.json({ error: "validation" }, 400);
    }
    try {
      await deps.store.insert({
        identity,
        auth_hash: hashAuthKey(authKey),
        address: address as `0x${string}`,
        vault_ciphertext: body.vault_ciphertext,
        kdf_params: body.kdf_params,
        iv: body.iv,
      });
    } catch (e) {
      if (e instanceof IdentityTakenError) return c.json({ error: "identity taken" }, 409);
      throw e;
    }
    return c.json({ ok: true }, 201);
  });

  app.post("/v1/login", async (c) => {
    let body: Record<string, unknown>;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid credentials" }, 401);
    }
    const identity = normalizeIdentity(body.identity);
    const authKey = body.authKey;
    // Generic failure (same shape) for unknown identity AND wrong password to
    // avoid user enumeration.
    if (!identity || typeof authKey !== "string") {
      return c.json({ error: "invalid credentials" }, 401);
    }
    const acct = await deps.store.byIdentity(identity);
    if (!acct || !verifyAuthKey(authKey, acct.auth_hash)) {
      return c.json({ error: "invalid credentials" }, 401);
    }
    const claims: SessionClaims = {
      identity: acct.identity,
      address: acct.address,
      exp: deps.nowUnix() + deps.sessionTtlSeconds,
    };
    setCookie(c, COOKIE, signSession(claims, deps.sessionSecret), {
      httpOnly: true,
      secure: deps.secureCookies,
      sameSite: deps.cookieSameSite ?? "Strict",
      path: "/",
      maxAge: deps.sessionTtlSeconds,
    });
    return c.json({
      vault_ciphertext: acct.vault_ciphertext,
      kdf_params: acct.kdf_params,
      iv: acct.iv,
      address: acct.address,
    });
  });

  app.post("/v1/logout", (c) => {
    deleteCookie(c, COOKIE, { path: "/" });
    return c.body(null, 204);
  });

  const currentSession = (c: Context) => {
    const token = getCookie(c, COOKIE);
    return token ? verifySession(token, deps.sessionSecret, deps.nowUnix()) : undefined;
  };

  app.get("/v1/session", (c) => {
    const s = currentSession(c);
    if (!s) return c.json({ error: "unauthenticated" }, 401);
    return c.json({ identity: s.identity, address: s.address });
  });

  app.put("/v1/vault", async (c) => {
    const s = currentSession(c);
    if (!s) return c.json({ error: "unauthenticated" }, 401);
    let body: Record<string, unknown>;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "validation" }, 400);
    }
    if (!isB64(body.vault_ciphertext) || !isB64(body.iv)) {
      return c.json({ error: "validation" }, 400);
    }
    const ok = await deps.store.updateVault(s.identity, body.vault_ciphertext, body.iv);
    if (!ok) return c.json({ error: "unauthenticated" }, 401);
    return c.json({ ok: true });
  });

  return { app };
}
