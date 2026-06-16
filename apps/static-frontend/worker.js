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

function copyHeaders(headers) {
  const next = new Headers();
  for (const [key, value] of headers) {
    if (!HOP_BY_HOP_HEADERS.has(key.toLowerCase())) next.set(key, value);
  }
  return next;
}

function targetUrl(requestUrl, prefix, upstream) {
  const source = new URL(requestUrl);
  const path = source.pathname.slice(prefix.length).replace(/^\/+/, "");
  const target = new URL(path, upstream.endsWith("/") ? upstream : `${upstream}/`);
  target.search = source.search;
  return target;
}

async function proxyTo(request, upstream) {
  const method = request.method;
  const body = method === "GET" || method === "HEAD" ? undefined : request.body;
  const response = await fetch(upstream, {
    method,
    headers: copyHeaders(request.headers),
    body,
  });
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: copyHeaders(response.headers),
  });
}

function normalizeSubpath(pathname, prefix) {
  if (pathname === prefix) return "/";
  return pathname.slice(prefix.length);
}

function normalizeBase(envUrl) {
  return envUrl?.replace(/\/$/, "") ?? "";
}

function resolveConfiguredUrl(base, candidate) {
  if (!candidate) return "";
  const value = candidate.trim();
  if (!value) return "";
  return value.startsWith("http") ? value : `${base}${value.startsWith("/") ? value : `/${value}`}`;
}

function isHttpUrl(value) {
  return /^https?:\/\//i.test(value || "");
}

async function proxy(request, upstream, prefix) {
  const method = request.method;
  const body = method === "GET" || method === "HEAD" ? undefined : request.body;
  const response = await fetch(targetUrl(request.url, prefix, upstream), {
    method,
    headers: copyHeaders(request.headers),
    body,
  });

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: copyHeaders(response.headers),
  });
}

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    const pageBase = (env.STEP_PUBLIC_BASE_URL || new URL(request.url).origin).replace(/\/$/, "");
    const explorerRoot = normalizeBase(env.STEP_WEB_EXPLORER_URL);
    const minerRoot = normalizeBase(env.STEP_WEB_MINER_URL);

    if (pathname === "/config.js") {
      const explorerUrl = resolveConfiguredUrl(pageBase, explorerRoot || "/explorer");
      const minerUrl = resolveConfiguredUrl(pageBase, minerRoot || "/miner");
      return new Response(
        `window.STEP_CONFIG = ${JSON.stringify(
          {
            gatewayUrl: "/api/gateway",
            indexerUrl: "/api/indexer",
            explorerUrl,
            minerUrl,
          },
          null,
          2,
        )};\n`,
        {
          headers: { "content-type": "application/javascript; charset=utf-8" },
          status: 200,
        },
      );
    }

    if (pathname.startsWith("/explorer")) {
      if (isHttpUrl(explorerRoot)) {
        const path = normalizeSubpath(pathname, "/explorer");
        const target = new URL(path, explorerRoot.endsWith("/") ? explorerRoot : `${explorerRoot}/`);
        target.search = new URL(request.url).search;
        return proxyTo(request, target.toString());
      }
      return env.ASSETS.fetch(request);
    }

    if (pathname.startsWith("/miner")) {
      if (isHttpUrl(minerRoot)) {
        const path = normalizeSubpath(pathname, "/miner");
        const target = new URL(path, minerRoot.endsWith("/") ? minerRoot : `${minerRoot}/`);
        target.search = new URL(request.url).search;
        return proxyTo(request, target.toString());
      }
      return env.ASSETS.fetch(request);
    }

    if (pathname.startsWith("/api/gateway")) {
      if (!env.STEP_BACKEND_GATEWAY_URL) {
        return Response.json(
          { error: "STEP_BACKEND_GATEWAY_URL is not configured" },
          { status: 502 },
        );
      }
      return proxy(request, env.STEP_BACKEND_GATEWAY_URL, "/api/gateway");
    }

    if (pathname.startsWith("/api/indexer")) {
      if (!env.STEP_BACKEND_INDEXER_URL) {
        return Response.json(
          { error: "STEP_BACKEND_INDEXER_URL is not configured" },
          { status: 502 },
        );
      }
      return proxy(request, env.STEP_BACKEND_INDEXER_URL, "/api/indexer");
    }

    return env.ASSETS.fetch(request);
  },
};
