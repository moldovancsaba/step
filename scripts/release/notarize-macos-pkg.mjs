#!/usr/bin/env node
/**
 * Notarize and staple a STEP Trust Center macOS installer package.
 *
 * Required env:
 *   APPLE_TEAM_ID
 *   APPLE_ASC_KEY_ID
 *   APPLE_ASC_ISSUER_ID
 *
 * The App Store Connect private key must exist at one of:
 *   ~/.appstoreconnect/private_keys/AuthKey_<APPLE_ASC_KEY_ID>.p8
 *   ~/.private_keys/AuthKey_<APPLE_ASC_KEY_ID>.p8
 *
 * Usage:
 *   node scripts/release/notarize-macos-pkg.mjs --pkg .runtime/dist/STEP-TrustCenter-1.0.0-darwin-arm64.pkg
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { basename } from "node:path";

const die = (m) => {
  console.error(`[notarize-pkg] ${m}`);
  process.exit(1);
};
const log = (m) => process.stdout.write(`[notarize-pkg] ${m}\n`);

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) {
      const key = argv[i].slice(2);
      out[key] = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[(i += 1)] : "true";
    }
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const pkg = args.pkg;
if (!pkg) die("--pkg path is required");
if (!existsSync(pkg)) die(`package not found: ${pkg}`);

const teamId = process.env.APPLE_TEAM_ID;
const keyId = process.env.APPLE_ASC_KEY_ID;
const issuer = process.env.APPLE_ASC_ISSUER_ID;
if (!teamId || !keyId || !issuer) die("APPLE_TEAM_ID, APPLE_ASC_KEY_ID, and APPLE_ASC_ISSUER_ID are required");

const home = process.env.HOME ?? "";
const privateKey = [
  `${home}/.appstoreconnect/private_keys/AuthKey_${keyId}.p8`,
  `${home}/.private_keys/AuthKey_${keyId}.p8`,
].find((p) => existsSync(p));
if (!privateKey) die(`App Store Connect private key not found for ${keyId}`);

log(`submitting ${basename(pkg)} to Apple notarization`);
execFileSync("xcrun", [
  "notarytool",
  "submit",
  pkg,
  "--key",
  privateKey,
  "--key-id",
  keyId,
  "--issuer",
  issuer,
  "--team-id",
  teamId,
  "--wait",
], { stdio: "inherit" });

log("stapling notarization ticket");
execFileSync("xcrun", ["stapler", "staple", pkg], { stdio: "inherit" });

log("validating stapled package");
execFileSync("spctl", ["--assess", "--type", "install", "--verbose", pkg], { stdio: "inherit" });
log("notarized package is ready");
