#!/bin/sh
# Start the STEP sovereign chain node (CometBFT + EVM). Genesis node OR a synced
# validator — both just run this against their $HOME/.evmd. EVM JSON-RPC on 8645
# (so it can coexist with the legacy dev anvil on 8545 during migration).
#   sh scripts/chain/start.sh
set -eu
EVMD="${EVMD:-$HOME/.local/bin/evmd}"
HOME_DIR="${STEP_CHAIN_HOME:-$HOME/.evmd}"
CHAINID="${STEP_COSMOS_CHAIN_ID:-9001}"
RPC_PORT="${STEP_EVM_RPC_PORT:-8645}"
# Phase 2 reachability: EVM JSON-RPC bind host. Default loopback; set to the LAN IP
# (or 0.0.0.0) so trust centers can read the chain. RPC is read-only access — it
# never exposes keys — but on the devnet (public-key genesis) keep it to a trusted
# LAN/WireGuard, never the public internet.
RPC_HOST="${STEP_EVM_RPC_HOST:-127.0.0.1}"
# #63: a networked chain must charge a non-zero gas floor (free txs = spam/DoS).
# Zero is allowed ONLY for an explicit local sandbox.
GAS_PRICE="${STEP_MIN_GAS_PRICE:-1000000000}" # 1e9 atest, sane default
if [ "${STEP_LOCAL_DEV:-0}" != "1" ] && { [ -z "$GAS_PRICE" ] || [ "$GAS_PRICE" = "0" ]; }; then
  echo "[chain] refusing to start with a 0 gas floor outside STEP_LOCAL_DEV=1 (spam/DoS risk)" >&2
  exit 2
fi
[ "${STEP_LOCAL_DEV:-0}" = "1" ] && GAS_PRICE="0"
exec "$EVMD" start --home "$HOME_DIR" \
  --chain-id "$CHAINID" \
  --pruning nothing "--minimum-gas-prices=${GAS_PRICE}atest" --evm.min-tip=0 \
  --json-rpc.api eth,txpool,personal,net,debug,web3 \
  --json-rpc.address "${RPC_HOST}:${RPC_PORT}" \
  --json-rpc.ws-address "${RPC_HOST}:$((RPC_PORT + 1))"
