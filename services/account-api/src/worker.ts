/**
 * Cloudflare Workers entry for the account-api (deploy target). Wires the shared
 * Hono app (src/app.ts) to a KV-backed store + cross-site cookie/CORS config so
 * the browser web app (step.regiominer.com) can register/login against it.
 * Sessions are stateless signed cookies, so no server session store is needed.
 *
 * Bindings/vars (wrangler.toml): STEP_ACCOUNTS (KV), CORS_ORIGIN,
 * SESSION_TTL_SECONDS, and the SESSION_SIGNING_KEY secret.
 */
import { createApp } from "./app.js";
import { KvAccountStore, type KvLike } from "./kv-store.js";

interface Env {
  STEP_ACCOUNTS: KvLike;
  SESSION_SIGNING_KEY: string;
  CORS_ORIGIN?: string;
  SESSION_TTL_SECONDS?: string;
}

function corsOrigins(value?: string): string | string[] | undefined {
  const origins = value
    ?.split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  if (!origins?.length) return undefined;
  return origins.length === 1 ? origins[0] : origins;
}

export default {
  // The Workers runtime also passes an ExecutionContext as the 3rd arg; we don't
  // use it (no waitUntil), and Hono's fetch ctx is optional, so we omit it.
  fetch(request: Request, env: Env): Response | Promise<Response> {
    const { app } = createApp({
      store: new KvAccountStore(env.STEP_ACCOUNTS),
      sessionSecret: env.SESSION_SIGNING_KEY,
      sessionTtlSeconds: Number(env.SESSION_TTL_SECONDS ?? 86_400),
      secureCookies: true,
      cookieSameSite: "None", // web app is on a different site (cross-site cookies)
      corsOrigin: corsOrigins(env.CORS_ORIGIN) ?? "https://step.regiominer.com",
      nowUnix: () => Math.floor(Date.now() / 1000),
    });
    return app.fetch(request, env);
  },
};
