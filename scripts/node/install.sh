#!/bin/sh
# STEP trust-center installer — keyless, one command, any machine (mac/linux).
#
#   curl -fsSL <hub>/install.sh | sh -s -- \
#     --rpc https://<hub-rpc> --registry 0x<ReleaseRegistry> \
#     --platform-id 0x<keccak(platform)> --artifact <hub>/step-node-agent \
#     --nonce-secret <shared-gateway-nonce-secret> [--fleet https://<hub>:8099]
#
# The node GENERATES ITS OWN KEY locally (nothing secret travels), installs a
# boot-persistent service, and prints its address. The operator then registers
# that address on the hub:  node scripts/node/register.mjs 0x<address>
# After that the node self-updates from chain forever (ADR-019/M8).
set -eu

RPC=""; REGISTRY=""; PLATFORM_ID=""; ARTIFACT=""; NONCE_SECRET=""; FLEET=""; SHA256=""; FULLSTACK_ARTIFACT=""; FULLSTACK_SHA256=""
BOOTSTRAP_PEERS="${STEP_TRUSTCENTER_BOOTSTRAP_PEERS:-}"
RELAY_PEERS="${STEP_TRUSTCENTER_RELAY_PEERS:-}"
ADVERTISE_PEERS="${STEP_TRUSTCENTER_ADVERTISE_PEERS:-}"
TRANSPORT="${STEP_TRUSTCENTER_TRANSPORT:-}"
SURVIVAL_TIER="${STEP_TRUSTCENTER_SURVIVAL_TIER:-edge}"
PLATFORM="${STEP_PLATFORM:-$(uname -s | tr '[:upper:]' '[:lower:]')-$(uname -m)}"
while [ $# -gt 0 ]; do
  case "$1" in
    --rpc) RPC="$2"; shift 2;;
    --registry) REGISTRY="$2"; shift 2;;
    --platform-id) PLATFORM_ID="$2"; shift 2;;
    --artifact) ARTIFACT="$2"; shift 2;;
    --nonce-secret) NONCE_SECRET="$2"; shift 2;;
    --fleet) FLEET="$2"; shift 2;;
    --sha256) SHA256="$2"; shift 2;;
    --bootstrap-peers) BOOTSTRAP_PEERS="$2"; shift 2;;
    --relay-peers) RELAY_PEERS="$2"; shift 2;;
    --advertise-peers) ADVERTISE_PEERS="$2"; shift 2;;
    --transport) TRANSPORT="$2"; shift 2;;
    --survival-tier) SURVIVAL_TIER="$2"; shift 2;;
    --fullstack-artifact) FULLSTACK_ARTIFACT="$2"; shift 2;;
    --fullstack-sha256) FULLSTACK_SHA256="$2"; shift 2;;
    *) echo "unknown arg: $1" >&2; exit 2;;
  esac
done
[ -n "$RPC" ] && [ -n "$REGISTRY" ] && [ -n "$PLATFORM_ID" ] && [ -n "$ARTIFACT" ] && [ -n "$NONCE_SECRET" ] || {
  echo "required: --rpc --registry --platform-id --artifact --nonce-secret" >&2; exit 2; }
# #60: fail-closed binary integrity. The agent self-update verifies sha256 against
# the on-chain ReleaseRegistry; the bootstrap installer must too. No hash ⇒ refuse.
[ -n "$SHA256" ] || { echo "[step-install] refusing: --sha256 <expected hex> is required (the hub prints it; it is the on-chain ReleaseRegistry binary hash)" >&2; exit 2; }

