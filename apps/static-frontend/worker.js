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

const SERVICES = new Map([
  ["/api/gateway", "gateway"],
  ["/api/mesh", "mesh"],
  ["/api/indexer", "indexer"],
  ["/api/fleet", "fleet"],
  ["/api/trust-centers", "gateway"],
]);

function copyHeaders(headers) {
  const next = new Headers();
  for (const [key, value] of headers) {
    if (!HOP_BY_HOP_HEADERS.has(key.toLowerCase())) next.set(key, value);
  }
  return next;
}

function json(data, status = 200, headers = {}) {
  return Response.json(data, { status, headers: { "cache-control": "no-store", ...headers } });
}

function requestId() {
  return crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
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
  if (isLocalOrPrivate(value)) {
    throw new Error(`${name} is local/private and forbidden in production`);
  }
  if (value.startsWith("http://")) {
    throw new Error(`${name} must use HTTPS in production`);
  }
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

function classify(pathname) {
  const sorted = [...SERVICES.entries()].sort((a, b) => b[0].length - a[0].length);
  for (const [prefix, service] of sorted) {
    if (pathname === prefix || pathname.startsWith(`${prefix}/`)) return { prefix, service };
  }
  return null;
}

function legacyPeerRecords(env) {
  const records = [];
  const add = (url, services, nodeAddress) => {
    if (!url) return;
    records.push({
      nodeAddress: nodeAddress || `bootstrap-${services.join("-")}`,
      publicUrl: url,
      services,
      status: "active",
      version: "bootstrap",
      lastSeen: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      source: "worker-env",
    });
  };
  add(env.STEP_BACKEND_GATEWAY_URL, ["gateway", "mesh"], "bootstrap-gateway");
  add(env.STEP_BACKEND_INDEXER_URL, ["indexer"], "bootstrap-indexer");
  add(env.STEP_BACKEND_FLEET_URL, ["fleet"], "bootstrap-fleet");
  return records;
}

function parseStaticPeers(env) {
  if (!env.STEP_PEERS_JSON) return [];
  try {
    const parsed = JSON.parse(env.STEP_PEERS_JSON);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function isPeerHealthy(peer, service, env) {
  if (!peer || peer.status && peer.status !== "active") return false;
  const services = Array.isArray(peer.services) ? peer.services : [];
  if (!services.includes(service) && !(service === "mesh" && services.includes("gateway"))) return false;
  if (!peer.publicUrl || !isHttpUrl(peer.publicUrl)) return false;
  if ((env.STEP_DEPLOY_ENV || "production") !== "local") {
    if (!peer.publicUrl.startsWith("https://")) return false;
    if (isLocalOrPrivate(peer.publicUrl)) return false;
  }
  if (peer.expiresAt && Number.isFinite(Date.parse(peer.expiresAt)) && Date.parse(peer.expiresAt) <= Date.now()) return false;
  return true;
}

async function directoryPeers(env, service) {
  if (!env.STEP_PEER_DIRECTORY_URL) return [];
  assertPublicEndpoint(env.STEP_PEER_DIRECTORY_URL, "STEP_PEER_DIRECTORY_URL", env);
  const base = env.STEP_PEER_DIRECTORY_URL.replace(/\/$/, "");
  const url = `${base}/api/peers/healthy?service=${encodeURIComponent(service)}`;
  const response = await fetch(url, { headers: { accept: "application/json" }, cf: { cacheTtl: 5, cacheEverything: false } });
  if (!response.ok) return [];
  const data = await response.json().catch(() => null);
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.peers)) return data.peers;
  return [];
}

async function loadPeers(env, service) {
  const peers = [
    ...parseStaticPeers(env),
    ...legacyPeerRecords(env),
    ...(await directoryPeers(env, service).catch(() => [])),
  ];
  const seen = new Set();
  return peers
    .filter((peer) => isPeerHealthy(peer, service, env))
    .filter((peer) => {
      const key = `${peer.nodeAddress || "unknown"}|${peer.publicUrl}|${(peer.services || []).join(",")}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function routeHeaders(routeId, peer, attemptCount, service) {
  return {
    "x-step-route-id": routeId,
    "x-step-peer": peer?.nodeAddress || "none",
    "x-step-peer-service": service,
    "x-step-route-attempts": String(attemptCount),
  };
}

async function proxyPeer(request, peer, route, routeId, attempt) {
  const target = targetUrl(request.url, route.prefix, peer.publicUrl);
  const method = request.method;
  const body = method === "GET" || method === "HEAD" ? undefined : request.body;
  const controller = new AbortController();
  const timeoutMs = Number(peer.timeoutMs || 8000);
  const timeout = setTimeout(() => controller.abort("timeout"), timeoutMs);
  try {
    const response = await fetch(target, {
      method,
      headers: copyHeaders(request.headers),
      body,
      signal: controller.signal,
    });
    const headers = copyHeaders(response.headers);
    for (const [key, value] of Object.entries(routeHeaders(routeId, peer, attempt, route.service))) headers.set(key, value);
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  } finally {
    clearTimeout(timeout);
  }
}

function retryable(request, responseOrError) {
  if (!(request.method === "GET" || request.method === "HEAD")) return false;
  if (responseOrError instanceof Response) return responseOrError.status >= 500 || responseOrError.status === 429;
  return true;
}

async function routeApi(request, env, route) {
  const rid = requestId();
  const peers = await loadPeers(env, route.service);
  if (!peers.length) {
    return json(
      { error: "no_healthy_peer", layer: "edge_gateway", service: route.service, nextAction: "wait_for_peer_or_check_trust_center" },
      503,
      routeHeaders(rid, null, 0, route.service),
    );
  }

  const maxAttempts = request.method === "GET" || request.method === "HEAD" ? Math.min(peers.length, Number(env.PEER_ROUTE_RETRY_MAX || 3)) : 1;
  let lastError = null;
  for (let i = 0; i < maxAttempts; i += 1) {
    const peer = peers[i];
    try {
      const response = await proxyPeer(request, peer, route, rid, i + 1);
      if (!retryable(request, response) || i === maxAttempts - 1) return response;
      lastError = `HTTP ${response.status}`;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      if (i === maxAttempts - 1 || !retryable(request, err)) break;
    }
  }

  return json(
    { error: "peer_route_failed", layer: "edge_gateway", service: route.service, reason: lastError, nextAction: "retry_after_peer_recovery" },
    502,
    routeHeaders(rid, null, maxAttempts, route.service),
  );
}

async function peerListResponse(env, onlyHealthy, requestUrl) {
  const url = new URL(requestUrl);
  const service = url.searchParams.get("service") || "gateway";
  const peers = onlyHealthy ? await loadPeers(env, service) : [...parseStaticPeers(env), ...legacyPeerRecords(env), ...(await directoryPeers(env, service).catch(() => []))];
  return json({ peers, generatedAt: new Date().toISOString(), service });
}

async function edgeHealth(env) {
  const services = ["gateway", "mesh", "indexer", "fleet"];
  const result = {};
  for (const service of services) {
    result[service] = (await loadPeers(env, service).catch(() => [])).map((p) => ({ nodeAddress: p.nodeAddress, publicUrl: p.publicUrl, services: p.services }));
  }
  return json({ status: "ok", generatedAt: new Date().toISOString(), deployEnv: env.STEP_DEPLOY_ENV || "production", peers: result });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const { pathname } = url;
    const pageBase = (env.STEP_PUBLIC_BASE_URL || url.origin).replace(/\/$/, "");
    const explorerRoot = normalizeBase(env.STEP_WEB_EXPLORER_URL);
    const minerRoot = normalizeBase(env.STEP_WEB_MINER_URL);

    try {
      assertPublicEndpoint(env.STEP_BACKEND_GATEWAY_URL, "STEP_BACKEND_GATEWAY_URL", env);
      assertPublicEndpoint(env.STEP_BACKEND_INDEXER_URL, "STEP_BACKEND_INDEXER_URL", env);
      assertPublicEndpoint(env.STEP_BACKEND_FLEET_URL, "STEP_BACKEND_FLEET_URL", env);
    } catch (err) {
      return json({ error: "production_localhost_forbidden", message: err.message, nextAction: "fix_worker_routing_config" }, 500);
    }

    if (pathname === "/config.js") {
      const explorerUrl = resolveConfiguredUrl(pageBase, explorerRoot || "/explorer");
      const minerUrl = resolveConfiguredUrl(pageBase, minerRoot || "/miner");
      return new Response(
        `window.STEP_CONFIG = ${JSON.stringify({ gatewayUrl: "/api/gateway", indexerUrl: "/api/indexer", explorerUrl, minerUrl, edgeGatewayUrl: "/api", network: "step-alpha" }, null, 2)};\n`,
        { headers: { "content-type": "application/javascript; charset=utf-8", "cache-control": "no-store" }, status: 200 },
      );
    }

    if (pathname === "/api/edge/health") return edgeHealth(env);
    if (pathname === "/api/peers") return peerListResponse(env, false, request.url);
    if (pathname === "/api/peers/healthy") return peerListResponse(env, true, request.url);

    const route = classify(pathname);
    if (route) return routeApi(request, env, route);

    if (pathname.startsWith("/explorer")) {
      if (isHttpUrl(explorerRoot)) {
        assertPublicEndpoint(explorerRoot, "STEP_WEB_EXPLORER_URL", env);
        const path = normalizeSubpath(pathname, "/explorer");
        const target = new URL(path, explorerRoot.endsWith("/") ? explorerRoot : `${explorerRoot}/`);
        target.search = url.search;
        return proxyTo(request, target.toString());
      }
      return env.ASSETS.fetch(request);
    }

    if (pathname.startsWith("/miner")) {
      if (isHttpUrl(minerRoot)) {
        assertPublicEndpoint(minerRoot, "STEP_WEB_MINER_URL", env);
        const path = normalizeSubpath(pathname, "/miner");
        const target = new URL(path, minerRoot.endsWith("/") ? minerRoot : `${minerRoot}/`);
        target.search = url.search;
        return proxyTo(request, target.toString());
      }
      return env.ASSETS.fetch(request);
    }

    return env.ASSETS.fetch(request);
  },
};
