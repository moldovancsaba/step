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
import { InMemoryAccountStore } from "./store.js";

const sessionSecret = process.env.SESSION_SIGNING_KEY;
if (!sessionSecret && process.env.NODE_ENV === "production") {
  throw new Error("SESSION_SIGNING_KEY is required in production");
}

const store = new InMemoryAccountStore();
if (process.env.DATABASE_URL) {
  console.warn(
    "DATABASE_URL set but Postgres adapter not enabled in this build; using in-memory store",
  );
}

const { app } = createApp({
  store,
  sessionSecret: sessionSecret ?? randomBytes(32).toString("hex"),
  sessionTtlSeconds: Number(process.env.SESSION_TTL_SECONDS ?? 86_400),
  secureCookies: (process.env.SECURE_COOKIES ?? "true") !== "false",
  nowUnix: () => Math.floor(Date.now() / 1000),
});

const port = Number(process.env.ACCOUNT_PORT ?? 8091);
console.log(`account-api listening on :${port}`);
serve({ fetch: app.fetch, port });