ROOT="$HOME/.step-node"
MANIFEST="$ROOT/trust-center.manifest.json"
mkdir -p "$ROOT"
echo "[step-install] downloading agent for $PLATFORM …"
curl -fsSL "$ARTIFACT" -o "$ROOT/step-node-agent.unverified"
# Verify BEFORE making it executable or running anything.
if command -v sha256sum >/dev/null 2>&1; then GOT=$(sha256sum "$ROOT/step-node-agent.unverified" | awk '{print $1}')
elif command -v shasum >/dev/null 2>&1; then GOT=$(shasum -a 256 "$ROOT/step-node-agent.unverified" | awk '{print $1}')
else echo "[step-install] no sha256 tool (sha256sum/shasum) — cannot verify; aborting" >&2; rm -f "$ROOT/step-node-agent.unverified"; exit 1; fi
WANT=$(printf '%s' "$SHA256" | tr 'A-Z' 'a-z' | sed 's/^0x//')
if [ "$GOT" != "$WANT" ]; then
  echo "[step-install] HASH MISMATCH — refusing to run downloaded binary." >&2
  echo "[step-install]   expected: $WANT" >&2
  echo "[step-install]   got:      $GOT" >&2
  rm -f "$ROOT/step-node-agent.unverified"; exit 1
fi

