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

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const RUNTIME = join(ROOT, ".runtime");
const LOGS = join(RUNTIME, "logs");
const PID_FILE = join(RUNTIME, "pids.json");
const PATH_EXT = `${process.env.HOME}/.cargo/bin:${process.env.HOME}/.foundry/bin:${process.env.PATH}`;

// Anvil deterministic accounts (test chain only).
const ANVIL_KEYS = {
  admin: "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80", // acct 0
  relayer: "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d", // acct 1
  worker: "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a", // acct 2
};
const VALIDATOR_KEYS = [
  "0x1111111111111111111111111111111111111111111111111111111111111111",
  "0x2222222222222222222222222222222222222222222222222222222222222222",
  "0x3333333333333333333333333333333333333333333333333333333333333333",
];

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

  // 1. Generated secrets for this run (never committed).
  const secrets = {
    GATEWAY_NONCE_SECRET: randomBytes(24).toString("hex"),
    MERCHANT_QR_SECRET: randomBytes(24).toString("hex"),
    FOUNDATION_API_TOKEN: randomBytes(24).toString("hex"),
    EVIDENCE_MASTER_KEY: randomBytes(32).toString("hex"),
  };

  // 2. Anvil.
  log("starting anvil…");
  start("anvil", "anvil", ["--port", String(PORTS.anvil), "--chain-id", "31337", "--silent"], {});
  await portOpen(PORTS.anvil);

  // 3. Deploy contracts (param delay 0 for dev so admin can tune live).
  log("deploying contracts…");
  sh(
    `forge script script/Deploy.s.sol --rpc-url http://127.0.0.1:${PORTS.anvil} --broadcast`,
    {
      cwd: join(ROOT, "contracts"),
      env: { ...process.env, PATH: PATH_EXT, DEPLOYER_PRIVATE_KEY: ANVIL_KEYS.admin, STEP_PARAM_DELAY: "0" },
    },
  );
  const deployments = JSON.parse(
    readFileSync(join(ROOT, "contracts/deployments/31337.json"), "utf8"),
  );
  log(`deployed; verifier ${deployments.MiningClaimVerifier}`);

  // 4. Register the three protocol validators on-chain (weight 50, quorum 100).
  log("registering validators on-chain…");
  for (const pk of VALIDATOR_KEYS) {
    const addr = sh(`cast wallet address ${pk}`);
    sh(
      `cast send ${deployments.ValidatorRegistry} "registerValidator(address,uint8,uint32)" ${addr} 5 50 ` +
        `--rpc-url http://127.0.0.1:${PORTS.anvil} --private-key ${ANVIL_KEYS.admin}`,
    );
  }

  // 5. Write the runtime env file (operator + smoke test read this).
  const deployFile = join(ROOT, "contracts/deployments/31337.json");
  const envLines = {
    STEP_CHAIN_ID: "31337",
    STEP_RPC_URL: `http://127.0.0.1:${PORTS.anvil}`,
    STEP_DEPLOYMENTS_FILE: deployFile,
    STEP_PROTOCOL_PARAMS: join(ROOT, "config/protocol-params.alpha.json"),
    RELAYER_PRIVATE_KEY: ANVIL_KEYS.relayer,
    WORKER_PRIVATE_KEY: ANVIL_KEYS.worker,
    VALIDATOR_URLS: PORTS.validators.map((p) => `http://127.0.0.1:${p}`).join(","),
    GATEWAY_URL: `http://127.0.0.1:${PORTS.gateway}`,
    MESH_API_URL: `http://127.0.0.1:${PORTS.validators[0]}`,
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
      STEP_CHAIN_ID: "31337",
      VERIFIER_CONTRACT_ADDRESS: deployments.MiningClaimVerifier,
      VALIDATOR_PRIVATE_KEY: VALIDATOR_KEYS[i],
      GATEWAY_NONCE_SECRET: secrets.GATEWAY_NONCE_SECRET,
      VALIDATOR_ALLOW_DEV_CLAIMS: "true", // local dev only; pilot nodes set false
      STEP_PROTOCOL_PARAMS: envLines.STEP_PROTOCOL_PARAMS,
      STEP_CORS_ORIGINS: envLines.STEP_CORS_ORIGINS, // browsers read /v1/mesh/cover
    });
  });
  await Promise.all(PORTS.validators.map((p) => httpOk(`http://127.0.0.1:${p}/healthz`)));

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
