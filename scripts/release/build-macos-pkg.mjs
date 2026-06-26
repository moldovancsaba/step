#!/usr/bin/env node
/**
 * Build the official STEP Trust Center macOS installer (.pkg).
 *
 * The package installs only public bootstrap tooling:
 *   /usr/local/bin/step-node-agent
 *   /usr/local/bin/step-trustcenter
 *
 * It does NOT generate identity or store secrets during package installation.
 * The user-session command `step-trustcenter provision` performs Keychain-backed
 * local identity creation and installs a user LaunchAgent.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync, copyFileSync, rmSync, chmodSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const argv = process.argv.slice(2);
const flag = (name, fallback = "") => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : fallback;
};
const has = (name) => argv.includes(`--${name}`);
const die = (msg) => { console.error(`[pkg] ${msg}`); process.exit(1); };

const version = flag("version", "1.0.0");
const platform = flag("platform", "darwin-arm64");
const rpc = flag("rpc", process.env.STEP_TRUSTCENTER_RPC ?? "http://192.168.100.64:8645");
const registry = flag("registry", process.env.RELEASE_REGISTRY ?? "0x6e7B8A754A8a9111F211bC8C8f619E462f8DdF5F");
const artifacts = flag("artifacts", process.env.STEP_TRUSTCENTER_ARTIFACTS ?? "http://192.168.100.64:8078");
const fleet = flag("fleet", process.env.STEP_TRUSTCENTER_FLEET ?? "http://192.168.100.64:8099");
const verifier = flag("verifier", process.env.VERIFIER_CONTRACT_ADDRESS ?? "");
const chainId = flag("chain-id", process.env.STEP_CHAIN_ID ?? "262144");
const bootstrapPeers = flag("bootstrap-peers", process.env.STEP_TRUSTCENTER_BOOTSTRAP_PEERS ?? "");
const relayPeers = flag("relay-peers", process.env.STEP_TRUSTCENTER_RELAY_PEERS ?? "");
const advertisePeers = flag("advertise-peers", process.env.STEP_TRUSTCENTER_ADVERTISE_PEERS ?? "");
const survivalTier = flag("survival-tier", process.env.STEP_TRUSTCENTER_SURVIVAL_TIER ?? "edge");
const agentBin = flag("bin", join(ROOT, "target/release/step-node-agent"));
const identifier = flag("identifier", "com.regiominer.step.trustcenter");

if (!/^0x[0-9a-fA-F]{40}$/.test(registry)) die("--registry must be a 0x-prefixed address");
if (!/^https?:\/\//.test(rpc)) die("--rpc must be an HTTP(S) URL");
if (!/^https?:\/\//.test(artifacts)) die("--artifacts must be an HTTP(S) URL");
if (fleet && !/^https?:\/\//.test(fleet)) die("--fleet must be empty or an HTTP(S) URL");
if (verifier && !/^0x[0-9a-fA-F]{40}$/.test(verifier)) die("--verifier must be empty or a 0x-prefixed address");
if (!["edge", "full"].includes(survivalTier)) die("--survival-tier must be edge or full");
if (!existsSync(agentBin)) die(`agent binary not found at ${agentBin}; build with: cargo build -p step-node-agent --release`);
const peerList = (raw, name) => raw.split(",").map((s) => s.trim()).filter(Boolean).map((peer) => {
  if (!peer.startsWith("/")) die(`--${name} entries must be libp2p multiaddrs`);
  return peer;
});
const bootstrapPeerList = peerList(bootstrapPeers, "bootstrap-peers");
const relayPeerList = peerList(relayPeers, "relay-peers");
const advertisePeerList = peerList(advertisePeers, "advertise-peers");

const cast = existsSync(join(process.env.HOME ?? "", ".foundry/bin/cast")) ? join(process.env.HOME, ".foundry/bin/cast") : "cast";
const platformId = flag("platform-id", execFileSync(cast, ["keccak", platform], { encoding: "utf8" }).trim());
if (!/^0x[0-9a-fA-F]{64}$/.test(platformId)) die("platform id must be 0x + 32 bytes");

const build = join(ROOT, ".runtime/pkgbuild");
const payloadBin = join(build, "payload/usr/local/bin");
const scripts = join(build, "scripts");
const dist = join(ROOT, ".runtime/dist");
rmSync(build, { recursive: true, force: true });
mkdirSync(payloadBin, { recursive: true });
mkdirSync(scripts, { recursive: true });
mkdirSync(dist, { recursive: true });

copyFileSync(agentBin, join(payloadBin, "step-node-agent"));
chmodSync(join(payloadBin, "step-node-agent"), 0o755);

const wrapper = `#!/bin/sh
set -eu

BIN="/usr/local/bin/step-node-agent"
ROOT="\${STEP_AGENT_ROOT:-$HOME/.step/agent}"
LABEL="app.step.node-agent"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG_DIR="$ROOT/logs"
NODE_ENV="$ROOT/node.env"
MANIFEST="$ROOT/trust-center.manifest.json"
RPC="${rpc}"
REGISTRY="${registry}"
PLATFORM="${platform}"
PLATFORM_ID="${platformId}"
ARTIFACTS="${artifacts}"
FLEET="${fleet}"
VERIFIER="${verifier}"
CHAIN_ID="${chainId}"
BOOTSTRAP_PEERS="${bootstrapPeers}"
RELAY_PEERS="${relayPeers}"
ADVERTISE_PEERS="${advertisePeers}"
SURVIVAL_TIER="${survivalTier}"
SURVIVAL_FULL=false
if [ "$SURVIVAL_TIER" = "full" ]; then
  SURVIVAL_FULL=true
fi
TRANSPORT="http"
if [ -n "$BOOTSTRAP_PEERS$RELAY_PEERS$ADVERTISE_PEERS" ]; then
  TRANSPORT="peer"
fi
VALIDATOR_PORT="\${STEP_VALIDATOR_PORT:-9101}"
AGENT_PORT="\${STEP_AGENT_PORT:-9200}"
SERVICE="app.step.node"

usage() {
  cat <<USAGE
usage: step-trustcenter <command>

commands:
  provision [--nonce-secret VALUE]   generate/reuse node identity, store secrets, start service
  start                              start LaunchAgent
  stop                               stop LaunchAgent
  restart                            restart LaunchAgent
  status [--json]                    print node/runtime status
  doctor [--json]                    run operational checks
  logs [--tail N]                    show recent logs
  uninstall [--yes] [--delete-keychain] remove service/runtime files
USAGE
}

json_escape() { printf '%s' "$1" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))'; }
now_iso() { date -u '+%Y-%m-%dT%H:%M:%SZ'; }
node_address() { [ -f "$ROOT/node-address.txt" ] && cat "$ROOT/node-address.txt" || true; }
launch_domain() { printf 'gui/%s/%s' "$(id -u)" "$LABEL"; }
redact() { sed -E 's/(privateKey|validatorKey|nonceSecret|GATEWAY_NONCE_SECRET|STEP_TRUSTCENTER_NONCE_SECRET)[^[:space:]]*/\\1=<redacted>/g'; }

