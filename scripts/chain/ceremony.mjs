#!/usr/bin/env node
/**
 * ceremony (#58, audit C1) — produce a genesis NOT controlled by public dev keys.
 *
 * The cosmos/evm `local_node.sh` funds the chain from hardcoded public test
 * mnemonics (dev0-3, mykey) — anyone who knows them owns the chain. This builds a
 * fresh genesis from a SECRET, operator-generated key instead, then proves it is
 * clean with `genesis-check` (the same gate CI runs). This is the cutover from the
 * dev-key bootstrap chain to a chain only the real operators control.
 *
 *   node scripts/chain/ceremony.mjs --moniker tribecca \
 *     --home ~/.evmd-ceremony --keyring-backend os
 *
 * Keys: with --keyring-backend os (default) the secret lands in the OS keychain;
 * `file` uses an encrypted file; `test` is plaintext (CI/throwaway only). The
 * private key is NEVER printed or written to the repo — only the public address.
 *
 * Multi-operator: each additional trust center generates its OWN key and gentx on
 * its OWN machine (`evmd genesis gentx …`) and sends only the signed gentx back;
 * drop them in <home>/config/gentx/ before collect — that is real decentralized
 * genesis, no single machine holding every key.
 *
 * Output: <home>/config/genesis.json (clean) + its SHA-256 for distribution.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { publicKeyAddressesIn } from "./genesis-check.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const HOME = process.env.HOME;
const EVMD = process.env.EVMD ?? `${HOME}/.local/bin/evmd`;
const a = process.argv.slice(2);
const flag = (n, d) => { const i = a.indexOf(`--${n}`); return i >= 0 ? a[i + 1] : d; };
const die = (m) => { console.error(`[ceremony] ${m}`); process.exit(1); };
const log = (m) => process.stdout.write(`[ceremony] ${m}\n`);

const moniker = flag("moniker", "operator0");
const chainId = flag("chain-id", "9001");
const denom = flag("denom", "atest");
const home = flag("home", `${HOME}/.evmd-ceremony`);
const keyring = flag("keyring-backend", "os");
const keyName = flag("key", "operator0");
const fresh = a.includes("--fresh");
// Stake + faucet float for the genesis operator (bond denom == --denom).
const fund = flag("fund", "100000000000000000000000000"); // 1e26
const stake = flag("stake", "1000000000000000000000000"); // 1e24

const evmd = (args, opts = {}) =>
  execFileSync(EVMD, args, { stdio: opts.capture ? ["ignore", "pipe", "inherit"] : "inherit",
    encoding: "utf8", ...opts });

if (!existsSync(EVMD)) die(`evmd not found at ${EVMD} (build it: sh scripts/chain/build-evmd.sh)`);
if (fresh && existsSync(home)) { log(`--fresh: removing ${home}`); rmSync(home, { recursive: true, force: true }); }
if (existsSync(join(home, "config", "genesis.json")) && !fresh) {
  die(`${home} already initialised — pass --fresh to rebuild, or use a clean --home`);
}

// 1. Fresh chain home with our denom (no public accounts seeded).
log(`1/6 init ${moniker} (chain-id ${chainId}, denom ${denom}) at ${home}`);
evmd(["init", moniker, "--chain-id", chainId, "--home", home, "--default-denom", denom]);

// 2. Generate the operator's SECRET key (only the address is surfaced).
log(`2/6 generating secret operator key "${keyName}" (keyring: ${keyring})`);
try {
  evmd(["keys", "add", keyName, "--keyring-backend", keyring, "--home", home]);
} catch {
  log(`   key "${keyName}" may already exist in the ${keyring} keyring — reusing it`);
}
const addr = evmd(["keys", "show", keyName, "-a", "--keyring-backend", keyring, "--home", home],
  { capture: true }).trim();
if (!/^cosmos1[0-9a-z]{38,}$/.test(addr)) die(`could not read operator address (got "${addr}")`);
log(`   operator address: ${addr}`);

// 3. Fund it + 4. self-delegation gentx + 5. collect.
log(`3/6 add-genesis-account ${fund}${denom}`);
evmd(["genesis", "add-genesis-account", addr, `${fund}${denom}`, "--home", home]);
log(`4/6 gentx (self-delegate ${stake}${denom})`);
evmd(["genesis", "gentx", keyName, `${stake}${denom}`, "--chain-id", chainId,
  "--keyring-backend", keyring, "--home", home]);
const gentxDir = join(home, "config", "gentx");
log(`   gentx dir holds ${existsSync(gentxDir) ? readdirSync(gentxDir).length : 0} tx(s) — drop other operators' gentx here before collect for multi-operator genesis`);
log(`5/6 collect-gentxs + validate`);
evmd(["genesis", "collect-gentxs", "--home", home]);
evmd(["genesis", "validate", "--home", home]);

// 6. Prove it is clean (the #58 invariant) and emit the distribution hash.
const genesisPath = join(home, "config", "genesis.json");
const genesis = JSON.parse(readFileSync(genesisPath, "utf8"));
const flagged = publicKeyAddressesIn(genesis);
if (flagged.length) die(`genesis is controlled by PUBLIC keys: ${flagged.join(", ")} — aborting`);
const sha = createHash("sha256").update(readFileSync(genesisPath)).digest("hex");

log("");
log(`✓ clean secret-key genesis (no public dev keys): ${genesisPath}`);
log(`  sha256:  ${sha}`);
log(`  operator: ${addr}  (key "${keyName}" in the ${keyring} keyring — never committed)`);
log("");
log("  Cutover (RETIRES the dev-key chain — current ledger state is replaced):");
log(`    launchctl bootout gui/$(id -u)/app.step.chain 2>/dev/null || true`);
log(`    cp "${genesisPath}" ~/.evmd/config/genesis.json   # + reset state: evmd comet unsafe-reset-all --home ~/.evmd`);
log(`    STEP_EVM_RPC_HOST=0.0.0.0 node scripts/chain/install-chain.mjs`);
log("  Then deploy STEP from a secret key and hand roles to governance (#59):");
log(`    (cd contracts && forge script script/HandoverToGovernance.s.sol --broadcast --rpc-url http://127.0.0.1:8645)`);
