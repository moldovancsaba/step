const HOP_BY_HOP_HEADERS = new Set([
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

const ROUTES = [
  ["/api/account", "STEP_BACKEND_ACCOUNT_URL", "account"],
  ["/api/gateway", "STEP_BACKEND_GATEWAY_URL", "gateway"],
  ["/api/mesh", "STEP_BACKEND_GATEWAY_URL", "mesh"],
  ["/api/indexer", "STEP_BACKEND_INDEXER_URL", "indexer"],
  ["/api/nft", "STEP_BACKEND_NFT_URL", "nft"],
  ["/api/fleet", "STEP_BACKEND_FLEET_URL", "fleet"],
];

const DEFAULTS = {
  STEP_BACKEND_ACCOUNT_URL: "https://acc.step.regiominer.com",
  STEP_BACKEND_GATEWAY_URL: "https://gw.step.regiominer.com",
  STEP_BACKEND_INDEXER_URL: "https://idx.step.regiominer.com",
  STEP_BACKEND_NFT_URL: "https://nft.step.regiominer.com",
};

function copyHeaders(headers) {
  const next = new Headers();
  for (const [key, value] of headers) {
    if (!HOP_BY_HOP_HEADERS.has(key.toLowerCase())) next.set(key, value);
  }
  return next;
}

function json(data, status = 200) {
  return Response.json(data, { status, headers: { "cache-control": "no-store" } });
}

function normalizeBase(value) {
  return (value || "").replace(/\/+$/, "");
}

function isLocalOrPrivate(value) {
  if (!value) return false;
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    if (["localhost", "127.0.0.1", "0.0.0.0", "::1", "[::1]"].includes(host)) return true;
    if (/^10\./.test(host)) return true;
    if (/^192\.168\./.test(host)) return true;
    if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(host)) return true;
  } catch {
    return false;
  }
  return false;
}

function assertPublicEndpoint(value, name, env) {
  if (!value) return;
  if ((env.STEP_DEPLOY_ENV || "production") === "local") return;
  if (!value.startsWith("https://")) throw new Error(`${name} must use HTTPS in production`);
  if (isLocalOrPrivate(value)) throw new Error(`${name} is local/private and forbidden in production`);
}

function routeFor(pathname) {
  return [...ROUTES]
    .sort((a, b) => b[0].length - a[0].length)
    .find(([prefix]) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

function routeTarget(requestUrl, prefix, upstream) {
  const source = new URL(requestUrl);
  const suffix = source.pathname.slice(prefix.length).replace(/^\/+/, "");
  const target = new URL(suffix, upstream.endsWith("/") ? upstream : `${upstream}/`);
  target.search = source.search;
  return target;
}

async function proxy(request, env, prefix, envKey, service) {
  const upstream = normalizeBase(env[envKey] || DEFAULTS[envKey]);
  if (!upstream) return json({ error: "backend_not_configured", service, envKey }, 503);
  assertPublicEndpoint(upstream, envKey, env);

  const method = request.method;
  const response = await fetch(routeTarget(request.url, prefix, upstream), {
    method,
    headers: copyHeaders(request.headers),
    body: method === "GET" || method === "HEAD" ? undefined : request.body,
  });
  const headers = copyHeaders(response.headers);
  headers.set("cache-control", "no-store");
  headers.set("x-step-edge-service", service);
  headers.set("x-step-edge-upstream", upstream);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/healthz") {
      return new Response("ok", { headers: { "cache-control": "no-store" } });
    }

    const route = routeFor(url.pathname);
    if (route) {
      const [prefix, envKey, service] = route;
      try {
        return await proxy(request, env, prefix, envKey, service);
      } catch (error) {
        return json(
          {
            error: "edge_proxy_failed",
            service,
            message: error instanceof Error ? error.message : String(error),
          },
          502,
        );
      }
    }

    return env.ASSETS.fetch(request);
  },
};