write_env() {
  addr="$1"
  mkdir -p "$ROOT" "$LOG_DIR"
  cat > "$NODE_ENV" <<ENV
AGENT_ROOT=$ROOT
STEP_RPC_URLS=$RPC
RELEASE_REGISTRY=$REGISTRY
NODE_ADDRESS=$addr
PLATFORM=$PLATFORM
PLATFORM_ID=$PLATFORM_ID
ARTIFACT_BASE_URLS=$ARTIFACTS
FLEET_URL=$FLEET
STEP_CHAIN_ID=$CHAIN_ID
VERIFIER_CONTRACT_ADDRESS=$VERIFIER
VALIDATOR_PORT=$VALIDATOR_PORT
AGENT_PORT=$AGENT_PORT
SECRET_BACKEND=keychain
SECRET_SERVICE=$SERVICE
AGENT_POLL_INTERVAL=30
AGENT_INTEGRITY_INTERVAL=120
AGENT_WATCH_ATTEMPTS=20
GOSSIP_BOOTSTRAP=$BOOTSTRAP_PEERS
GOSSIP_RELAYS=$RELAY_PEERS
GOSSIP_ADVERTISE=$ADVERTISE_PEERS
ENV
}

write_manifest() {
  addr="$1"
  cat > "$MANIFEST" <<JSON
{
  "schema_version": "step.trust-center.manifest.v1",
  "node": {
    "name": "$(hostname -s | tr '[:upper:]' '[:lower:]' | tr -cd 'a-z0-9-' | cut -c1-63)",
    "address": "$addr",
    "transport": "$TRANSPORT",
    "platform": "$PLATFORM",
    "location": "local",
    "identity_backend": "keychain"
  },
  "roles": ["agent", "validator", "gossip"],
  "services": {
    "agent": {
      "enabled": true,
      "bind": "127.0.0.1:$AGENT_PORT",
      "healthz": "http://127.0.0.1:$AGENT_PORT/healthz"
    },
    "validator": {
      "enabled": true,
      "bind": "127.0.0.1:$VALIDATOR_PORT",
      "healthz": "http://127.0.0.1:$VALIDATOR_PORT/healthz"
    },
    "gossip": {
      "enabled": true,
      "bind": "0.0.0.0:4001"
    }
  },
  "peer": {
    "bootstrap_peers": ${JSON.stringify(bootstrapPeerList)},
    "relay_peers": ${JSON.stringify(relayPeerList)},
    "advertise": ${JSON.stringify(advertisePeerList)}
  },
  "chain": {
    "chain_id": "$CHAIN_ID",
    "rpc_urls": ["$RPC"],
    "release_registry": "$REGISTRY",
    "validator_registry": "${verifier || "0x0000000000000000000000000000000000000000"}"
  },
  "update": {
    "platform_id": "$PLATFORM_ID",
    "artifact_base_urls": ["$ARTIFACTS"],
    "poll_interval_s": 30,
    "integrity_interval_s": 120
  },
  "recovery": {
    "supervisor": "launchd",
    "restart": {
      "enabled": true,
      "max_attempts": 20
    },
    "rollback": {
      "enabled": true,
      "last_good_required": true
    },
    "disaster_survival": {
      "tier": "$SURVIVAL_TIER",
      "requires_independent_gateway": $SURVIVAL_FULL,
      "requires_independent_fleet": $SURVIVAL_FULL,
      "requires_independent_chain_rpc": $SURVIVAL_FULL,
      "requires_independent_validator": true,
      "requires_independent_gossip": true
    }
  },
  "observability": {
    "healthz": "http://127.0.0.1:$AGENT_PORT/healthz",
    "logs": [
      "$LOG_DIR/node-agent.out.log",
      "$LOG_DIR/node-agent.err.log"
    ],
    "fleet_heartbeat": true
  }
}
JSON
}

