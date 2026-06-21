#!/usr/bin/env node
/**
 * faucet — fund a new node's account with gas (atest) so it can submit the
 * create-validator tx and transact. Run on a machine that holds a funded key
 * (the genesis coordinator / an existing validator).
 *
 *   node scripts/chain/faucet.mjs --to cosmos1<addr> [--amount 1000000000000000000000] [--from dev0]
 *
 * On the devnet `--from dev0` (a pre-funded genesis account) works. For a real
 * federation, point `--from` at the designated funding key (NOT a public dev key).
 */
import { execFileSync } from "node:child_process";

const HOME = process.env.HOME;
const EVMD = process.env.EVMD ?? `${HOME}/.local/bin/evmd`;
const HOME_DIR = process.env.STEP_CHAIN_HOME ?? `${HOME}/.evmd`;
const CHAINID = process.env.STEP_COSMOS_CHAIN_ID ?? "9001";
const die = (m) => { console.error(`[faucet] ${m}`); process.exit(1); };

const a = process.argv.slice(2);
const flag = (n, d) => { const i = a.indexOf(`--${n}`); return i >= 0 ? a[i + 1] : d; };
const to = flag("to") || die("usage: --to cosmos1<addr> [--amount <atest>] [--from <key>]");
if (!/^cosmos1[0-9a-z]{38,}$/.test(to)) die("--to must be a cosmos1… bech32 address");
const amount = flag("amount", "1000000000000000000000"); // 1000 atest default
const from = flag("from", "dev0");

console.log(`[faucet] sending ${amount}atest: ${from} -> ${to}`);
execFileSync(
  EVMD,
  [
    "tx", "bank", "send", from, to, `${amount}atest`,
    "--chain-id", CHAINID, "--keyring-backend", "test", "--home", HOME_DIR,
    "--gas", "auto", "--gas-adjustment", "1.3", "--fees", "2000000000000000atest",
    "--broadcast-mode", "sync", "--yes",
  ],
  { stdio: "inherit" },
);
console.log(`[faucet] ✓ funded ${to}`);
