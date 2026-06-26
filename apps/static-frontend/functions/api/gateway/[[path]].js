function isForbiddenProductionUrl(value, env) {
  if (!value || env.STEP_DEPLOY_ENV === "local") return false;
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    if (url.protocol !== "https:") return true;
    if (["localhost", "127.0.0.1", "0.0.0.0", "::1"].includes(host)) return true;
    if (/^10\./.test(host) || /^192\.168\./.test(host) || /^172\.(1[6-9]|2\d|3[0-1])\./.test(host)) return true;
  } catch {
    return true;
  }
  return false;
}

function targetUrl(requestUrl, upstream) {
  const source = new URL(requestUrl);
  const path = source.pathname.replace(/^\/api\/gateway\/?/, "");
  const target = new URL(path, upstream.endsWith("/") ? upstream : `${upstream}/`);
  target.search = source.search;
  return target;
}

export async function onRequest(context) {
  const upstream = context.env.STEP_BACKEND_GATEWAY_URL;
  if (!upstream) return Response.json({ error: "no_healthy_peer", service: "gateway" }, { status: 503 });
  if (isForbiddenProductionUrl(upstream, context.env)) {
    return Response.json({ error: "production_localhost_forbidden", service: "gateway" }, { status: 500 });
  }
  const method = context.request.method;
  const response = await fetch(targetUrl(context.request.url, upstream), {
    method,
    headers: context.request.headers,
    body: method === "GET" || method === "HEAD" ? undefined : context.request.body,
  });
  return new Response(response.body, response);
}
