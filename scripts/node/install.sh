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

RPC=""; REGISTRY=""; PLATFORM_ID=""; ARTIFACT=""; NONCE_SECRET=""; FLEET=""
PLATFORM="${STEP_PLATFORM:-$(uname -s | tr '[:upper:]' '[:lower:]')-$(uname -m)}"
while [ $# -gt 0 ]; do
  case "$1" in
    --rpc) RPC="$2"; shift 2;;
    --registry) REGISTRY="$2"; shift 2;;
    --platform-id) PLATFORM_ID="$2"; shift 2;;
    --artifact) ARTIFACT="$2"; shift 2;;
    --nonce-secret) NONCE_SECRET="$2"; shift 2;;
    --fleet) FLEET="$2"; shift 2;;
    *) echo "unknown arg: $1" >&2; exit 2;;
  esac
done
[ -n "$RPC" ] && [ -n "$REGISTRY" ] && [ -n "$PLATFORM_ID" ] && [ -n "$ARTIFACT" ] && [ -n "$NONCE_SECRET" ] || {
  echo "required: --rpc --registry --platform-id --artifact --nonce-secret" >&2; exit 2; }

ROOT="$HOME/.step-node"
mkdir -p "$ROOT"
echo "[step-install] downloading agent for $PLATFORM …"
curl -fsSL "$ARTIFACT" -o "$ROOT/step-node-agent"
chmod +x "$ROOT/step-node-agent"
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
STEP_RPC_URLS=$RPC
RELEASE_REGISTRY=$REGISTRY
NODE_ADDRESS=$NODE_ADDRESS
PLATFORM_ID=$PLATFORM_ID
PLATFORM=$PLATFORM
ARTIFACT_BASE_URLS=$(dirname "$ARTIFACT")
SECRET_BACKEND=${SECRET_BACKEND:-keychain}
${FLEET:+FLEET_URL=$FLEET}
EOF

cat > "$ROOT/run-agent.sh" <<EOF
#!/bin/sh
set -a; . "$ROOT/node.env"; set +a
exec "$ROOT/step-node-agent"
EOF
chmod +x "$ROOT/run-agent.sh"

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
echo "[step-install]   Ask the hub operator to register it (grants quorum weight):"
echo "[step-install]     node scripts/node/register.mjs $NODE_ADDRESS --weight 50"
