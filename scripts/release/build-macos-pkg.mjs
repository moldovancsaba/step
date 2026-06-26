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
import { existsSync, mkdirSync, writeFileSync, copyFileSync, cpSync, rmSync, chmodSync, readFileSync } from "node:fs";
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
let verifier = flag("verifier", process.env.VERIFIER_CONTRACT_ADDRESS ?? "");
const chainId = flag("chain-id", process.env.STEP_CHAIN_ID ?? "262144");
const bootstrapPeers = flag("bootstrap-peers", process.env.STEP_TRUSTCENTER_BOOTSTRAP_PEERS ?? "");
const relayPeers = flag("relay-peers", process.env.STEP_TRUSTCENTER_RELAY_PEERS ?? "");
const advertisePeers = flag("advertise-peers", process.env.STEP_TRUSTCENTER_ADVERTISE_PEERS ?? "");
const survivalTier = flag("survival-tier", process.env.STEP_TRUSTCENTER_SURVIVAL_TIER ?? "edge");
const fullstackDir = flag("fullstack-dir", process.env.STEP_TRUSTCENTER_FULLSTACK_DIR ?? "");
const agentBin = flag("bin", join(ROOT, "target/release/step-node-agent"));
const identifier = flag("identifier", "com.regiominer.step.trustcenter");

