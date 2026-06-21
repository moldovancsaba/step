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
  --json-rpc.address "127.0.0.1:${RPC_PORT}" \
  --json-rpc.ws-address "127.0.0.1:$((RPC_PORT + 1))"
