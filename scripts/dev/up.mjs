#!/usr/bin/env node
/**
 * STEP pilot bring-up (native, Docker-independent).
 *
 * Launches the full backend pilot stack in dependency order and leaves it
 * running for an operator / the iOS app / the web apps to connect to:
 *
 *   anvil → deploy contracts → register validators → 3 validator nodes →
 *   gateway-api → indexer → proof-storage → merchant-api → exchange-service →
 *   campaign-worker
 *
 * Secrets (nonce/QR/foundation token/evidence key) are generated per run and
 * written to .runtime/.env.runtime — never committed. PIDs and logs go under
 * .runtime/ so `scripts/dev/down.mjs` can stop everything.
 *
 * Usage:  node scripts/dev/up.mjs            # start the stack
 *         node scripts/dev/smoke.mjs         # verify a running stack
 *         node scripts/dev/down.mjs          # stop the stack
 *
 * This is the alpha topology (ADR-005/006): single internal Anvil chain,
 * gateway-mediated claims, foundation-operated validators. The same wiring is
 * containerised in infra/deployment for a real pilot host.
 */
import { spawn, execSync } from "node:child_process";
import { mkdirSync, writeFileSync, readFileSync, openSync, existsSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import net from "node:net";
import { assertSafeHosts } from "../lib/net-guard.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const RUNTIME = join(ROOT, ".runtime");
const LOGS = join(RUNTIME, "logs");
const PID_FILE = join(RUNTIME, "pids.json");
const PATH_EXT = `${process.env.HOME}/.cargo/bin:${process.env.HOME}/.foundry/bin:${process.env.PATH}`;

// Chain funding accounts. These are the local chain's pre-funded accounts (it
// pays its own gas); the user's value lives in their own wallets + the persisted
// chain state, not these. Admin/relayer/worker MUST be funded on the chain, so
// they are the chain's genesis accounts.
const ANVIL_KEYS = {
  admin: "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80", // acct 0
  relayer: "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d", // acct 1
  worker: "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a", // acct 2
};

const SECRETS_FILE = join(RUNTIME, "secrets.json");
const STATE_FILE = join(RUNTIME, "anvil-state.json");
const ACCOUNT_DB = join(RUNTIME, "account.db");

/**
 * Durable secrets + validator identities. Generated ONCE and reused across
 * restarts so sessions, the nonce HMAC, and validator addresses are stable (a
 * fresh set each run is the "demo" behaviour we are removing). Stored under
 * .runtime/ (gitignored), never committed.
 */
/** This machine's Tailscale IPv4, or null if Tailscale isn't available. Used to
 *  expose the chain RPC to trust-center nodes on the tailnet. Best-effort. */
function tailnetIp() {
  const candidates = [
    "tailscale",
    "/Applications/Tailscale.app/Contents/MacOS/Tailscale",
    "/usr/local/bin/tailscale",
  ];
  for (const bin of candidates) {
    try {
      const ip = execSync(`${bin} ip -4`, { stdio: "pipe" }).toString().trim().split("\n")[0].trim();
      if (/^\d+\.\d+\.\d+\.\d+$/.test(ip)) return ip;
    } catch {
      /* try next */
    }
  }
  return null;
}

function loadOrCreateSecrets() {
  if (existsSync(SECRETS_FILE)) return JSON.parse(readFileSync(SECRETS_FILE, "utf8"));
  const s = {
    GATEWAY_NONCE_SECRET: randomBytes(24).toString("hex"),
    MERCHANT_QR_SECRET: randomBytes(24).toString("hex"),
    FOUNDATION_API_TOKEN: randomBytes(24).toString("hex"),
    EVIDENCE_MASTER_KEY: randomBytes(32).toString("hex"),
    SESSION_SIGNING_KEY: randomBytes(32).toString("hex"),
    VALIDATOR_KEYS: [0, 1, 2].map(() => `0x${randomBytes(32).toString("hex")}`),
  };
  writeFileSync(SECRETS_FILE, JSON.stringify(s, null, 2) + "\n");
  return s;
}

const PORTS = {
  anvil: 8545,
  validators: [9101, 9102, 9103],
  gateway: 8080,
  indexer: 8090,
  proofStorage: 8095,
  exchange: 8096,
  merchant: 8097,
  account: 8091,
  nftIndexer: 8092,
  fleet: 8099,
};

const procs = [];

function log(msg) {
  process.stdout.write(`[up] ${msg}\n`);
}

function sh(cmd, opts = {}) {
  return execSync(cmd, { stdio: "pipe", env: { ...process.env, PATH: PATH_EXT }, ...opts })
    .toString()
    .trim();
}

async function portOpen(port, timeoutMs = 60_000) {
  const start = Date.now();
  for (;;) {
    const ok = await new Promise((resolve) => {
      const sock = net.connect(port, "127.0.0.1");
      sock.once("connect", () => {
        sock.destroy();
        resolve(true);
      });
      sock.once("error", () => resolve(false));
    });
    if (ok) return;
    if (Date.now() - start > timeoutMs) throw new Error(`timeout waiting for :${port}`);
    await new Promise((r) => setTimeout(r, 250));
  }
}

async function httpOk(url, timeoutMs = 60_000) {
  const start = Date.now();
  for (;;) {
    try {
      const r = await fetch(url);
      if (r.ok) return;
    } catch {
      /* not up */
    }
    if (Date.now() - start > timeoutMs) throw new Error(`timeout waiting for ${url}`);
    await new Promise((r) => setTimeout(r, 300));
  }
}

function start(name, command, args, env) {
  const out = openSync(join(LOGS, `${name}.log`), "a");
  const child = spawn(command, args, {
    cwd: ROOT,
    env: { ...process.env, PATH: PATH_EXT, ...env },
    stdio: ["ignore", out, out],
    detached: true,
  });
  child.unref();
  procs.push({ name, pid: child.pid });
  log(`started ${name} (pid ${child.pid}) → .runtime/logs/${name}.log`);
  return child;
}

async function main() {
  if (existsSync(PID_FILE)) {
    log("found existing .runtime/pids.json — run `node scripts/dev/down.mjs` first");
    process.exit(1);
  }
  mkdirSync(LOGS, { recursive: true });

  // 1. Durable secrets + validator identities (generated once, reused).
  const secrets = loadOrCreateSecrets();
  const VALIDATOR_KEYS = secrets.VALIDATOR_KEYS;

  // 2. Chain target: the dev anvil (default) OR the sovereign evmd chain
  //    (STEP_USE_EVMD=1 — Phase 1 cutover, ADR-024). evmd is already running and
  //    has STEP deployed, so for it we SKIP anvil/deploy and instead prep it
  //    idempotently: register the validators on its ValidatorRegistry and fund the
  //    relayer with atest gas (an EVM transfer from the deployer dev0).
  const EVMD = process.env.STEP_USE_EVMD === "1";
  const CHAIN_ID = EVMD ? "262144" : "31337";
  const CHAIN_RPC = EVMD ? "http://127.0.0.1:8645" : `http://127.0.0.1:${PORTS.anvil}`;
  const deployFile = join(ROOT, `contracts/deployments/${CHAIN_ID}.json`);
  const codeAt = (addr) => sh(`cast code ${addr} --rpc-url ${CHAIN_RPC}`).replace(/\s/g, "");
  let deployments;
  let adminKey = ANVIL_KEYS.admin; // dev: holds the privileged roles (evmd: dev0)

  if (!EVMD) {
    log(existsSync(STATE_FILE) ? "starting anvil (loading saved state)…" : "starting anvil…");
    const anvilHosts = (process.env.STEP_ANVIL_HOSTS ?? ["127.0.0.1", tailnetIp()].filter(Boolean).join(","))
      .split(",").map((h) => h.trim()).filter(Boolean);
    // #62: the dev chain is funded by the public Hardhat key — never bind it to a
    // public interface (or 0.0.0.0) without an explicit, loudly-warned override.
    assertSafeHosts(anvilHosts, { allowPublic: process.env.STEP_ALLOW_PUBLIC_ANVIL === "1", warn: log });
    const anvilArgs = [
      "--port", String(PORTS.anvil), "--chain-id", "31337", "--silent",
      ...anvilHosts.flatMap((h) => ["--host", h]),
      "--state", STATE_FILE, "--state-interval", "2",
    ];
    start("anvil", "anvil", anvilArgs, {});
    if (anvilHosts.length > 1) log(`chain RPC exposed on: ${anvilHosts.join(", ")} :${PORTS.anvil}`);
    await portOpen(PORTS.anvil);

    const alreadyDeployed = existsSync(deployFile) && (() => {
      try {
        const d = JSON.parse(readFileSync(deployFile, "utf8"));
        return d.MiningClaimVerifier && codeAt(d.MiningClaimVerifier) !== "0x";
      } catch { return false; }
    })();
    if (alreadyDeployed) {
      deployments = JSON.parse(readFileSync(deployFile, "utf8"));
      log(`reusing deployed contracts; verifier ${deployments.MiningClaimVerifier}`);
    } else {
      log("deploying contracts…");
      sh(`forge script script/Deploy.s.sol --rpc-url ${CHAIN_RPC} --broadcast`, {
        cwd: join(ROOT, "contracts"),
        env: { ...process.env, PATH: PATH_EXT, DEPLOYER_PRIVATE_KEY: ANVIL_KEYS.admin, STEP_PARAM_DELAY: "0" },
      });
      deployments = JSON.parse(readFileSync(deployFile, "utf8"));
      log(`deployed; verifier ${deployments.MiningClaimVerifier}`);
      log("registering validators on-chain…");
      for (const pk of VALIDATOR_KEYS) {
        const addr = sh(`cast wallet address ${pk}`);
        sh(`cast send ${deployments.ValidatorRegistry} "registerValidator(address,uint8,uint32)" ${addr} 5 50 ` +
          `--rpc-url ${CHAIN_RPC} --private-key ${ANVIL_KEYS.admin}`);
      }
    }
  } else {
    // --- sovereign evmd chain (Phase 1 cutover) ---
    if (!existsSync(deployFile)) throw new Error(`evmd deployments ${deployFile} missing — deploy STEP to evmd first`);
    deployments = JSON.parse(readFileSync(deployFile, "utf8"));
    log(`evmd target: STEP on chain ${CHAIN_ID}; verifier ${deployments.MiningClaimVerifier}`);
    const home = process.env.HOME;
    adminKey = "0x" + sh(`${home}/.local/bin/evmd keys unsafe-export-eth-key dev0 --keyring-backend test --home ${home}/.evmd`).trim().replace(/^0x/, "");
    // Fund the relayer with atest gas (an EVM value transfer) if it's low.
    const relayerAddr = sh(`cast wallet address ${ANVIL_KEYS.relayer}`);
    const bal = BigInt((sh(`cast balance ${relayerAddr} --rpc-url ${CHAIN_RPC}`).trim() || "0"));
    if (bal < 10n ** 18n) {
      log("funding relayer with atest on evmd…");
      sh(`cast send ${relayerAddr} --value 100000000000000000000 --private-key ${adminKey} --rpc-url ${CHAIN_RPC} --legacy`);
    }
    log("registering validators on evmd (idempotent)…");
    for (const pk of VALIDATOR_KEYS) {
      const addr = sh(`cast wallet address ${pk}`);
      const w = (sh(`cast call ${deployments.ValidatorRegistry} "activeWeight(address)(uint256)" ${addr} --rpc-url ${CHAIN_RPC}`).trim().split(/\s/)[0]) || "0";
      if (w !== "0") { log(`  ${addr} already registered (weight ${w})`); continue; }
      sh(`cast send ${deployments.ValidatorRegistry} "registerValidator(address,uint8,uint32)" ${addr} 5 50 ` +
        `--rpc-url ${CHAIN_RPC} --private-key ${adminKey} --legacy`);
      log(`  registered ${addr}`);
    }
  }

  // 4b. Additive M8 upgrade: if the trust-update contracts aren't on this
  //     (possibly persisted) chain yet, deploy them WITHOUT touching existing
  //     state, and merge their addresses into the address book.
  const hasReleaseRegistry =
    deployments.ReleaseRegistry && codeAt(deployments.ReleaseRegistry) !== "0x";
  if (!hasReleaseRegistry) {
    log("upgrading: deploying ReleaseRegistry + IntegrityAttestation (M8)…");
    const out = sh(
      `forge script script/UpgradeM8.s.sol --rpc-url ${CHAIN_RPC} --broadcast`,
      {
        cwd: join(ROOT, "contracts"),
        env: {
          ...process.env,
          PATH: PATH_EXT,
          DEPLOYER_PRIVATE_KEY: adminKey,
          STEP_ACCESS: deployments.StepAccess,
          VALIDATOR_REGISTRY: deployments.ValidatorRegistry,
        },
      },
    );
    const grab = (name) => (out.match(new RegExp(`${name}\\s+(0x[0-9a-fA-F]{40})`)) || [])[1];
    deployments.ReleaseRegistry = grab("ReleaseRegistry");
    deployments.IntegrityAttestation = grab("IntegrityAttestation");
    if (!deployments.ReleaseRegistry) throw new Error("UpgradeM8 did not report a ReleaseRegistry address");
    writeFileSync(deployFile, JSON.stringify(deployments, null, 2) + "\n");
    log(`  ReleaseRegistry ${deployments.ReleaseRegistry}`);
    log(`  IntegrityAttestation ${deployments.IntegrityAttestation}`);
  }

  // 5. Write the runtime env file (operator + smoke test read this).
  const envLines = {
    STEP_CHAIN_ID: CHAIN_ID,
    STEP_RPC_URL: CHAIN_RPC,
    STEP_DEPLOYMENTS_FILE: deployFile,
    STEP_PROTOCOL_PARAMS: join(ROOT, "config/protocol-params.alpha.json"),
    RELAYER_PRIVATE_KEY: ANVIL_KEYS.relayer,
    WORKER_PRIVATE_KEY: ANVIL_KEYS.worker,
    RELEASE_REGISTRY: deployments.ReleaseRegistry,
    INTEGRITY_ATTESTATION: deployments.IntegrityAttestation,
    RELEASE_SIGNER_KEY: adminKey, // dev: admin holds RELEASE_ROLE (prod: timelock)
    STEP_ADMIN_KEY: adminKey,
    VALIDATOR_URLS: PORTS.validators.map((p) => `http://127.0.0.1:${p}`).join(","),
    GATEWAY_URL: `http://127.0.0.1:${PORTS.gateway}`,
    MESH_API_URL: `http://127.0.0.1:${PORTS.validators[0]}`,
    // Federation directory: trust-center nodes (incl. the base 3) the gateway
    // fans claims out to. `scripts/node/join.mjs` appends new nodes here.
    NODE_DIRECTORY_FILE: join(RUNTIME, "nodes.json"),
    INDEXER_URL: `http://127.0.0.1:${PORTS.indexer}`,
    PROOF_STORAGE_URL: `http://127.0.0.1:${PORTS.proofStorage}`,
    EXCHANGE_URL: `http://127.0.0.1:${PORTS.exchange}`,
    MERCHANT_API_URL: `http://127.0.0.1:${PORTS.merchant}`,
    STEP_CORS_ORIGINS:
      process.env.STEP_CORS_ORIGINS ??
      // web-app (3020) + web-miner/explorer (3010) on both localhost and 127.0.0.1
      "http://localhost:3020,http://127.0.0.1:3020,http://localhost:3010,http://127.0.0.1:3010",
    ...secrets,
  };
  writeFileSync(
    join(RUNTIME, ".env.runtime"),
    Object.entries(envLines).map(([k, v]) => `${k}=${v}`).join("\n") + "\n",
  );

  // 6. Build the validator node once (release), then launch three.
  log("building validator-node (release)…");
  sh("cargo build -p step-validator-node --release");
  const validatorBin = join(ROOT, "target/release/step-validator-node");
  PORTS.validators.forEach((port, i) => {
    start(`validator-${i}`, validatorBin, [], {
      VALIDATOR_PORT: String(port),
      STEP_CHAIN_ID: CHAIN_ID,
      VERIFIER_CONTRACT_ADDRESS: deployments.MiningClaimVerifier,
      VALIDATOR_PRIVATE_KEY: VALIDATOR_KEYS[i],
      GATEWAY_NONCE_SECRET: secrets.GATEWAY_NONCE_SECRET,
      VALIDATOR_ALLOW_DEV_CLAIMS: "true", // local dev only; pilot nodes set false
      STEP_PROTOCOL_PARAMS: envLines.STEP_PROTOCOL_PARAMS,
      STEP_CORS_ORIGINS: envLines.STEP_CORS_ORIGINS, // browsers read /v1/mesh/cover
    });
  });
  await Promise.all(PORTS.validators.map((p) => httpOk(`http://127.0.0.1:${p}/healthz`)));

  // Seed/refresh the federation directory with the 3 base trust centers
  // (Protocol class, weight 50), MERGING with any nodes added via `node join` so
  // they survive a restart. `node list`/`node join` read and extend this file.
  const baseNodes = PORTS.validators.map((port, i) => ({
    name: `validator-${i}`,
    address: sh(`cast wallet address ${VALIDATOR_KEYS[i]}`).toLowerCase(),
    url: `http://127.0.0.1:${port}`,
    weight: 50,
    type: "Protocol",
    location: "this-machine",
    status: "active",
  }));
  const baseAddrs = new Set(baseNodes.map((n) => n.address));
  const existingExtra = existsSync(envLines.NODE_DIRECTORY_FILE)
    ? (JSON.parse(readFileSync(envLines.NODE_DIRECTORY_FILE, "utf8")).nodes ?? []).filter(
        (n) => !baseAddrs.has((n.address ?? "").toLowerCase()),
      )
    : [];
  writeFileSync(
    envLines.NODE_DIRECTORY_FILE,
    JSON.stringify({ nodes: [...baseNodes, ...existingExtra] }, null, 2) + "\n",
  );

  // 7. TypeScript services via tsx.
  const tsService = (name, dir, port, extraEnv) => {
    start(name, "pnpm", ["--filter", `@step/${name}`, "exec", "tsx", "src/index.ts"], {
      ...envLines,
      ...extraEnv,
    });
    return httpOk(`http://127.0.0.1:${port}/healthz`);
  };

  log("starting services…");
  start("proof-storage", "pnpm", ["--filter", "@step/proof-storage", "exec", "tsx", "src/index.ts"], {
    ...envLines,
    PROOF_STORAGE_PORT: String(PORTS.proofStorage),
  });
  await httpOk(`http://127.0.0.1:${PORTS.proofStorage}/healthz`);

  start("gateway-api", "pnpm", ["--filter", "@step/gateway-api", "exec", "tsx", "src/index.ts"], {
    ...envLines,
    GATEWAY_PORT: String(PORTS.gateway),
  });
  await httpOk(`http://127.0.0.1:${PORTS.gateway}/healthz`);

  start("indexer", "pnpm", ["--filter", "@step/indexer", "exec", "tsx", "src/index.ts"], {
    ...envLines,
    INDEXER_PORT: String(PORTS.indexer),
  });
  await httpOk(`http://127.0.0.1:${PORTS.indexer}/healthz`);

  start("merchant-api", "pnpm", ["--filter", "@step/merchant-api", "exec", "tsx", "src/index.ts"], {
    ...envLines,
    MERCHANT_API_PORT: String(PORTS.merchant),
  });
  await httpOk(`http://127.0.0.1:${PORTS.merchant}/healthz`);

  start("exchange-service", "pnpm", ["--filter", "@step/exchange-service", "exec", "tsx", "src/index.ts"], {
    ...envLines,
    EXCHANGE_PORT: String(PORTS.exchange),
  });
  await httpOk(`http://127.0.0.1:${PORTS.exchange}/healthz`);

  start("campaign-worker", "pnpm", ["--filter", "@step/campaign-worker", "exec", "tsx", "src/index.ts"], {
    ...envLines,
    WORKER_INTERVAL_MS: "15000",
  });

  // account-api (#12): zero-knowledge wallet vault + login wall backend.
  start("account-api", "pnpm", ["--filter", "@step/account-api", "exec", "tsx", "src/index.ts"], {
    ...envLines,
    ACCOUNT_PORT: String(PORTS.account),
    SECURE_COOKIES: "false", // local http dev
    COOKIE_SAMESITE: "Lax", // same-site across localhost ports; sent on credentialed fetch
    ACCOUNT_DB_FILE: ACCOUNT_DB, // durable accounts (survive restart)
    SESSION_SIGNING_KEY: secrets.SESSION_SIGNING_KEY, // stable → sessions survive restart
  });
  await httpOk(`http://127.0.0.1:${PORTS.account}/healthz`);

  // nft-indexer (#7/#10/#6): NFT ownership/provenance, listings, metadata.
  // Watches TriangleSlotNFT/TriangleMarketplace; serves an empty projection
  // until those contracts are deployed (#5 wiring).
  start("nft-indexer", "pnpm", ["--filter", "@step/nft-indexer", "exec", "tsx", "src/index.ts"], {
    ...envLines,
    NFT_INDEXER_PORT: String(PORTS.nftIndexer),
  });
  await httpOk(`http://127.0.0.1:${PORTS.nftIndexer}/healthz`);

  // fleet-api (#45): aggregated trust-center fleet health + alerts for the console.
  start("fleet-api", "pnpm", ["--filter", "@step/fleet-api", "exec", "tsx", "src/index.ts"], {
    ...envLines,
    FLEET_PORT: String(PORTS.fleet),
    STEP_QUORUM_THRESHOLD: "100",
  });
  await httpOk(`http://127.0.0.1:${PORTS.fleet}/healthz`);

  writeFileSync(PID_FILE, JSON.stringify(procs, null, 2));

  log("");
  log("STEP pilot stack is UP:");
  log(`  chain     http://127.0.0.1:${PORTS.anvil}`);
  log(`  gateway   http://127.0.0.1:${PORTS.gateway}`);
  log(`  indexer   http://127.0.0.1:${PORTS.indexer}  (explorer data)`);
  log(`  mesh API  http://127.0.0.1:${PORTS.validators[0]}/v1/mesh/resolve`);
  log(`  merchant  http://127.0.0.1:${PORTS.merchant}`);
  log(`  exchange  http://127.0.0.1:${PORTS.exchange}`);
  log(`  account   http://127.0.0.1:${PORTS.account}  (wallet vault / login)`);
  log(`  nft-index http://127.0.0.1:${PORTS.nftIndexer}  (NFT + marketplace)`);
  log(`  fleet     http://127.0.0.1:${PORTS.fleet}/v1/fleet  (trust-center fleet health)`);
  log("");
  log("verify:  node scripts/dev/smoke.mjs");
  log("stop:    node scripts/dev/down.mjs");
}

main().catch((err) => {
  console.error(`[up] FAILED: ${err.message}`);
  try {
    writeFileSync(PID_FILE, JSON.stringify(procs, null, 2));
  } catch {
    /* best effort */
  }
  process.exit(1);
});
