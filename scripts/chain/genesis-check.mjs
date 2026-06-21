/**
 * genesis-check (#58, audit C1) — fail if a chain genesis is controlled by PUBLIC,
 * well-known keys. The cosmos/evm `local_node.sh` funds accounts and seeds the
 * validator from hardcoded public test mnemonics; any production genesis derived
 * from them is owned by anyone who knows those mnemonics. This scans a genesis's
 * funded balances + genesis validators and reports any address on the public
 * denylist. Used as a CI test against the committed devnet sample (which is
 * EXPECTED to be flagged) and as a pre-distribution gate for a real genesis
 * (which must be clean).
 */

/** Cosmos bech32 addresses of the public cosmos/evm dev keys (dev0-3 + mykey). */
export const PUBLIC_DENYLIST = new Set([
  "cosmos1cml96vmptgw99syqrrz8az79xer2pcgp95srxm",
  "cosmos1jcltmuhplrdcwp7stlr4hlhlhgd4htqhnu0t2g",
  "cosmos1gzsvk8rruqn2sx64acfsskrwy8hvrmafzhvvr0",
  "cosmos1fx944mzagwdhx0wz7k9tfztc8g3lkfk6pzezqh",
  "cosmos10jmp6sgh4cc6zt3e8gw05wavvejgr5pwsjskvv",
]);

/**
 * Return the public-denylist addresses found funded or seeded as validators in a
 * parsed genesis. Empty array ⇒ the genesis is not controlled by known public keys.
 */
export function publicKeyAddressesIn(genesis, denylist = PUBLIC_DENYLIST) {
  const found = new Set();
  const state = genesis?.app_state ?? {};
  for (const b of state.bank?.balances ?? []) {
    if (denylist.has(b.address)) found.add(b.address);
  }
  for (const acc of state.auth?.accounts ?? []) {
    const addr = acc?.address ?? acc?.base_account?.address;
    if (addr && denylist.has(addr)) found.add(addr);
  }
  // gentx delegator/validator addresses (gen_txs are signed tx envelopes).
  const txs = state.genutil?.gen_txs ?? [];
  const blob = JSON.stringify(txs);
  for (const addr of denylist) if (blob.includes(addr)) found.add(addr);
  return [...found];
}

/** True if the genesis is safe (no public-key control). */
export function isProductionSafe(genesis, denylist = PUBLIC_DENYLIST) {
  return publicKeyAddressesIn(genesis, denylist).length === 0;
}
