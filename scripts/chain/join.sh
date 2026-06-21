#!/bin/sh
# Join the STEP sovereign chain from ANY machine, anywhere — addressed by node-id,
# no DNS. Installs the chain home from the shared genesis + a peer, syncs, and
# prints the one tx to become a BFT validator. This is the "run on other machines
# to build the foundation" artifact (ADR-024).
#
#   STEP_GENESIS=./chain/genesis.json \
#   STEP_SEED=f7029b25bb3c6464206f4bf58defeb6d606a9f88@<tribecca-ip>:26656 \
#   sh scripts/chain/join.sh <moniker>
#
# Prereq: build the binary first — sh scripts/chain/build-evmd.sh
set -eu
EVMD="${EVMD:-$HOME/.local/bin/evmd}"
HOME_DIR="${STEP_CHAIN_HOME:-$HOME/.evmd}"
CHAINID="${STEP_COSMOS_CHAIN_ID:-9001}"
MONIKER="${1:?usage: join.sh <moniker>}"
: "${STEP_GENESIS:?set STEP_GENESIS to the shared chain/genesis.json (path or URL)}"
: "${STEP_SEED:?set STEP_SEED to <node-id>@<host>:26656 of an existing node}"

[ -x "$EVMD" ] || { echo "build first: sh scripts/chain/build-evmd.sh" >&2; exit 1; }

# Fresh home + a local validator key for this machine.
"$EVMD" init "$MONIKER" --chain-id "$CHAINID" --home "$HOME_DIR" >/dev/null 2>&1 || true
"$EVMD" keys add "$MONIKER" --keyring-backend test --home "$HOME_DIR" 2>&1 | tail -4 || true

# Drop in the SHARED genesis (the chain's birth certificate) + wire the peer.
case "$STEP_GENESIS" in
  http*) curl -fsSL "$STEP_GENESIS" -o "$HOME_DIR/config/genesis.json";;
  *)     cp "$STEP_GENESIS" "$HOME_DIR/config/genesis.json";;
esac
CFG="$HOME_DIR/config/config.toml"
sed -i.bak "s/^persistent_peers *=.*/persistent_peers = \"$STEP_SEED\"/" "$CFG"

echo ""
echo "[join] home ready. Start syncing:   sh scripts/chain/start.sh"
echo "[join] once synced, fund this key (atest) and submit ONE tx to become a"
echo "       BFT validator:"
echo "         $EVMD tx staking create-validator <validator.json> \\"
echo "           --from $MONIKER --keyring-backend test --home $HOME_DIR \\"
echo "           --chain-id $CHAINID --gas auto --fees 2000000000000000atest"
echo "       (see cosmos/evm docs for validator.json; pubkey = '$EVMD comet show-validator')"
