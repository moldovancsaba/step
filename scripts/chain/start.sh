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
exec "$EVMD" start --home "$HOME_DIR" \
  --chain-id "$CHAINID" \
  --pruning nothing --minimum-gas-prices=0atest --evm.min-tip=0 \
  --json-rpc.api eth,txpool,personal,net,debug,web3 \
  --json-rpc.address "127.0.0.1:${RPC_PORT}" \
  --json-rpc.ws-address "127.0.0.1:$((RPC_PORT + 1))"
