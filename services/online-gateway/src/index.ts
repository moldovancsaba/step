import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Context } from "hono";

interface Config {
  port: number;
  gatewayUrl: string;
  indexerUrl: string;
  publicBaseUrl?: string;
  staticRoot: string;
  corsOrigins: string[];
}

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

function env(name: string, fallback: string) {
  return process.env[name] && process.env[name]!.trim() ? process.env[name]!.trim() : fallback;
}

function loadConfig(): Config {
  const staticRoot = resolve(
    env("STEP_STATIC_ROOT", join(REPO_ROOT, "apps/static-frontend/dist")),
  );
  return {
    port: Number(env("STEP_ONLINE_GATEWAY_PORT", "8070")),
    gatewayUrl: env("GATEWAY_URL", "http://127.0.0.1:8080"),
    indexerUrl: env("INDEXER_URL", "http://127.0.0.1:8090"),
    publicBaseUrl: process.env.STEP_PUBLIC_BASE_URL?.replace(/\/$/, ""),
    staticRoot,
    corsOrigins: (process.env.STEP_ONLINE_CORS_ORIGINS ?? "")
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean),
  };
}

const hopByHopHeaders = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "host",
]);

function forwardHeaders(headers: Headers) {
  const next = new Headers();
  for (const [key, value] of headers) {
    if (!hopByHopHeaders.has(key.toLowerCase())) next.set(key, value);
  }
  return next;
}

function joinTarget(base: string, path: string, query: string) {
  const url = new URL(path, base.endsWith("/") ? base : `${base}/`);
  url.search = query;
  return url;
}

function createApp(config: Config) {
  const app = new Hono();

  if (config.corsOrigins.length) {
    app.use(
      "/api/*",
      cors({
        origin: config.corsOrigins,
        allowMethods: ["GET", "POST", "OPTIONS"],
        allowHeaders: ["content-type"],
      }),
    );
  }

  app.get("/healthz", (c) => c.json({ ok: true }));

  app.get("/config.js", (c) => {
    const base = config.publicBaseUrl ?? "";
    return c.text(
      `window.STEP_CONFIG = ${JSON.stringify(
        {
          gatewayUrl: `${base}/api/gateway`,
          indexerUrl: `${base}/api/indexer`,
        },
        null,
        2,
      )};\n`,
      200,
      { "content-type": "application/javascript; charset=utf-8" },
    );
  });

  async function proxy(c: Context, upstream: string, prefix: string) {
    const source = new URL(c.req.url);
    const path = source.pathname.slice(prefix.length) || "/";
    const target = joinTarget(upstream, path, source.search);
    const method = c.req.method;
    const body = method === "GET" || method === "HEAD" ? undefined : c.req.raw.body;
    try {
      const resp = await fetch(target, {
        method,
        headers: forwardHeaders(c.req.raw.headers),
        body,
        duplex: body ? "half" : undefined,
      } as RequestInit);
      return new Response(resp.body, {
        status: resp.status,
        statusText: resp.statusText,
        headers: forwardHeaders(resp.headers),
      });
    } catch (err) {
      return c.json(
        {
          error: "upstream_unavailable",
          upstream,
          detail: err instanceof Error ? err.message : String(err),
        },
        502,
      );
    }
  }

  app.all("/api/gateway/*", (c) => proxy(c, config.gatewayUrl, "/api/gateway"));
  app.all("/api/indexer/*", (c) => proxy(c, config.indexerUrl, "/api/indexer"));

  if (existsSync(config.staticRoot)) {
    app.use("/*", serveStatic({ root: config.staticRoot }));
    app.get("*", serveStatic({ path: join(config.staticRoot, "index.html") }));
  } else {
    app.get("*", (c) =>
      c.text(
        `Static frontend not built at ${config.staticRoot}. Run: pnpm --filter @step/static-frontend build\n`,
        503,
      ),
    );
  }

  return app;
}

const config = loadConfig();
serve({ fetch: createApp(config).fetch, port: config.port });

console.log(
  `[online-gateway] listening on :${config.port}; static=${config.staticRoot}; gateway=${config.gatewayUrl}; indexer=${config.indexerUrl}`,
);