write_plist() {
  mkdir -p "$HOME/Library/LaunchAgents" "$LOG_DIR"
  cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key><array><string>$ROOT/run-agent.sh</string></array>
  <key>WorkingDirectory</key><string>$ROOT</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$LOG_DIR/node-agent.out.log</string>
  <key>StandardErrorPath</key><string>$LOG_DIR/node-agent.err.log</string>
</dict></plist>
PLIST
  cat > "$ROOT/run-agent.sh" <<RUN
#!/bin/sh
set -eu
set -a
. "$NODE_ENV"
set +a
exec "$BIN"
RUN
  chmod +x "$ROOT/run-agent.sh"
}

store_nonce() {
  addr="$1"
  nonce="$2"
  if [ -n "$nonce" ]; then
    security add-generic-password -U -s "$SERVICE" -a "step.node.$addr.nonceSecret" -w "$nonce" >/dev/null
  fi
}

pairing_payload() {
  addr="$1"
  challenge="$2"
  created="$(now_iso)"
  cat <<JSON
{"type":"step.trustcenter.pair","version":1,"nodeAddress":"$addr","platform":"$PLATFORM","agentVersion":"${version}","registry":"$REGISTRY","chainId":"$CHAIN_ID","challenge":"$challenge","createdAt":"$created"}
JSON
}

