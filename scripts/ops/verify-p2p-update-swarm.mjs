#!/usr/bin/env node
/**
 * Verify STEP peer-native update swarm readiness.
 *
 * This is intentionally source-agnostic: every Trust Center must expose the same
 * node-agent artifact/status API. A pass proves a peer can participate as an
 * update seed/discovery point; it does not grant validator authority.
 */
const argv = process.argv.slice(2);
const get = (name, fallback = '') => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : fallback;
};
const peersRaw = get('peers', process.env.STEP_UPDATE_SWARM_PEERS ?? 'http://127.0.0.1:9200');
const platform = get('platform', process.env.STEP_PLATFORM ?? 'darwin-arm64');
const version = get('version', process.env.STEP_RELEASE_VERSION ?? '');
const timeoutMs = Number(get('timeout-ms', '5000'));
const peers = peersRaw.split(',').map((s) => s.trim().replace(/\/$/, '')).filter(Boolean);

if (!peers.length) fail('no peers configured; use --peers url1,url2');

async function fetchWithTimeout(url) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: ctl.signal });
  } finally {
    clearTimeout(timer);
  }
}
async function json(url) {
  const res = await fetchWithTimeout(url);
  if (!res.ok) throw new Error(`${url} HTTP ${res.status}`);
  return res.json();
}
async function headOrGet(url) {
  let res = await fetchWithTimeout(url, { method: 'HEAD' }).catch(() => null);
  if (!res || !res.ok) res = await fetchWithTimeout(url);
  if (!res.ok) throw new Error(`${url} HTTP ${res.status}`);
  return res;
}
function fail(message, extra = {}) {
  console.error(JSON.stringify({ ok: false, message, ...extra }, null, 2));
  process.exit(1);
}

const results = [];
for (const peer of peers) {
  const result = { peer, healthz: false, agentStatus: false, artifactStatus: false, releaseAvailable: false, errors: [] };
  try {
    const h = await fetchWithTimeout(`${peer}/healthz`);
    result.healthz = h.ok;
    if (!h.ok) result.errors.push(`healthz HTTP ${h.status}`);
  } catch (e) { result.errors.push(`healthz ${e.message}`); }
  try {
    await json(`${peer}/v1/agent/status`);
    result.agentStatus = true;
  } catch (e) { result.errors.push(`agent status ${e.message}`); }
  try {
    const s = await json(`${peer}/artifacts/status`);
    result.artifactStatus = s.platform === platform;
    result.releases = s.releases ?? [];
    if (version) {
      result.releaseAvailable = result.releases.some((r) => r.version === version && (r.package || r.manifest));
      if (!result.releaseAvailable) result.errors.push(`release ${platform}/${version} not available`);
    } else {
      result.releaseAvailable = result.releases.length > 0;
    }
  } catch (e) { result.errors.push(`artifact status ${e.message}`); }
  if (version) {
    try {
      const res = await fetchWithTimeout(`${peer}/artifacts/${platform}/${version}/package`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      result.packageHashHeader = res.headers.get('x-step-content-sha256');
    } catch (e) { result.errors.push(`package ${e.message}`); }
  }
  results.push(result);
}

const healthy = results.filter((r) => r.healthz && r.agentStatus && r.artifactStatus && (!version || r.releaseAvailable));
if (!healthy.length) fail('no Trust Center peer passed update swarm readiness', { platform, version: version || null, results });
console.log(JSON.stringify({ ok: true, platform, version: version || null, healthyPeers: healthy.length, totalPeers: peers.length, results }, null, 2));
