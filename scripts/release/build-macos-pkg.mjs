#!/usr/bin/env node
/**
 * build-macos-pkg — package the STEP trust center (step-node-agent) as a native,
 * double-clickable macOS installer (.pkg) so it can be delivered to chappie and
 * any other Mac without a repo, Homebrew, or a curl|sh one-liner.
 *
 * The .pkg drops two files in /usr/local/bin and bakes the hub's PUBLIC chain
 * wiring (RPC, ReleaseRegistry, platform-id — none secret) into a control
 * wrapper. Identity stays KEYLESS: the node generates its own secp256k1 key on
 * `step-trustcenter provision` (the agent's --init), so nothing secret travels in
 * the installer. Trust is still an explicit on-chain grant: provision prints the
 * node address; an operator runs `scripts/node/register.mjs <addr>` on the hub.
 *
 *   node scripts/release/build-macos-pkg.mjs \
 *     --version 1.0.0 \
 *     --rpc http://192.168.100.64:8645 \
 *     --registry 0x6e7B8A754A8a9111F211bC8C8f619E462f8DdF5F
 *
 * Output: .runtime/dist/STEP-TrustCenter-<version>.pkg  (unsigned).
 * For friction-free distribution, sign + notarize with a Developer ID (owner):
 *   productsign --sign "Developer ID Installer: <name>" in.pkg out.pkg
 *   xcrun notarytool submit out.pkg --apple-id … --team-id … --wait
 * Unsigned installs fine on a trusted Mac:  sudo installer -pkg <file> -target /
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, copyFileSync, rmSync, chmodSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const a = process.argv.slice(2);
const flag = (n, d) => { const i = a.indexOf(`--${n}`); return i >= 0 ? a[i + 1] : d; };
const die = (m) => { console.error(`[pkg] ${m}`); process.exit(1); };

const version = flag("version", "1.0.0");
const rpc = flag("rpc", "http://192.168.100.64:8645");
const registry = flag("registry", "0x6e7B8A754A8a9111F211bC8C8f619E462f8DdF5F");
const platform = flag("platform", "darwin-arm64");
const identifier = "com.regiominer.step.trustcenter";
const agentBin = flag("bin", join(ROOT, "target/release/step-node-agent"));

if (!/^0x[0-9a-fA-F]{40}$/.test(registry)) die("--registry must be a 0x… address");
if (!/^https?:\/\//.test(rpc)) die("--rpc must be an http(s) URL");

// platform-id = keccak256(platform) — the on-chain ReleaseRegistry key (matches
// `cast keccak <platform>`). Computed here so the wrapper carries the exact id.
const platformId = execFileSync(
  join(process.env.HOME, ".foundry/bin/cast"),
  ["keccak", platform],
  { encoding: "utf8" },
).trim();

// ─── stage payload ───────────────────────────────────────────────────────────
const build = join(ROOT, ".runtime/pkgbuild");
rmSync(build, { recursive: true, force: true });
const payloadBin = join(build, "payload/usr/local/bin");
const scripts = join(build, "scripts");
mkdirSync(payloadBin, { recursive: true });
mkdirSync(scripts, { recursive: true });

try { copyFileSync(agentBin, join(payloadBin, "step-node-agent")); }
catch { die(`agent binary not found at ${agentBin} — build it: cargo build --release -p step-node-agent`); }
chmodSync(join(payloadBin, "step-node-agent"), 0o755);

// The control wrapper. Baked PUBLIC config; identity generated on `provision`.
const wrapper = `#!/bin/sh
# STEP trust center control — installed by STEP-TrustCenter-${version}.pkg
set -eu
BIN=/usr/local/bin/step-node-agent
ROOT="\${STEP_AGENT_ROOT:-$HOME/.step/agent}"
LABEL=app.step.node-agent
PLIST=/Library/LaunchDaemons/$LABEL.plist
RPC="${rpc}"
REGISTRY="${registry}"
PLATFORM="${platform}"
PLATFORM_ID="${platformId}"

case "\${1:-}" in
provision)
  mkdir -p "$ROOT/logs"
  # Keyless: generate this node's own identity (stored in the login keychain),
  # print NODE_ADDRESS. Nothing secret travels in the installer.
  ADDR=$("$BIN" --init | sed -n 's/^NODE_ADDRESS=//p')
  [ -n "$ADDR" ] || { echo "provision: agent --init did not return an address" >&2; exit 1; }
  echo "$ADDR" > "$ROOT/node-address.txt"
  sudo tee "$PLIST" >/dev/null <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key><array><string>$BIN</string></array>
  <key>EnvironmentVariables</key><dict>
    <key>AGENT_ROOT</key><string>$ROOT</string>
    <key>STEP_RPC_URL</key><string>$RPC</string>
    <key>RELEASE_REGISTRY</key><string>$REGISTRY</string>
    <key>NODE_ADDRESS</key><string>$ADDR</string>
    <key>PLATFORM</key><string>$PLATFORM</string>
    <key>PLATFORM_ID</key><string>$PLATFORM_ID</string>
  </dict>
  <key>UserName</key><string>$(id -un)</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
  <key>StandardOutPath</key><string>$ROOT/logs/node-agent.out.log</string>
  <key>StandardErrorPath</key><string>$ROOT/logs/node-agent.err.log</string>
</dict></plist>
PLIST
  sudo launchctl bootout system "$PLIST" 2>/dev/null || true
  sudo launchctl bootstrap system "$PLIST"
  echo ""
  echo "✓ trust center provisioned. NODE_ADDRESS=$ADDR"
  echo "  Grant it quorum weight ON THE HUB (explicit trust):"
  echo "    node scripts/node/register.mjs $ADDR --type Mobile"
  ;;
start)  sudo launchctl bootstrap system "$PLIST" 2>/dev/null || sudo launchctl kickstart -k system/$LABEL ;;
stop)   sudo launchctl bootout system "$PLIST" 2>/dev/null || true ;;
status) launchctl print system/$LABEL 2>/dev/null | sed -n '1,12p' || echo "not loaded" ;;
*) echo "usage: step-trustcenter {provision|start|stop|status}" >&2; exit 2 ;;
esac
`;
writeFileSync(join(payloadBin, "step-trustcenter"), wrapper, { mode: 0o755 });

// Strip extended attributes so pkgbuild doesn't emit AppleDouble `._` cruft.
execFileSync("xattr", ["-cr", join(build, "payload")]);

// postinstall: just announce the one provisioning step (keeps install reliable —
// no keychain access during the pkg run, which has no GUI session).
writeFileSync(join(scripts, "postinstall"), `#!/bin/sh
echo "STEP trust center installed. Provision it (generates identity, starts service):"
echo "    step-trustcenter provision"
exit 0
`, { mode: 0o755 });

// ─── build the pkg (native tools, no deps) ───────────────────────────────────
const dist = join(ROOT, ".runtime/dist");
mkdirSync(dist, { recursive: true });
const component = join(dist, `step-trustcenter-component-${version}.pkg`);
const out = join(dist, `STEP-TrustCenter-${version}.pkg`);

execFileSync("pkgbuild", [
  "--root", join(build, "payload"),
  "--scripts", scripts,
  "--identifier", identifier,
  "--version", version,
  "--install-location", "/",
  component,
], { stdio: "inherit" });

execFileSync("productbuild", ["--package", component, out], { stdio: "inherit" });
rmSync(component, { force: true });

console.log(`\n✓ ${out}`);
console.log("  install on a trusted Mac:  sudo installer -pkg \"" + out + "\" -target /");
console.log("  then on that Mac:          step-trustcenter provision");
console.log("  distribute widely:         productsign + notarytool (Developer ID; see header).");
