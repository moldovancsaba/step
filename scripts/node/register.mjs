#!/usr/bin/env node
/**
 * register — admit a keyless-installed trust center on-chain (hub side).
 *
 * A node installed via scripts/node/install.sh generates its own key and prints
 * its address; the operator grants it quorum weight here. Nothing secret moves —
 * only the public address.
 *
 *   node scripts/node/register.mjs 0x<address> [--weight 50] [--type Infrastructure]
 *
 * Env: STEP_RPC_URL, STEP_DEPLOYMENTS_FILE (or VALIDATOR_REGISTRY), STEP_ADMIN_KEY.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const TYPES = { Independent: 0, Community: 1, Partner: 2, Foundation: 3, Infrastructure: 4 };
const DEV_ADMIN_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"; // gitleaks:allow — public Anvil account #0, local-dev only
const die = (m) => { console.error(`[register] ${m}`); process.exit(1); };

const argv = process.argv.slice(2);
const address = argv.find((a) => /^0x[0-9a-fA-F]{40}$/.test(a)) || die("pass a 0x<address>");
const flag = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : d; };
const weight = flag("weight", "50");
const typeNum = TYPES[flag("type", "Infrastructure")] ?? die("unknown --type");

const rpcUrl = process.env.STEP_RPC_URL || "http://127.0.0.1:8545";
let registry = process.env.VALIDATOR_REGISTRY;
const depFile = process.env.STEP_DEPLOYMENTS_FILE;
if (!registry && depFile && existsSync(depFile)) {
  registry = JSON.parse(readFileSync(depFile, "utf8")).ValidatorRegistry;
}
registry || die("set VALIDATOR_REGISTRY or STEP_DEPLOYMENTS_FILE");
const adminKey = process.env.STEP_ADMIN_KEY || DEV_ADMIN_KEY;

const cast = `${process.env.HOME}/.foundry/bin/cast`;
const bin = existsSync(cast) ? cast : "cast";
console.log(`[register] registering ${address} (type ${typeNum}, weight ${weight})…`);
execFileSync(bin, [
  "send", registry, "registerValidator(address,uint8,uint32)", address, String(typeNum), String(weight),
  "--rpc-url", rpcUrl, "--private-key", adminKey,
], { stdio: "inherit" });
console.log(`[register] ✓ ${address} admitted. It will appear 'up' once it heartbeats.`);