validate_peer_list() {
  name="$1"; raw="$2"
  [ -z "$raw" ] && return 0
  old_ifs="$IFS"; IFS=,
  for peer in $raw; do
    case "$peer" in /*) : ;; *) echo "[step-install] $name entries must be libp2p multiaddrs: $peer" >&2; IFS="$old_ifs"; exit 2 ;; esac
  done
  IFS="$old_ifs"
}
json_peer_array() {
  raw="$1"
  python3 - "$raw" <<'PY'
import json, sys
raw = sys.argv[1]
items = [p.strip() for p in raw.split(",") if p.strip()]
print(json.dumps(items))
PY
}
validate_peer_list "--bootstrap-peers" "$BOOTSTRAP_PEERS"
validate_peer_list "--relay-peers" "$RELAY_PEERS"
validate_peer_list "--advertise-peers" "$ADVERTISE_PEERS"
if [ -z "$TRANSPORT" ]; then
  TRANSPORT="http"
  if [ -n "$BOOTSTRAP_PEERS$RELAY_PEERS$ADVERTISE_PEERS" ]; then
    TRANSPORT="peer"
  fi
fi
if [ "$TRANSPORT" != "http" ] && [ "$TRANSPORT" != "peer" ]; then
  echo "[step-install] --transport must be http or peer" >&2
  exit 2
fi
if [ "$SURVIVAL_TIER" != "edge" ] && [ "$SURVIVAL_TIER" != "full" ]; then
  echo "[step-install] --survival-tier must be edge or full" >&2
  exit 2
fi
if [ "$SURVIVAL_TIER" = "full" ]; then
  [ -n "$FULLSTACK_ARTIFACT" ] && [ -n "$FULLSTACK_SHA256" ] || { echo "[step-install] --survival-tier full requires --fullstack-artifact and --fullstack-sha256" >&2; exit 2; }
fi
SURVIVAL_FULL=false
if [ "$SURVIVAL_TIER" = "full" ]; then
  SURVIVAL_FULL=true
fi
verify_sha256_file() {
  file="$1"; want_raw="$2"
  if command -v sha256sum >/dev/null 2>&1; then got=$(sha256sum "$file" | awk '{print $1}')
  elif command -v shasum >/dev/null 2>&1; then got=$(shasum -a 256 "$file" | awk '{print $1}')
  else echo "[step-install] no sha256 tool (sha256sum/shasum) — cannot verify; aborting" >&2; return 1; fi
  want=$(printf '%s' "$want_raw" | tr 'A-Z' 'a-z' | sed 's/^0x//')
  [ "$got" = "$want" ] || { echo "[step-install] HASH MISMATCH for $file" >&2; echo "expected: $want" >&2; echo "got:      $got" >&2; return 1; }
}

install_fullstack_payload() {
  [ "$SURVIVAL_TIER" != "full" ] && return 0
  echo "[step-install] downloading full Trust Center runtime …"
  curl -fsSL "$FULLSTACK_ARTIFACT" -o "$ROOT/fullstack.tgz.unverified"
  verify_sha256_file "$ROOT/fullstack.tgz.unverified" "$FULLSTACK_SHA256" || { rm -f "$ROOT/fullstack.tgz.unverified"; exit 1; }
  rm -rf "$ROOT/fullstack"
  mkdir -p "$ROOT/fullstack"
  tar -xzf "$ROOT/fullstack.tgz.unverified" -C "$ROOT/fullstack"
  rm -f "$ROOT/fullstack.tgz.unverified"
  for f in node gateway-api.mjs fleet-api.mjs chain-rpc.mjs account-api.mjs indexer.mjs nft-indexer.mjs validator-node gossip-node; do
    [ -e "$ROOT/fullstack/$f" ] || { echo "[step-install] fullstack payload missing $f" >&2; exit 1; }
  done
  chmod +x "$ROOT/fullstack/node" "$ROOT/fullstack/validator-node" "$ROOT/fullstack/gossip-node"
  echo "[step-install] ✓ full Trust Center runtime verified"
}

mv "$ROOT/step-node-agent.unverified" "$ROOT/step-node-agent"
chmod +x "$ROOT/step-node-agent"
install_fullstack_payload
echo "[step-install] ✓ binary sha256 verified"
[ "$(uname -s)" = "Darwin" ] && xattr -dr com.apple.quarantine "$ROOT/step-node-agent" 2>/dev/null || true

# Generate the node identity locally (idempotent: reuse a prior address).
if [ -f "$ROOT/node.env" ]; then
  . "$ROOT/node.env"
  echo "[step-install] reusing existing node $NODE_ADDRESS"
else
  ADDR_LINE=$(SECRET_BACKEND="${SECRET_BACKEND:-keychain}" GATEWAY_NONCE_SECRET="$NONCE_SECRET" \
    "$ROOT/step-node-agent" --init)
  NODE_ADDRESS=$(echo "$ADDR_LINE" | sed -n 's/^NODE_ADDRESS=//p')
  [ -n "$NODE_ADDRESS" ] || { echo "[step-install] key init failed" >&2; exit 1; }
fi

# Service config (no secrets here — the key lives in the OS keychain).
cat > "$ROOT/node.env" <<EOF
AGENT_ROOT=$ROOT
STEP_RPC_URLS=http://127.0.0.1:8645,$RPC
RELEASE_REGISTRY=$REGISTRY
NODE_ADDRESS=$NODE_ADDRESS
PLATFORM_ID=$PLATFORM_ID
PLATFORM=$PLATFORM
ARTIFACT_BASE_URLS=http://127.0.0.1:9200,$(dirname "$ARTIFACT")
SECRET_BACKEND=${SECRET_BACKEND:-keychain}
GOSSIP_BOOTSTRAP=$BOOTSTRAP_PEERS
GOSSIP_RELAYS=$RELAY_PEERS
GOSSIP_ADVERTISE=$ADVERTISE_PEERS
${FLEET:+FLEET_URL=$FLEET}
GATEWAY_NONCE_SECRET=$NONCE_SECRET
SESSION_SIGNING_KEY=$(openssl rand -hex 32)
EOF
VALIDATOR_IDENTITY_KEY="${STEP_TRUSTCENTER_RELAYER_PRIVATE_KEY:-}"
if [ -z "$VALIDATOR_IDENTITY_KEY" ] && [ "${SECRET_BACKEND:-keychain}" = "file" ]; then
  SECRET_JSON="${SECRET_FILE:-$ROOT/secrets.json}"
  if [ -f "$SECRET_JSON" ]; then
    VALIDATOR_IDENTITY_KEY=$(python3 - "$SECRET_JSON" <<'PY' 2>/dev/null || true
import json, sys
data = json.load(open(sys.argv[1]))
for name, value in data.items():
    if name.endswith(".validatorKey") or name == "validatorKey":
        print(value)
        break
PY
)
  fi
fi
if [ -n "$VALIDATOR_IDENTITY_KEY" ]; then
  printf 'RELAYER_%s=%s\n' "PRIVATE_KEY" "$VALIDATOR_IDENTITY_KEY" >> "$ROOT/node.env"
  printf 'VALIDATOR_%s=%s\n' "PRIVATE_KEY" "$VALIDATOR_IDENTITY_KEY" >> "$ROOT/node.env"
fi
if [ -z "${VERIFIER_CONTRACT_ADDRESS:-}" ] && [ -f "$ROOT/deployments.json" ]; then
  VERIFIER_CONTRACT_ADDRESS=$(python3 - "$ROOT/deployments.json" <<'PY' 2>/dev/null || true
import json, sys
print(json.load(open(sys.argv[1])).get("MiningClaimVerifier", ""))
PY
)
fi
[ -n "${VERIFIER_CONTRACT_ADDRESS:-}" ] && printf 'VERIFIER_CONTRACT_ADDRESS=%s\n' "$VERIFIER_CONTRACT_ADDRESS" >> "$ROOT/node.env"

NODE_NAME=$(hostname -s 2>/dev/null | tr '[:upper:]' '[:lower:]' | tr -cd 'a-z0-9-' | cut -c1-63)
[ -n "$NODE_NAME" ] || NODE_NAME="step-node"
ARTIFACT_BASE=$(dirname "$ARTIFACT")
BOOTSTRAP_JSON=$(json_peer_array "$BOOTSTRAP_PEERS")
RELAY_JSON=$(json_peer_array "$RELAY_PEERS")
ADVERTISE_JSON=$(json_peer_array "$ADVERTISE_PEERS")

cat > "$ROOT/nodes.json" <<EOF
{
  "nodes": [
    {
      "name": "$NODE_NAME",
      "address": "$NODE_ADDRESS",
      "url": "http://127.0.0.1:9101",
      "services": ["validator", "agent", "gateway", "fleet", "gossip", "chain-rpc", "artifacts", "account", "indexer", "nft"],
      "weight": 101,
      "type": "TrustCenter",
      "location": "local",
      "status": "active"
    }
  ]
}
EOF

cat > "$MANIFEST" <<EOF
{
  "schema_version": "step.trust-center.manifest.v1",
  "node": {
    "name": "$NODE_NAME",
    "address": "$NODE_ADDRESS",
    "transport": "$TRANSPORT",
    "platform": "$PLATFORM",
    "location": "local",
    "identity_backend": "${SECRET_BACKEND:-keychain}"
  },
  "roles": $( [ "$SURVIVAL_TIER" = "full" ] && echo '["agent", "validator", "gossip", "chain", "gateway", "fleet", "account", "indexer", "nft"]' || echo '["agent", "validator", "gossip"]' ),
  "services": {
    "agent": {
      "enabled": true,
      "bind": "127.0.0.1:9200",
      "healthz": "http://127.0.0.1:9200/healthz"
    },
    "validator": {
      "enabled": true,
      "bind": "127.0.0.1:9101",
      "healthz": "http://127.0.0.1:9101/healthz"
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
    },
    "account": {
      "enabled": $SURVIVAL_FULL,
      "bind": "0.0.0.0:8091",
      "healthz": "http://127.0.0.1:8091/healthz"
    },
    "indexer": {
      "enabled": $SURVIVAL_FULL,
      "bind": "0.0.0.0:8090",
      "healthz": "http://127.0.0.1:8090/healthz"
    },
    "nft": {
      "enabled": $SURVIVAL_FULL,
      "bind": "0.0.0.0:8092",
      "healthz": "http://127.0.0.1:8092/healthz"
    }
  },
  "peer": {
    "bootstrap_peers": $BOOTSTRAP_JSON,
    "relay_peers": $RELAY_JSON,
    "advertise": $ADVERTISE_JSON
  },
  "chain": {
    "chain_id": "${STEP_CHAIN_ID:-262144}",
    "rpc_urls": ["http://127.0.0.1:8645,$RPC"],
    "release_registry": "$REGISTRY",
    "validator_registry": "${VERIFIER_CONTRACT_ADDRESS:-0x0000000000000000000000000000000000000000}"
  },
  "update": {
    "platform_id": "$PLATFORM_ID",
    "artifact_base_urls": ["http://127.0.0.1:9200", "$ARTIFACT_BASE"],
    "poll_interval_s": 30,
    "integrity_interval_s": 120
  },
  "recovery": {
    "supervisor": "$( [ "$(uname -s)" = "Darwin" ] && echo launchd || echo systemd )",
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
    "healthz": "http://127.0.0.1:9200/healthz",
    "logs": [
      "$ROOT/agent.out.log",
      "$ROOT/agent.err.log"
    ],
    "fleet_heartbeat": true
  }
}
EOF

cat > "$ROOT/run-agent.sh" <<EOF
#!/bin/sh
set -a; . "$ROOT/node.env"; set +a
exec "$ROOT/step-node-agent"
EOF
chmod +x "$ROOT/run-agent.sh"

install_full_launchd_services() {
  [ "$SURVIVAL_TIER" != "full" ] && return 0
  for pair in \
    "app.step.chain:$ROOT/run-chain-rpc.sh:$ROOT/chain.out.log:$ROOT/chain.err.log" \
    "app.step.gateway:$ROOT/run-gateway.sh:$ROOT/gateway.out.log:$ROOT/gateway.err.log" \
    "app.step.fleet:$ROOT/run-fleet.sh:$ROOT/fleet.out.log:$ROOT/fleet.err.log" \
    "app.step.gossip:$ROOT/run-gossip.sh:$ROOT/gossip.out.log:$ROOT/gossip.err.log" \
    "app.step.validator:$ROOT/run-validator.sh:$ROOT/validator.out.log:$ROOT/validator.err.log" \
    "app.step.account-api:$ROOT/run-account.sh:$ROOT/account.out.log:$ROOT/account.err.log" \
    "app.step.indexer:$ROOT/run-indexer.sh:$ROOT/indexer.out.log:$ROOT/indexer.err.log" \
    "app.step.nft-indexer:$ROOT/run-nft-indexer.sh:$ROOT/nft-indexer.out.log:$ROOT/nft-indexer.err.log"; do
    label=$(printf '%s' "$pair" | cut -d: -f1)
    script=$(printf '%s' "$pair" | cut -d: -f2)
    out=$(printf '%s' "$pair" | cut -d: -f3)
    err=$(printf '%s' "$pair" | cut -d: -f4)
    plist="$HOME/Library/LaunchAgents/$label.plist"
    cat > "$plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$label</string>
  <key>ProgramArguments</key><array><string>$script</string></array>
  <key>RunAtLoad</key><true/><key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$out</string>
  <key>StandardErrorPath</key><string>$err</string>
</dict></plist>
PLIST
    launchctl bootout "gui/$(id -u)/$label" 2>/dev/null || true
    launchctl bootstrap "gui/$(id -u)" "$plist"
  done
}

if [ "$SURVIVAL_TIER" = "full" ]; then
  [ -f "$ROOT/fullstack/deployments.json" ] && cp "$ROOT/fullstack/deployments.json" "$ROOT/deployments.json"
  # NOTE: never create "$ROOT/current" here — the agent owns it as its
  # active-release symlink; a real directory there breaks release activation.
  [ -f "$ROOT/fullstack/protocol-params.json" ] && cp "$ROOT/fullstack/protocol-params.json" "$ROOT/shared-params.json"
  # Canonical node config measured by the agent's integrity check.
  printf '{"mesh_spec_version":"step-mesh-v1","platform":"%s","schema":"step.node.config.v1"}' "$PLATFORM" > "$ROOT/shared-config.json"
  [ -f "$ROOT/nodes.json" ] || { [ -f "$ROOT/fullstack/nodes.json" ] && cp "$ROOT/fullstack/nodes.json" "$ROOT/nodes.json"; }
  cat > "$ROOT/run-chain-rpc.sh" <<EOF
#!/bin/sh
set -a; . "$ROOT/node.env"; set +a
exec "$ROOT/fullstack/node" "$ROOT/fullstack/chain-rpc.mjs"
EOF
  cat > "$ROOT/run-gateway.sh" <<EOF
#!/bin/sh
set -a; . "$ROOT/node.env"; set +a
export STEP_RPC_URL="\${STEP_RPC_URL:-http://127.0.0.1:8645}"
export STEP_CHAIN_ID="\${STEP_CHAIN_ID:-262144}"
export STEP_DEPLOYMENTS_FILE="\${STEP_DEPLOYMENTS_FILE:-$ROOT/deployments.json}"
export STEP_PROTOCOL_PARAMS="\${STEP_PROTOCOL_PARAMS:-$ROOT/shared-params.json}"
export NODE_DIRECTORY_FILE="\${NODE_DIRECTORY_FILE:-$ROOT/nodes.json}"
export MESH_API_URL="\${MESH_API_URL:-http://127.0.0.1:9101}"
export VALIDATOR_URLS="\${VALIDATOR_URLS:-http://127.0.0.1:9101}"
export GATEWAY_PORT="\${GATEWAY_PORT:-8080}"
exec "$ROOT/fullstack/node" "$ROOT/fullstack/gateway-api.mjs"
EOF
  cat > "$ROOT/run-fleet.sh" <<EOF
#!/bin/sh
set -a; . "$ROOT/node.env"; set +a
export STEP_RPC_URL="\${STEP_RPC_URL:-http://127.0.0.1:8645}"
export STEP_CHAIN_ID="\${STEP_CHAIN_ID:-262144}"
export STEP_DEPLOYMENTS_FILE="\${STEP_DEPLOYMENTS_FILE:-$ROOT/deployments.json}"
export NODE_DIRECTORY_FILE="\${NODE_DIRECTORY_FILE:-$ROOT/nodes.json}"
export STEP_QUORUM_THRESHOLD="\${STEP_QUORUM_THRESHOLD:-101}"
export FLEET_PORT="\${FLEET_PORT:-8099}"
exec "$ROOT/fullstack/node" "$ROOT/fullstack/fleet-api.mjs"
EOF
  cat > "$ROOT/run-gossip.sh" <<EOF
#!/bin/sh
set -a; . "$ROOT/node.env"; set +a
export STEP_RPC_URLS="\${STEP_RPC_URLS:-http://127.0.0.1:8645,$RPC}"
export STEP_DEPLOYMENTS_FILE="\${STEP_DEPLOYMENTS_FILE:-$ROOT/deployments.json}"
export STEP_SUBMIT_URL="\${STEP_SUBMIT_URL:-http://127.0.0.1:8080/v1/gossip/finalise}"
export STEP_QUORUM_THRESHOLD="\${STEP_QUORUM_THRESHOLD:-101}"
export GOSSIP_LISTEN="\${GOSSIP_LISTEN:-/ip4/0.0.0.0/tcp/4001}"
exec "$ROOT/fullstack/gossip-node"
EOF
  cat > "$ROOT/run-validator.sh" <<EOF
#!/bin/sh
set -a; . "$ROOT/node.env"; set +a
export VALIDATOR_PORT="\${VALIDATOR_PORT:-9101}"
export STEP_RPC_URL="\${STEP_RPC_URL:-http://127.0.0.1:8645}"
export STEP_CHAIN_ID="\${STEP_CHAIN_ID:-262144}"
export STEP_DEPLOYMENTS_FILE="\${STEP_DEPLOYMENTS_FILE:-$ROOT/deployments.json}"
export STEP_PROTOCOL_PARAMS="\${STEP_PROTOCOL_PARAMS:-$ROOT/shared-params.json}"
exec "$ROOT/fullstack/validator-node"
EOF
  cat > "$ROOT/run-account.sh" <<EOF
#!/bin/sh
set -a; . "$ROOT/node.env"; set +a
export ACCOUNT_PORT="\${ACCOUNT_PORT:-8091}"
export ACCOUNT_DB_FILE="\${ACCOUNT_DB_FILE:-$ROOT/accounts.sqlite}"
exec "$ROOT/fullstack/node" "$ROOT/fullstack/account-api.mjs"
EOF
  cat > "$ROOT/run-indexer.sh" <<EOF
#!/bin/sh
set -a; . "$ROOT/node.env"; set +a
export STEP_RPC_URL="\${STEP_RPC_URL:-http://127.0.0.1:8645}"
export STEP_CHAIN_ID="\${STEP_CHAIN_ID:-262144}"
export STEP_DEPLOYMENTS_FILE="\${STEP_DEPLOYMENTS_FILE:-$ROOT/deployments.json}"
export INDEXER_PORT="\${INDEXER_PORT:-8090}"
exec "$ROOT/fullstack/node" "$ROOT/fullstack/indexer.mjs"
EOF
  cat > "$ROOT/run-nft-indexer.sh" <<EOF
#!/bin/sh
set -a; . "$ROOT/node.env"; set +a
export STEP_RPC_URL="\${STEP_RPC_URL:-http://127.0.0.1:8645}"
export STEP_CHAIN_ID="\${STEP_CHAIN_ID:-262144}"
export STEP_DEPLOYMENTS_FILE="\${STEP_DEPLOYMENTS_FILE:-$ROOT/deployments.json}"
export NFT_INDEXER_PORT="\${NFT_INDEXER_PORT:-8092}"
exec "$ROOT/fullstack/node" "$ROOT/fullstack/nft-indexer.mjs"
EOF
  chmod +x "$ROOT"/run-chain-rpc.sh "$ROOT"/run-gateway.sh "$ROOT"/run-fleet.sh "$ROOT"/run-gossip.sh "$ROOT"/run-validator.sh "$ROOT"/run-account.sh "$ROOT"/run-indexer.sh "$ROOT"/run-nft-indexer.sh
fi

# Boot-persistent service: launchd (mac) or systemd --user (linux).
if [ "$(uname -s)" = "Darwin" ]; then
  PLIST="$HOME/Library/LaunchAgents/app.step.node-agent.plist"
  cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>app.step.node-agent</string>
  <key>ProgramArguments</key><array><string>$ROOT/run-agent.sh</string></array>
  <key>RunAtLoad</key><true/><key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$ROOT/agent.out.log</string>
  <key>StandardErrorPath</key><string>$ROOT/agent.err.log</string>
</dict></plist>
EOF
  launchctl bootout "gui/$(id -u)/app.step.node-agent" 2>/dev/null || true
  launchctl bootstrap "gui/$(id -u)" "$PLIST"
  install_full_launchd_services
else
  mkdir -p "$HOME/.config/systemd/user"
  cat > "$HOME/.config/systemd/user/step-node-agent.service" <<EOF
[Unit]
Description=STEP trust-center agent
[Service]
ExecStart=$ROOT/run-agent.sh
Restart=always
[Install]
WantedBy=default.target
EOF
  systemctl --user daemon-reload
  systemctl --user enable --now step-node-agent.service
fi

echo ""
echo "[step-install] ✓ node installed + running, boot-persistent."
echo "[step-install]   NODE ADDRESS: $NODE_ADDRESS"
echo "[step-install]   MANIFEST: $MANIFEST"
echo "[step-install]   Ask the hub operator to register it (grants quorum weight):"
echo "[step-install]     node scripts/node/register.mjs $NODE_ADDRESS --weight 50"
