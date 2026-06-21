# STEP sovereign chain — genesis

> `genesis.devnet.sample.json` is a **DEVNET SAMPLE ONLY**. It was produced by
> cosmos/evm `local_node.sh`, whose dev keys are **public** (anyone who knows the
> well-known test mnemonics controls its funds and validator). It exists to
> illustrate the genesis shape and for local testing — **never start a real chain
> from it** (audit finding C1, ADR-024).

## Production genesis (the real chain)

Generate a genesis with **secret, per-operator validator keys** (see issue C1):

1. Each operator: `evmd init <moniker> --chain-id <new>`; `evmd keys add <secret>`;
   `evmd genesis add-genesis-account`; `evmd genesis gentx`.
2. Coordinator: `evmd genesis collect-gentxs` → `evmd genesis validate-genesis`.
3. Gate it: `node scripts/chain/genesis-check.mjs` must report **no** public-key
   addresses (CI test: `scripts/chain/genesis-check.test.mjs`).
4. Publish the genesis + its SHA-256; every joiner verifies the hash before
   `scripts/chain/join.sh`.

The production genesis is distributed out-of-band — it is **not** committed here,
and it must contain no public-mnemonic accounts.