if (!/^0x[0-9a-fA-F]{40}$/.test(registry)) die("--registry must be a 0x-prefixed address");
if (!/^https?:\/\//.test(rpc)) die("--rpc must be an HTTP(S) URL");
if (!/^https?:\/\//.test(artifacts)) die("--artifacts must be an HTTP(S) URL");
if (fleet && !/^https?:\/\//.test(fleet)) die("--fleet must be empty or an HTTP(S) URL");
if (verifier && !/^0x[0-9a-fA-F]{40}$/.test(verifier)) die("--verifier must be empty or a 0x-prefixed address");
if (!["edge", "full"].includes(survivalTier)) die("--survival-tier must be edge or full");
if (!existsSync(agentBin)) die(`agent binary not found at ${agentBin}; build with: cargo build -p step-node-agent --release`);
if (survivalTier === "full") {
  if (!fullstackDir || !existsSync(fullstackDir)) die("--survival-tier full requires --fullstack-dir containing node, gateway, fleet, chain RPC, validator, and gossip launch payloads");
  for (const name of ["node", "gateway-api.mjs", "fleet-api.mjs", "chain-rpc.mjs", "validator-node", "gossip-node"]) {
    if (!existsSync(join(fullstackDir, name))) die(`fullstack payload missing ${name}`);
  }
  if (!verifier && existsSync(join(fullstackDir, "deployments.json"))) {
    const deployments = JSON.parse(readFileSync(join(fullstackDir, "deployments.json"), "utf8"));
    verifier = deployments.MiningClaimVerifier ?? "";
  }
}
const peerList = (raw, name) => raw.split(",").map((s) => s.trim()).filter(Boolean).map((peer) => {
  if (!peer.startsWith("/")) die(`--${name} entries must be libp2p multiaddrs`);
  return peer;
});
const bootstrapPeerList = peerList(bootstrapPeers, "bootstrap-peers");
const relayPeerList = peerList(relayPeers, "relay-peers");
const advertisePeerList = peerList(advertisePeers, "advertise-peers");
const runtimeRpcUrls = survivalTier === "full" ? `http://127.0.0.1:8645,${rpc}` : rpc;

const cast = existsSync(join(process.env.HOME ?? "", ".foundry/bin/cast")) ? join(process.env.HOME, ".foundry/bin/cast") : "cast";
const platformId = flag("platform-id", execFileSync(cast, ["keccak", platform], { encoding: "utf8" }).trim());
if (!/^0x[0-9a-fA-F]{64}$/.test(platformId)) die("platform id must be 0x + 32 bytes");

const build = join(ROOT, ".runtime/pkgbuild");
const payloadBin = join(build, "payload/usr/local/bin");
const payloadFullstack = join(build, "payload/usr/local/lib/step-trustcenter/fullstack");
const scripts = join(build, "scripts");
const resources = join(build, "resources");
const dist = join(ROOT, ".runtime/dist");
rmSync(build, { recursive: true, force: true });
mkdirSync(payloadBin, { recursive: true });
if (survivalTier === "full") {
  mkdirSync(payloadFullstack, { recursive: true });
  cpSync(fullstackDir, payloadFullstack, { recursive: true });
}
mkdirSync(scripts, { recursive: true });
mkdirSync(resources, { recursive: true });
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
FULLSTACK_DIR="/usr/local/lib/step-trustcenter/fullstack"
RPC="${rpc}"
RUNTIME_RPC_URLS="${runtimeRpcUrls}"
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
FULL_ROLES='["agent", "validator", "gossip", "chain", "gateway", "fleet"]'
EDGE_ROLES='["agent", "validator", "gossip"]'

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

append_validator_identity_env() {
  key="\${STEP_TRUSTCENTER_RELAYER_PRIVATE_KEY:-}"
  if [ -z "$key" ] && [ "\${SECRET_BACKEND:-keychain}" = "file" ]; then
    secret_file="\${SECRET_FILE:-$ROOT/secrets.json}"
    if [ -f "$secret_file" ]; then
      key="$(python3 - "$secret_file" <<'PY' 2>/dev/null || true
import json, sys
data = json.load(open(sys.argv[1]))
for name, value in data.items():
    if name.endswith(".validatorKey") or name == "validatorKey":
        print(value)
        break
PY
)"
    fi
  fi
  if [ -n "$key" ]; then
    printf 'RELAYER_%s=%s\n' "PRIVATE_KEY" "$key" >> "$NODE_ENV"
    printf 'VALIDATOR_%s=%s\n' "PRIVATE_KEY" "$key" >> "$NODE_ENV"
  fi
}

write_env() {
  addr="$1"
  mkdir -p "$ROOT" "$LOG_DIR"
  cat > "$NODE_ENV" <<ENV
AGENT_ROOT=$ROOT
STEP_RPC_URLS=$RUNTIME_RPC_URLS
RELEASE_REGISTRY=$REGISTRY
NODE_ADDRESS=$addr
PLATFORM=$PLATFORM
PLATFORM_ID=$PLATFORM_ID
ARTIFACT_BASE_URLS=http://127.0.0.1:$AGENT_PORT,$ARTIFACTS
FLEET_URL=$FLEET
STEP_CHAIN_ID=$CHAIN_ID
VALIDATOR_PORT=$VALIDATOR_PORT
AGENT_PORT=$AGENT_PORT
SECRET_BACKEND=\${SECRET_BACKEND:-keychain}
SECRET_SERVICE=$SERVICE
AGENT_POLL_INTERVAL=30
AGENT_INTEGRITY_INTERVAL=120
AGENT_WATCH_ATTEMPTS=20
GOSSIP_BOOTSTRAP=$BOOTSTRAP_PEERS
GOSSIP_RELAYS=$RELAY_PEERS
GOSSIP_ADVERTISE=$ADVERTISE_PEERS
ENV
  [ -n "$VERIFIER" ] && printf 'VERIFIER_CONTRACT_ADDRESS=%s\n' "$VERIFIER" >> "$NODE_ENV"
  append_validator_identity_env
}

manifest_roles() { if [ "$SURVIVAL_TIER" = "full" ]; then printf '%s' "$FULL_ROLES"; else printf '%s' "$EDGE_ROLES"; fi; }

fullstack_required() {
  [ "$SURVIVAL_TIER" != "full" ] && return 0
  for f in node gateway-api.mjs fleet-api.mjs chain-rpc.mjs validator-node gossip-node; do
    [ -e "$FULLSTACK_DIR/$f" ] || { echo "full Trust Center payload missing $FULLSTACK_DIR/$f" >&2; exit 1; }
  done
}

write_manifest() {
  addr="$1"
  roles="$(manifest_roles)"
  cat > "$MANIFEST" <<JSON
{
  "schema_version": "step.trust-center.manifest.v1",
  "node": {
    "name": "$(hostname -s | tr '[:upper:]' '[:lower:]' | tr -cd 'a-z0-9-' | cut -c1-63)",
    "address": "$addr",
    "transport": "$TRANSPORT",
    "platform": "$PLATFORM",
    "location": "local",
    "identity_backend": "\${SECRET_BACKEND:-keychain}"
  },
  "roles": $roles,
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
    },
    "chain_rpc": {
      "enabled": $SURVIVAL_FULL,
      "bind": "0.0.0.0:8645",
      "healthz": "http://127.0.0.1:8645"
    },
    "gateway": {
      "enabled": $SURVIVAL_FULL,
      "bind": "0.0.0.0:8080",
      "healthz": "http://127.0.0.1:8080/healthz"
    },
    "fleet": {
      "enabled": $SURVIVAL_FULL,
      "bind": "0.0.0.0:8099",
      "healthz": "http://127.0.0.1:8099/v1/fleet"
    }
  },
  "peer": {
    "bootstrap_peers": ${JSON.stringify(bootstrapPeerList)},
    "relay_peers": ${JSON.stringify(relayPeerList)},
    "advertise": ${JSON.stringify(advertisePeerList)}
  },
  "chain": {
    "chain_id": "$CHAIN_ID",
    "rpc_urls": ["$RUNTIME_RPC_URLS"],
    "release_registry": "$REGISTRY",
    "validator_registry": "${verifier || "0x0000000000000000000000000000000000000000"}"
  },
  "update": {
    "platform_id": "$PLATFORM_ID",
    "artifact_base_urls": ["http://127.0.0.1:$AGENT_PORT", "$ARTIFACTS"],
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

write_node_directory() {
  addr="$1"
  name="$(hostname -s 2>/dev/null | tr '[:upper:]' '[:lower:]' | tr -cd 'a-z0-9-' | cut -c1-63)"
  [ -n "$name" ] || name="step-node"
  cat > "$ROOT/nodes.json" <<JSON
{
  "nodes": [
    {
      "name": "$name",
      "address": "$addr",
      "url": "http://127.0.0.1:$VALIDATOR_PORT",
      "services": ["validator", "agent", "gateway", "fleet", "gossip", "chain-rpc", "artifacts"],
      "weight": 101,
      "type": "TrustCenter",
      "location": "local",
      "status": "active"
    }
  ]
}
JSON
}

write_full_service_plist() {
  label="$1"; script="$2"; out="$3"; err="$4"
  plist="$HOME/Library/LaunchAgents/$label.plist"
  cat > "$plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$label</string>
  <key>ProgramArguments</key><array><string>$script</string></array>
  <key>WorkingDirectory</key><string>$ROOT</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$out</string>
  <key>StandardErrorPath</key><string>$err</string>
</dict></plist>
PLIST
  launchctl bootout "gui/$(id -u)" "$plist" >/dev/null 2>&1 || true
  launchctl bootstrap "gui/$(id -u)" "$plist"
}

install_full_services() {
  [ "$SURVIVAL_TIER" != "full" ] && return 0
  fullstack_required
  [ -f "$FULLSTACK_DIR/deployments.json" ] && cp "$FULLSTACK_DIR/deployments.json" "$ROOT/deployments.json"
  [ -f "$FULLSTACK_DIR/protocol-params.json" ] && {
    mkdir -p "$ROOT/current"
    cp "$FULLSTACK_DIR/protocol-params.json" "$ROOT/current/protocol-params.json"
    cp "$FULLSTACK_DIR/protocol-params.json" "$ROOT/shared-params.json"
  }
  [ -f "$ROOT/nodes.json" ] || { [ -f "$FULLSTACK_DIR/nodes.json" ] && cp "$FULLSTACK_DIR/nodes.json" "$ROOT/nodes.json"; }
  cat > "$ROOT/run-chain-rpc.sh" <<RUN
#!/bin/sh
set -a; . "$NODE_ENV"; set +a
exec "$FULLSTACK_DIR/node" "$FULLSTACK_DIR/chain-rpc.mjs"
RUN
  cat > "$ROOT/run-gateway.sh" <<RUN
#!/bin/sh
set -a; . "$NODE_ENV"; set +a
export STEP_RPC_URL="\${STEP_RPC_URL:-http://127.0.0.1:8645}"
export STEP_CHAIN_ID="\${STEP_CHAIN_ID:-$CHAIN_ID}"
export STEP_DEPLOYMENTS_FILE="\${STEP_DEPLOYMENTS_FILE:-$ROOT/deployments.json}"
export STEP_PROTOCOL_PARAMS="\${STEP_PROTOCOL_PARAMS:-$ROOT/current/protocol-params.json}"
export NODE_DIRECTORY_FILE="\${NODE_DIRECTORY_FILE:-$ROOT/nodes.json}"
export MESH_API_URL="\${MESH_API_URL:-http://127.0.0.1:$VALIDATOR_PORT}"
export VALIDATOR_URLS="\${VALIDATOR_URLS:-http://127.0.0.1:$VALIDATOR_PORT}"
export GATEWAY_PORT="\${GATEWAY_PORT:-8080}"
exec "$FULLSTACK_DIR/node" "$FULLSTACK_DIR/gateway-api.mjs"
RUN
  cat > "$ROOT/run-fleet.sh" <<RUN
#!/bin/sh
set -a; . "$NODE_ENV"; set +a
export STEP_RPC_URL="\${STEP_RPC_URL:-http://127.0.0.1:8645}"
export STEP_CHAIN_ID="\${STEP_CHAIN_ID:-$CHAIN_ID}"
export STEP_DEPLOYMENTS_FILE="\${STEP_DEPLOYMENTS_FILE:-$ROOT/deployments.json}"
export NODE_DIRECTORY_FILE="\${NODE_DIRECTORY_FILE:-$ROOT/nodes.json}"
export STEP_QUORUM_THRESHOLD="\${STEP_QUORUM_THRESHOLD:-101}"
export FLEET_PORT="\${FLEET_PORT:-8099}"
exec "$FULLSTACK_DIR/node" "$FULLSTACK_DIR/fleet-api.mjs"
RUN
  cat > "$ROOT/run-gossip.sh" <<RUN
#!/bin/sh
set -a; . "$NODE_ENV"; set +a
export STEP_RPC_URLS="\${STEP_RPC_URLS:-http://127.0.0.1:8645,$RPC}"
export STEP_DEPLOYMENTS_FILE="\${STEP_DEPLOYMENTS_FILE:-$ROOT/deployments.json}"
export STEP_SUBMIT_URL="\${STEP_SUBMIT_URL:-http://127.0.0.1:8080/v1/gossip/finalise}"
export STEP_QUORUM_THRESHOLD="\${STEP_QUORUM_THRESHOLD:-101}"
export GOSSIP_LISTEN="\${GOSSIP_LISTEN:-/ip4/0.0.0.0/tcp/4001}"
exec "$FULLSTACK_DIR/gossip-node"
RUN
  cat > "$ROOT/run-validator.sh" <<RUN
#!/bin/sh
set -a; . "$NODE_ENV"; set +a
export VALIDATOR_PORT="\${VALIDATOR_PORT:-$VALIDATOR_PORT}"
export STEP_RPC_URL="\${STEP_RPC_URL:-http://127.0.0.1:8645}"
export STEP_CHAIN_ID="\${STEP_CHAIN_ID:-$CHAIN_ID}"
export STEP_DEPLOYMENTS_FILE="\${STEP_DEPLOYMENTS_FILE:-$ROOT/deployments.json}"
export STEP_PROTOCOL_PARAMS="\${STEP_PROTOCOL_PARAMS:-$ROOT/current/protocol-params.json}"
exec "$FULLSTACK_DIR/validator-node"
RUN
  chmod +x "$ROOT"/run-chain-rpc.sh "$ROOT"/run-gateway.sh "$ROOT"/run-fleet.sh "$ROOT"/run-gossip.sh "$ROOT"/run-validator.sh
  write_full_service_plist app.step.chain "$ROOT/run-chain-rpc.sh" "$LOG_DIR/chain.out.log" "$LOG_DIR/chain.err.log"
  write_full_service_plist app.step.gateway "$ROOT/run-gateway.sh" "$LOG_DIR/gateway.out.log" "$LOG_DIR/gateway.err.log"
  write_full_service_plist app.step.fleet "$ROOT/run-fleet.sh" "$LOG_DIR/fleet.out.log" "$LOG_DIR/fleet.err.log"
  write_full_service_plist app.step.gossip "$ROOT/run-gossip.sh" "$LOG_DIR/gossip.out.log" "$LOG_DIR/gossip.err.log"
  write_full_service_plist app.step.validator "$ROOT/run-validator.sh" "$LOG_DIR/validator.out.log" "$LOG_DIR/validator.err.log"
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
  [ "\${SECRET_BACKEND:-keychain}" = "keychain" ] || return 0
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
    out="$(SECRET_BACKEND="\${SECRET_BACKEND:-keychain}" SECRET_SERVICE="$SERVICE" GATEWAY_NONCE_SECRET="$nonce" "$BIN" --init)"
    addr="$(printf '%s' "$out" | sed -n 's/^NODE_ADDRESS=//p')"
    [ -n "$addr" ] || { echo "provision failed: node-agent did not return NODE_ADDRESS" >&2; exit 1; }
    echo "$addr" > "$ROOT/node-address.txt"
  fi
  store_nonce "$addr" "$nonce"
  write_env "$addr"
  if [ -n "$nonce" ]; then
    printf 'GATEWAY_NONCE_SECRET=%s\n' "$nonce" >> "$NODE_ENV"
  fi
  write_manifest "$addr"
  write_node_directory "$addr"
  write_plist
  install_full_services
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
  if [ "$SURVIVAL_TIER" = "full" ]; then
    curl -fsS -m 2 "http://127.0.0.1:8080/healthz" >/dev/null 2>&1 && add gateway.health pass ":8080" || add gateway.health fail ":8080 down"
    curl -fsS -m 2 "http://127.0.0.1:8099/v1/fleet" >/dev/null 2>&1 && add fleet.health pass ":8099" || add fleet.health fail ":8099 down"
    curl -fsS -m 2 -H "content-type: application/json" --data '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' "http://127.0.0.1:8645" >/dev/null 2>&1 && add chain.health pass ":8645" || add chain.health fail ":8645 down"
  fi
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

writeFileSync(join(resources, "Welcome.html"), `<!doctype html>
<html>
<head><meta charset="utf-8"><style>body{font:13px -apple-system,BlinkMacSystemFont,sans-serif;line-height:1.45;color:#1f2328}h1{font-size:22px;margin:0 0 12px}p{margin:0 0 10px}</style></head>
<body>
<h1>STEP Trust Center</h1>
<p>This installer adds the STEP Trust Center runtime to this Mac.</p>
<p>A Trust Center is a peer node that can run STEP services locally: node agent, validator, gossip, gateway, fleet view, and local chain RPC when installed as a full node package.</p>
<p>The installer does not grant validator authority by itself. Quorum participation is granted later by the network admission process.</p>
</body>
</html>
`);

writeFileSync(join(resources, "ReadMe.html"), `<!doctype html>
<html>
<head><meta charset="utf-8"><style>body{font:13px -apple-system,BlinkMacSystemFont,sans-serif;line-height:1.45;color:#1f2328}h1{font-size:22px;margin:0 0 12px}h2{font-size:16px;margin:18px 0 8px}ol,ul{padding-left:22px}code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;background:#f6f8fa;padding:1px 4px;border-radius:4px}</style></head>
<body>
<h1>Installation guide</h1>
<h2>What happens during install</h2>
<ul>
<li>The STEP command line tools are installed under <code>/usr/local/bin</code>.</li>
<li>The Trust Center runtime payload is installed under <code>/usr/local/lib/step-trustcenter</code>.</li>
<li>No wallet, node identity, or validator authority is created during the installer step.</li>
</ul>
<h2>After install</h2>
<ol>
<li>Open Terminal.</li>
<li>Run <code>step-trustcenter provision</code>.</li>
<li>Follow the pairing payload shown by the command.</li>
<li>Create or import a STEP wallet in the app when available, then pair that wallet as the Trust Center owner/reward identity.</li>
<li>Keep the Mac online. The node can be offline sometimes, but more uptime means better service quality and future reward eligibility.</li>
</ol>
<h2>Updates</h2>
<p>After provisioning, the Trust Center agent polls the on-chain release registry for approved releases. It can download artifacts from configured sources or from other Trust Centers that already have the release cached. Every downloaded artifact is verified against the on-chain hash before activation.</p>
<h2>Trust and quorum</h2>
<p>Installing the app does not automatically make this Mac a voting validator. The node must be admitted on-chain by the network governance/admin process before it counts in validator quorum or receives validator rewards.</p>
<h2>Restart and recovery</h2>
<p>After provisioning, macOS launchd starts the Trust Center services automatically after crash or reboot. Use <code>step-trustcenter status</code>, <code>step-trustcenter doctor</code>, and <code>step-trustcenter logs</code> to inspect the node.</p>
</body>
</html>
`);

writeFileSync(join(resources, "Conclusion.html"), `<!doctype html>
<html>
<head><meta charset="utf-8"><style>body{font:13px -apple-system,BlinkMacSystemFont,sans-serif;line-height:1.45;color:#1f2328}h1{font-size:22px;margin:0 0 12px}code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;background:#f6f8fa;padding:1px 4px;border-radius:4px}</style></head>
<body>
<h1>Installation complete</h1>
<p>Next step: open Terminal and run <code>step-trustcenter provision</code>.</p>
<p>Provisioning creates the local node identity, installs the user launch services, and prints the wallet pairing payload.</p>
<p>After provisioning, the node can automatically discover approved releases and seed cached artifacts to other nodes.</p>
</body>
</html>
`);

const component = join(dist, `step-trustcenter-component-${version}-${platform}.pkg`);
const out = join(dist, `STEP-TrustCenter-${version}-${platform}.pkg`);
execFileSync("pkgbuild", ["--root", join(build, "payload"), "--scripts", scripts, "--identifier", identifier, "--version", version, "--install-location", "/", component], { stdio: "inherit" });
const distribution = join(build, "Distribution.xml");
writeFileSync(distribution, `<?xml version="1.0" encoding="utf-8"?>
<installer-gui-script minSpecVersion="1">
  <title>STEP Trust Center</title>
  <welcome file="Welcome.html"/>
  <readme file="ReadMe.html"/>
  <conclusion file="Conclusion.html"/>
  <options customize="never" require-scripts="true" hostArchitectures="arm64,x86_64"/>
  <domains enable_anywhere="false" enable_currentUserHome="false" enable_localSystem="true"/>
  <choices-outline>
    <line choice="default"/>
  </choices-outline>
  <choice id="default" title="STEP Trust Center">
    <pkg-ref id="${identifier}"/>
  </choice>
  <pkg-ref id="${identifier}" version="${version}" onConclusion="none">step-trustcenter-component-${version}-${platform}.pkg</pkg-ref>
</installer-gui-script>
`);
execFileSync("productbuild", ["--distribution", distribution, "--package-path", dist, "--resources", resources, out], { stdio: "inherit" });
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
