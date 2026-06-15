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
  const path = source.pathname.slice(prefix.length) || "/";
  const target = new URL(path, upstream.endsWith("/") ? upstream : `${upstream}/`);
  target.search = source.search;
  return target;
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