cmd_provision() {
  nonce="\${STEP_TRUSTCENTER_NONCE_SECRET:-}"
  while [ $# -gt 0 ]; do
    case "$1" in
      --nonce-secret) nonce="$2"; shift 2 ;;
      --json) json=1; shift ;;
      *) echo "unknown provision arg: $1" >&2; exit 2 ;;
    esac
  done
  json="\${json:-0}"
  mkdir -p "$ROOT" "$LOG_DIR"
  existing="$(node_address)"
  if [ -n "$existing" ]; then
    addr="$existing"
  else
    out="$(SECRET_BACKEND=keychain SECRET_SERVICE="$SERVICE" GATEWAY_NONCE_SECRET="$nonce" "$BIN" --init)"
    addr="$(printf '%s' "$out" | sed -n 's/^NODE_ADDRESS=//p')"
    [ -n "$addr" ] || { echo "provision failed: node-agent did not return NODE_ADDRESS" >&2; exit 1; }
    echo "$addr" > "$ROOT/node-address.txt"
  fi
  store_nonce "$addr" "$nonce"
  write_env "$addr"
  write_manifest "$addr"
  write_plist
  launchctl bootout "gui/$(id -u)" "$PLIST" >/dev/null 2>&1 || true
  launchctl bootstrap "gui/$(id -u)" "$PLIST"
  launchctl kickstart -k "$(launch_domain)" >/dev/null 2>&1 || true
  challenge="$(openssl rand -hex 32 2>/dev/null || python3 -c 'import secrets; print(secrets.token_hex(32))')"
  payload="$(pairing_payload "$addr" "$challenge")"
  if [ "$json" = "1" ]; then
    printf '{"nodeAddress":%s,"manifest":%s,"pairingPayload":%s,"agentStatusUrl":"http://127.0.0.1:%s/v1/agent/status"}\n' "$(json_escape "$addr")" "$(json_escape "$MANIFEST")" "$payload" "$AGENT_PORT"
  else
    echo "STEP Trust Center provisioned."
    echo "Node address: $addr"
    echo "Manifest: $MANIFEST"
    echo "Pair this Trust Center with your STEP wallet using this payload:"
    echo "$payload"
    if [ -z "$nonce" ]; then
      echo "Warning: no nonce secret was provided. Validator child may remain down until public node credentials replace the pilot nonce flow." >&2
    fi
  fi
}

cmd_start() { launchctl bootstrap "gui/$(id -u)" "$PLIST" 2>/dev/null || launchctl kickstart -k "$(launch_domain)"; }
cmd_stop() { launchctl bootout "gui/$(id -u)" "$PLIST" 2>/dev/null || true; }
cmd_restart() { cmd_stop; cmd_start; }

status_json() {
  addr="$(node_address)"
  launch="not_loaded"
  launchctl print "$(launch_domain)" >/dev/null 2>&1 && launch="loaded"
  agent="down"; agent_body="null"
  if body="$(curl -fsS -m 2 "http://127.0.0.1:$AGENT_PORT/v1/agent/status" 2>/dev/null)"; then agent="up"; agent_body="$body"; fi
  validator="down"
  curl -fsS -m 2 "http://127.0.0.1:$VALIDATOR_PORT/healthz" >/dev/null 2>&1 && validator="up"
  printf '{"nodeAddress":%s,"launchAgent":%s,"agentHealth":%s,"validatorHealth":%s,"agentStatus":%s}\n' \
    "$(json_escape "$addr")" "$(json_escape "$launch")" "$(json_escape "$agent")" "$(json_escape "$validator")" "$agent_body"
}
cmd_status() {
  if [ "\${1:-}" = "--json" ]; then status_json; return; fi
  status_json | python3 -m json.tool
}

check_line() { printf '%s\t%s\t%s\n' "$1" "$2" "$3"; }
cmd_doctor() {
  json=0; [ "\${1:-}" = "--json" ] && json=1
  checks=""
  add() { checks="$checks$1|$2|$3\n"; }
  add macos.version pass "$(sw_vers -productVersion 2>/dev/null || echo unknown)"
  case "$(uname -m)" in arm64|x86_64) add arch.supported pass "$(uname -m)";; *) add arch.supported fail "$(uname -m)";; esac
  addr="$(node_address)"; [ -n "$addr" ] && add identity.node pass "$addr" || add identity.node fail "not provisioned"
  [ -f "$MANIFEST" ] && add manifest.present pass "$MANIFEST" || add manifest.present fail "missing Trust Center manifest"
  launchctl print "$(launch_domain)" >/dev/null 2>&1 && add launchd.loaded pass "$LABEL" || add launchd.loaded fail "not loaded"
  curl -fsS -m 2 "http://127.0.0.1:$AGENT_PORT/healthz" >/dev/null 2>&1 && add agent.health pass ":$AGENT_PORT" || add agent.health fail ":$AGENT_PORT down"
  curl -fsS -m 2 "http://127.0.0.1:$VALIDATOR_PORT/healthz" >/dev/null 2>&1 && add validator.health pass ":$VALIDATOR_PORT" || add validator.health fail ":$VALIDATOR_PORT down"
  curl -fsS -m 3 "$ARTIFACTS/healthz" >/dev/null 2>&1 && add network.artifacts pass "$ARTIFACTS" || add network.artifacts warn "$ARTIFACTS unreachable"
  if [ "$json" = "1" ]; then
    printf '%b' "$checks" | awk -F'|' 'BEGIN{printf "["} NF>=3{printf "%s{\"id\":\"%s\",\"level\":\"%s\",\"message\":\"%s\"}",sep,$1,$2,$3; sep=","} END{print "]"}'
  else
    printf '%b' "$checks" | while IFS='|' read -r id level msg; do [ -n "$id" ] && check_line "$level" "$id" "$msg"; done
  fi
}

