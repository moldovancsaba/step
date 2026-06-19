#!/usr/bin/env node
/**
 * Hub artifact distribution (#39). Serves release binaries to trust-center agents
 * over the tailnet. Authenticity does NOT depend on this channel: the agent
 * verifies every downloaded byte's sha256 against the on-chain ReleaseRegistry
 * before running it, so a compromised mirror cannot inject code. This is just a
 * convenient, content-addressed delivery surface.
 *
 *   node scripts/release/serve-artifacts.mjs                 # run the server
 *   node scripts/release/serve-artifacts.mjs --stage \
 *        --version 1.2.0 --platform darwin-arm64             # add a built artifact
 *
 * Store layout: <ARTIFACT_STORE>/<platform>/<version>/{step-validator-node, manifest.json}
 * Routes:  GET /artifacts                      -> index
 *          GET /artifacts/:platform/:version   -> binary (octet-stream)
 */
import { createServer } from "node:http";
import { execSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  copyFileSync,
  readFileSync,
  readdirSync,
  statSync,
  createReadStream,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const STORE = process.env.ARTIFACT_STORE ?? join(ROOT, ".runtime/artifacts");
const PORT = Number(process.env.ARTIFACT_PORT ?? 8078);

const log = (m) => process.stdout.write(`[artifacts] ${m}\n`);

function parseArgs(argv) {
  const a = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) {
      const k = argv[i].slice(2);
      a[k] = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[(i += 1)] : "true";
    }
  }
  return a;
}

function tailnetIp() {
  for (const bin of [
    "tailscale",
    "/Applications/Tailscale.app/Contents/MacOS/Tailscale",
    "/usr/local/bin/tailscale",
  ]) {
    try {
      const ip = execSync(`${bin} ip -4`, { stdio: "pipe" }).toString().trim().split("\n")[0].trim();
      if (/^\d+\.\d+\.\d+\.\d+$/.test(ip)) return ip;
    } catch {
      /* next */
    }
  }
  return null;
}

const args = parseArgs(process.argv.slice(2));

// ── stage mode: copy the freshly-built binary + manifest into the store ──
if (args.stage === "true") {
  const version = args.version ?? die("--version required for --stage");
  const platform = args.platform ?? "darwin-arm64";
  const binary = join(ROOT, "target/release/step-validator-node");
  if (!existsSync(binary)) die("no built binary — run scripts/release/publish.mjs first");
  const dest = join(STORE, platform, version);
  mkdirSync(dest, { recursive: true });
  copyFileSync(binary, join(dest, "step-validator-node"));
  const manifestSrc = join(ROOT, ".runtime/releases", `release-${version}.json`);
  if (existsSync(manifestSrc)) copyFileSync(manifestSrc, join(dest, "manifest.json"));
  const configSrc = join(ROOT, ".runtime/releases", `config-${version}.json`);
  if (existsSync(configSrc)) copyFileSync(configSrc, join(dest, "config.json"));
  log(`staged ${platform}/${version} → ${dest}`);
  process.exit(0);
}

function die(m) {
  console.error(`[artifacts] ${m}`);
  process.exit(1);
}

// ── server mode ──
function index() {
  const out = [];
  if (!existsSync(STORE)) return out;
  for (const platform of readdirSync(STORE)) {
    const pdir = join(STORE, platform);
    if (!statSync(pdir).isDirectory()) continue;
    for (const version of readdirSync(pdir)) {
      const bin = join(pdir, version, "step-validator-node");
      if (!existsSync(bin)) continue;
      let manifest = null;
      const mp = join(pdir, version, "manifest.json");
      if (existsSync(mp)) manifest = JSON.parse(readFileSync(mp, "utf8"));
      out.push({
        platform,
        version,
        sizeBytes: statSync(bin).size,
        binarySha256: manifest?.binary_sha256 ?? null,
      });
    }
  }
  return out;
}

const server = createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  if (url.pathname === "/healthz") {
    res.writeHead(200).end("ok");
    return;
  }
  if (url.pathname === "/artifacts") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ artifacts: index() }));
    return;
  }
  const m = /^\/artifacts\/([^/]+)\/([^/]+)$/.exec(url.pathname);
  if (m) {
    const bin = join(STORE, m[1], m[2], "step-validator-node");
    if (!existsSync(bin)) {
      res.writeHead(404).end("unknown artifact");
      return;
    }
    res.writeHead(200, {
      "content-type": "application/octet-stream",
      "content-length": statSync(bin).size,
    });
    createReadStream(bin).pipe(res);
    return;
  }
  res.writeHead(404).end("not found");
});

// Bind 0.0.0.0 so the store is reachable on loopback + the tailnet. The channel
// is untrusted by design — agents verify every byte's sha256 against the on-chain
// authority before running it — so this exposure injects nothing.
const ip = tailnetIp();
server.listen(PORT, "0.0.0.0", () =>
  log(`serving artifacts on http://127.0.0.1:${PORT}/artifacts` + (ip ? ` and http://${ip}:${PORT}` : "")),
);
