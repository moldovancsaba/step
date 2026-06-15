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

function pathParam(value) {
  const path = Array.isArray(value) ? value.join("/") : value || "";
  return path.replace(/^\/+/, "");
}

export async function onRequest(context) {
  const upstream = context.env.STEP_BACKEND_INDEXER_URL;
  if (!upstream) {
    return Response.json({ error: "STEP_BACKEND_INDEXER_URL is not configured" }, { status: 502 });
  }

  const source = new URL(context.request.url);
  const target = new URL(pathParam(context.params.path), upstream.endsWith("/") ? upstream : `${upstream}/`);
  target.search = source.search;

  const method = context.request.method;
  const body = method === "GET" || method === "HEAD" ? undefined : context.request.body;
  const response = await fetch(target, {
    method,
    headers: copyHeaders(context.request.headers),
    body,
  });

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: copyHeaders(response.headers),
  });
}
