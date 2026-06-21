#!/bin/sh
# become-validator — turn a SYNCED node into a BFT validator on the sovereign
# chain. Run this on the joining machine AFTER `join.sh` + `start.sh` have caught
# the node up, and after its key has been funded (scripts/chain/faucet.mjs, run on
# a funded machine, --to $(this node's address)).
#
#   sh scripts/chain/become-validator.sh <key-name> [stake-atest]
#
# Prints the node's address first so the coordinator can fund it.
set -eu
EVMD="${EVMD:-$HOME/.local/bin/evmd}"
HOME_DIR="${STEP_CHAIN_HOME:-$HOME/.evmd}"
CHAINID="${STEP_COSMOS_CHAIN_ID:-9001}"
KEY="${1:?usage: become-validator.sh <key-name> [stake-atest]}"
STAKE="${2:-1000000000000000000000}" # 1000 atest default self-delegation

ADDR=$("$EVMD" keys show "$KEY" -a --keyring-backend test --home "$HOME_DIR")
echo "[validator] this node's address: $ADDR"
echo "[validator] (it must be funded first: on a funded machine run"
echo "             node scripts/chain/faucet.mjs --to $ADDR )"

PUBKEY=$("$EVMD" comet show-validator --home "$HOME_DIR")
VJSON="$HOME_DIR/validator.json"
cat > "$VJSON" <<EOF
{
  "pubkey": $PUBKEY,
  "amount": "${STAKE}atest",
  "moniker": "${KEY}",
  "commission-rate": "0.10",
  "commission-max-rate": "0.20",
  "commission-max-change-rate": "0.01",
  "min-self-delegation": "1"
}
EOF

echo "[validator] submitting create-validator…"
"$EVMD" tx staking create-validator "$VJSON" \
  --from "$KEY" --keyring-backend test --home "$HOME_DIR" \
  --chain-id "$CHAINID" --gas auto --gas-adjustment 1.3 \
  --fees 2000000000000000atest --broadcast-mode sync --yes

echo "[validator] ✓ submitted. Verify in the active set:"
echo "    $EVMD q staking validators --home $HOME_DIR | grep -A2 moniker"
