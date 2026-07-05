#!/usr/bin/env node
/**
 * Fail-closed production-safety scanner (issue #100; supports the #89 "no
 * localhost" go-live proof and the M11 "True P2P Public Edge & Localhost
 * Elimination" milestone).
 *
 * Two release blockers make going public unsafe, and neither is caught by
 * scripts/ops/verify-public-edge.mjs (which only checks the *old*
 * apps/static-frontend routing tokens, not the deployed root worker.js +
 * wrangler.toml edge):
 *
 *   1. A localhost / private-network / non-HTTPS backend URL committed in
 *      production deployment config — the edge would route real users at a
 *      host only reachable on this machine, i.e. a hidden single-hub / LAN
 *      dependency (violates the environment-independent rule).
 *   2. A private key committed on a secret-named field in a non-sample file —
 *      a leaked deployer/relayer/validator key.
 *
 * The scanner reads only git-tracked files, skips samples/examples/tests, and
 * exits non-zero on any finding so CI and the go-live gate fail closed. It is
 * additive to, not a replacement for, verify-public-edge.mjs.
 *
 * Pure predicates are exported for scan-production-safety.test.mjs.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

// --- pure predicates (unit-tested; no fs/git) ------------------------------

/**
 * A URL that must never appear in production config: any plaintext http://, or
 * any scheme pointing at loopback / 0.0.0.0 / an RFC1918 private range.
 */
export const FORBIDDEN_URL =
  /(?:http:\/\/[^\s"'`)]+|https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[?::1\]?|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})[^\s"'`)]*)/i;

/** Fields whose value is a secret. A real value here in a shipped file leaks it. */
const SECRET_FIELD =
  /\b(private[_-]?key|priv[_-]?key|deployer[_-]?key|relayer[_-]?key|validator[_-]?key|secret[_-]?key|signing[_-]?key|session[_-]?signing[_-]?key|mnemonic|seed[_-]?phrase)\b/i;

/** 64-hex (with/without 0x) that is not an obvious placeholder. */
const HEX64 = /(?:0x)?[0-9a-f]{64}/i;
const PLACEHOLDER = /^(?:0x)?(?:0+|d[e3]ad.*|f+|(?:x|_|-|\.)+)$/i;

/**
 * Does a production-config line contain a forbidden URL? Pure-comment lines and
 * lines with an explicit `# safety:allow-local` escape hatch are allowed, so a
 * deliberate local default can be kept with an auditable marker.
 */
export function forbiddenUrlIn(line) {
  const trimmed = line.trim();
  if (trimmed.startsWith("#") || trimmed.startsWith("//")) return null;
  if (/safety:allow-local/.test(line)) return null;
  const m = line.match(FORBIDDEN_URL);
  return m ? m[0] : null;
}

/**
 * Does a line commit a real secret? True only when a secret-named field is
 * assigned a real-looking (non-placeholder) 64-hex value — high precision to
 * avoid flagging the many legitimate 32-byte hashes (claim/proof hashes) that
 * are not keys.
 */
export function committedSecretIn(line) {
  if (!SECRET_FIELD.test(line)) return null;
  const idx = line.search(SECRET_FIELD);
  const afterField = line.slice(idx).replace(SECRET_FIELD, "");
  // Require an assignment (= or :) between the field name and the value.
  if (!/[:=]/.test(afterField)) return null;
  const m = afterField.match(HEX64);
  if (!m) return null;
  if (PLACEHOLDER.test(m[0])) return null;
  return m[0];
}

/** Files excluded from scanning: samples, examples, tests, lockfiles, this scanner. */
export function isExcludedPath(path) {
  return (
    /\.sample\b|\.example\b|(^|\/)examples?\//i.test(path) ||
    /(^|\/)(test|tests|__tests__|fixtures?|__fixtures__)\//i.test(path) ||
    /\.(test|spec)\.[cm]?[jt]sx?$/i.test(path) ||
    /(^|\/)scan-production-safety\.(mjs|test\.mjs)$/.test(path) ||
    /(^|\/)(pnpm-lock\.yaml|Cargo\.lock|package-lock\.json)$/.test(path)
  );
}

/** A git-tracked file is production deployment config if it configures the live edge. */
export function isProductionConfig(path) {
  return (
    /(^|\/)wrangler\.toml$/.test(path) ||
    /(^|\/)\.env\.production$/.test(path) ||
    /(^|\/)worker\.js$/.test(path)
  );
}

// --- scan driver ------------------------------------------------------------

function trackedFiles(root) {
  return execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8" })
    .split("\0")
    .filter(Boolean);
}

export function scanFiles(root, files, read = (p) => readFileSync(`${root}/${p}`, "utf8")) {
  const findings = [];
  for (const file of files) {
    if (isExcludedPath(file)) continue;
    const prodConfig = isProductionConfig(file);
    let body;
    try {
      body = read(file);
    } catch {
      continue; // deleted-but-tracked / unreadable → nothing to scan
    }
    const lines = body.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (prodConfig) {
        const url = forbiddenUrlIn(line);
        if (url) findings.push({ file, line: i + 1, kind: "local-url", detail: url });
      }
      const secret = committedSecretIn(line);
      if (secret) findings.push({ file, line: i + 1, kind: "committed-secret", detail: "<redacted 64-hex on secret field>" });
    }
  }
  return findings;
}

function main() {
  const root = new URL("../..", import.meta.url).pathname.replace(/\/$/, "");
  const findings = scanFiles(root, trackedFiles(root));
  if (findings.length === 0) {
    process.stdout.write("[prod-safety] no localhost/private edge URLs or committed secrets in tracked production surface\n");
    process.exit(0);
  }
  for (const f of findings) {
    console.error(`[prod-safety] ${f.kind} ${f.file}:${f.line} — ${f.detail}`);
  }
  console.error(`[prod-safety] FAIL: ${findings.length} production-safety violation(s); go-live is fail-closed`);
  process.exit(1);
}

// Run only as a script, not when imported by the test.
if (import.meta.url === `file://${process.argv[1]}`) main();
