/**
 * Production wiring for the account API. Dev defaults to the in-memory store;
 * a Postgres-backed AccountStore is the deploy adapter (same interface). The
 * session signing key MUST come from the environment in production.
 *
 * Env: SESSION_SIGNING_KEY (required in prod), ACCOUNT_PORT (default 8091),
 * SESSION_TTL_SECONDS (default 86400), SECURE_COOKIES (default true),
 * DATABASE_URL (Postgres adapter; unset → in-memory dev store).
 */
import { serve } from "@hono/node-server";
import { randomBytes } from "node:crypto";
import { createApp } from "./app.js";
import { InMemoryAccountStore, type AccountStore } from "./store.js";
import { SqliteAccountStore } from "./sqlite-store.js";

const sessionSecret = process.env.SESSION_SIGNING_KEY;
if (!sessionSecret && process.env.NODE_ENV === "production") {
  throw new Error("SESSION_SIGNING_KEY is required in production");
}

// Durable by default: ACCOUNT_DB_FILE points at a SQLite file so accounts and
// their encrypted wallet vaults survive a restart. Unset (tests) → in-memory.
const dbFile = process.env.ACCOUNT_DB_FILE;
const store: AccountStore = dbFile ? new SqliteAccountStore(dbFile) : new InMemoryAccountStore();
console.log(dbFile ? `account-api store: SQLite (${dbFile})` : "account-api store: in-memory");

// Browser origins allowed to call this API with credentials. Local-first dev
// serves the web app from a different port (localhost:3020) than this API
// (:8091) — a cross-origin, credentialed setup that needs CORS + a cookie
// SameSite the browser will send. STEP_CORS_ORIGINS is set by scripts/dev/up.mjs.
const corsOrigin = (process.env.STEP_CORS_ORIGINS ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const secureCookies = (process.env.SECURE_COOKIES ?? "true") !== "false";

const { app } = createApp({
  store,
  sessionSecret: sessionSecret ?? randomBytes(32).toString("hex"),
  sessionTtlSeconds: Number(process.env.SESSION_TTL_SECONDS ?? 86_400),
  secureCookies,
  // Cross-site cookies need SameSite=None;Secure. On local http (no Secure) the
  // browser rejects None, but localhost ports are same-site so "Lax" is sent.
  cookieSameSite: process.env.COOKIE_SAMESITE as "Strict" | "Lax" | "None" | undefined,
  corsOrigin: corsOrigin.length ? corsOrigin : undefined,
  nowUnix: () => Math.floor(Date.now() / 1000),
});

const port = Number(process.env.ACCOUNT_PORT ?? 8091);
console.log(`account-api listening on :${port}`);
serve({ fetch: app.fetch, port });