cmd_logs() {
  tailn=120
  if [ "\${1:-}" = "--tail" ]; then tailn="$2"; fi
  for f in "$LOG_DIR/node-agent.out.log" "$LOG_DIR/node-agent.err.log"; do
    [ -f "$f" ] || continue
    echo "==> $f <=="
    tail -n "$tailn" "$f" | redact
  done
}

cmd_uninstall() {
  yes=0; delete_keychain=0
  while [ $# -gt 0 ]; do case "$1" in --yes) yes=1;; --delete-keychain) delete_keychain=1;; *) echo "unknown uninstall arg: $1" >&2; exit 2;; esac; shift; done
  if [ "$yes" != "1" ]; then echo "refusing destructive uninstall without --yes" >&2; exit 2; fi
  addr="$(node_address)"
  cmd_stop
  rm -f "$PLIST"
  rm -rf "$ROOT/releases" "$ROOT/current" "$ROOT/state.json" "$ROOT/run-agent.sh" "$NODE_ENV"
  if [ "$delete_keychain" = "1" ] && [ -n "$addr" ]; then
    security delete-generic-password -s "$SERVICE" -a "step.node.$addr.validatorKey" >/dev/null 2>&1 || true
    security delete-generic-password -s "$SERVICE" -a "step.node.$addr.nonceSecret" >/dev/null 2>&1 || true
    rm -f "$ROOT/node-address.txt"
  fi
  echo "STEP Trust Center uninstalled. Keychain identity preserved unless --delete-keychain was supplied."
}

case "\${1:-}" in
  provision) shift; cmd_provision "$@" ;;
  start) cmd_start ;;
  stop) cmd_stop ;;
  restart) cmd_restart ;;
  status) shift; cmd_status "$@" ;;
  doctor) shift; cmd_doctor "$@" ;;
  logs) shift; cmd_logs "$@" ;;
  uninstall) shift; cmd_uninstall "$@" ;;
  -h|--help|help|"") usage ;;
  *) echo "unknown command: $1" >&2; usage; exit 2 ;;
esac
`;
writeFileSync(join(payloadBin, "step-trustcenter"), wrapper, { mode: 0o755 });

const forbidden = /(STEP_ADMIN_KEY|RELEASE_SIGNER_KEY|DEPLOYER_PRIVATE_KEY|VALIDATOR_PRIVATE_KEY|PRIVATE_KEY=|cfat_|secret access key)/i;
for (const [name, content] of [["step-trustcenter", wrapper]]) {
  if (forbidden.test(content)) die(`secret-like token found in payload script ${name}`);
}

try { execFileSync("xattr", ["-cr", join(build, "payload")]); } catch {}
writeFileSync(join(scripts, "postinstall"), `#!/bin/sh
echo "STEP Trust Center installed."
echo "Next step: step-trustcenter provision"
echo "For pilot validator operation with the existing nonce flow: STEP_TRUSTCENTER_NONCE_SECRET=<secret> step-trustcenter provision"
exit 0
`, { mode: 0o755 });
chmodSync(join(scripts, "postinstall"), 0o755);

const component = join(dist, `step-trustcenter-component-${version}-${platform}.pkg`);
const out = join(dist, `STEP-TrustCenter-${version}-${platform}.pkg`);
execFileSync("pkgbuild", ["--root", join(build, "payload"), "--scripts", scripts, "--identifier", identifier, "--version", version, "--install-location", "/", component], { stdio: "inherit" });
execFileSync("productbuild", ["--package", component, out], { stdio: "inherit" });
rmSync(component, { force: true });
const sha = execFileSync("shasum", ["-a", "256", out], { encoding: "utf8" }).trim().split(/\s+/)[0];
writeFileSync(`${out}.sha256`, `${sha}  ${out.split("/").pop()}\n`);

if (has("sign") || has("notarize")) {
  console.log("[pkg] signing/notarization requested but not executed by this builder yet; use the release signing issue pipeline.");
}
console.log(`\n✓ ${out}`);
console.log(`  sha256: ${sha}`);
console.log(`  install: sudo installer -pkg "${out}" -target /`);
console.log("  provision: step-trustcenter provision");
