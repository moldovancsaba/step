#!/bin/sh
# join-local — stand up an ADDITIONAL validator on THIS machine (offset ports) to
# test multi-validator BFT consensus locally, before doing the same on real
# machines (scripts/chain/join.sh + become-validator.sh). Proven: a 2nd node peers
# with node1, syncs the whole chain, and joins the active set.
#
#   sh scripts/chain/join-local.sh <index>   # index>=2 → ports offset by index*10
#
# After it syncs, fund + stake it:
#   node scripts/chain/faucet.mjs --to $(evmd keys show node<idx>val -a --keyring-backend test --home ~/.evmd-node<idx>)
#   STEP_CHAIN_HOME=~/.evmd-node<idx> sh scripts/chain/become-validator.sh node<idx>val
set -eu
EVMD="${EVMD:-$HOME/.local/bin/evmd}"
IDX="${1:?usage: join-local.sh <index (>=2)>}"
[ "$IDX" -ge 2 ] || { echo "index must be >= 2 (node1 is the genesis node)" >&2; exit 2; }
CHAINID="${STEP_COSMOS_CHAIN_ID:-9001}"
N1="${STEP_NODE1_HOME:-$HOME/.evmd}"
N2="$HOME/.evmd-node${IDX}"
OFF=$((IDX * 10))
P2P=$((26656 + OFF)); RPC=$((26657 + OFF)); EVMRPC=$((8645 + OFF)); WS=$((8646 + OFF)); GRPC=$((9090 + OFF * 10))

SEEDID=$("$EVMD" comet show-node-id --home "$N1")
SEED="${SEEDID}@127.0.0.1:26656"

rm -rf "$N2"
"$EVMD" init "node${IDX}" --chain-id "$CHAINID" --home "$N2" >/dev/null 2>&1
cp "$N1/config/genesis.json" "$N2/config/genesis.json"
# evmd's EVM mempool requires mempool.type="app" (bare `init` writes "flood").
sed -i.bak 's/^type = "flood"/type = "app"/' "$N2/config/config.toml" && rm -f "$N2/config/config.toml.bak"
"$EVMD" keys add "node${IDX}val" --keyring-backend test --home "$N2" >/dev/null 2>&1 || true

echo "[join-local] node${IDX} addr: $("$EVMD" keys show node${IDX}val -a --keyring-backend test --home "$N2")"
echo "[join-local] starting (P2P :$P2P, EVM RPC :$EVMRPC, peer $SEED) …"
exec "$EVMD" start --home "$N2" \
  --p2p.laddr "tcp://0.0.0.0:${P2P}" --rpc.laddr "tcp://127.0.0.1:${RPC}" \
  --p2p.persistent_peers "$SEED" \
  --grpc.address "localhost:${GRPC}" --api.enable=false \
  --json-rpc.address "127.0.0.1:${EVMRPC}" --json-rpc.ws-address "127.0.0.1:${WS}" \
  --minimum-gas-prices=0atest --evm.min-tip=0 --chain-id "$CHAINID"
