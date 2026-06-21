/**
 * Pilot smoke test: exercises a RUNNING stack (started by scripts/dev/up.mjs)
 * end-to-end and asserts the go-live-critical paths. Unlike full-system.test.ts
 * (which spawns its own stack), this verifies the operator's live deployment.
 *
 * Run via: node scripts/dev/smoke.mjs   (wraps `pnpm --filter @step/e2e exec tsx src/smoke.ts`)
 * Exits non-zero on any failure.
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createPublicClient,
  defineChain,
  http,
  keccak256,
  stringToBytes,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { TrinityTokenAbi, FoundationTreasuryAbi } from "@step/shared-types/abis";
import { buildUnsignedClaim, signClaim } from "@step/proof-protocol";
import { gatewayClient, indexerClient, meshClient, merchantClient } from "@step/api-client";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");

function loadRuntimeEnv(): Record<string, string> {
  const raw = readFileSync(join(ROOT, ".runtime/.env.runtime"), "utf8");
  const env: Record<string, string> = {};
  for (const line of raw.split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) env[m[1]!] = m[2]!;
  }
  return env;
}

const env = loadRuntimeEnv();
const deployments = JSON.parse(readFileSync(env.STEP_DEPLOYMENTS_FILE!, "utf8")) as Record<string, Address>;

const chain = defineChain({
  id: 31337,
  name: "step-pilot",
  nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [env.STEP_RPC_URL!] } },
});
const pub = createPublicClient({ chain, transport: http() });

const gw = gatewayClient(env.GATEWAY_URL!);
const mesh = meshClient(env.MESH_API_URL!);
const idx = indexerClient(env.INDEXER_URL!);
const merchant = merchantClient(env.MERCHANT_API_URL!);

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  if (ok) {
    console.log(`  ✓ ${name}`);
  } else {
    console.log(`  ✗ ${name}  ${detail}`);
    failures++;
  }
}

async function health() {
  console.log("health endpoints:");
  for (const [name, url] of [
    ["gateway", env.GATEWAY_URL],
    ["indexer", env.INDEXER_URL],
    ["proof-storage", env.PROOF_STORAGE_URL],
    ["exchange", env.EXCHANGE_URL],
    ["merchant-api", env.MERCHANT_API_URL],
    ["mesh/validator", env.MESH_API_URL],
  ] as const) {
    try {
      const r = await fetch(`${url}/healthz`);
      check(`${name} healthy`, r.ok, `HTTP ${r.status}`);
    } catch (e) {
      check(`${name} healthy`, false, (e as Error).message);
    }
  }
}

async function naturalMine() {
  console.log("natural mining flow:");
  const miner = privateKeyToAccount(("0x" + "5a".repeat(32)) as Hex);
  const lat = 47.4979, lon = 19.0402;
  const tri = await mesh.resolve(lat, lon, 21);
  check("mesh resolves a level-21 triangle", tri.triangle_id.split(".").length === 21);

  // Mesh v2: a triangle at level N>1 is only mineable once its parent is
  // Exhausted, so the miner mines the deepest currently-mineable ANCESTOR of its
  // location (the mining frontier), which the gateway resolves on-chain.
  const frontierResp = await fetch(`${env.GATEWAY_URL}/v1/mesh/mineable?lat=${lat}&lon=${lon}`);
  const frontier = (await frontierResp.json()) as { triangle_id: string; level: number; mineable: boolean };
  check("gateway resolves a mineable frontier", frontier.mineable === true, JSON.stringify(frontier));

  const { nonce } = await gw.nonce(miner.address);
  const claim = await signClaim(
    buildUnsignedClaim({
      wallet: miner.address,
      triangleId: frontier.triangle_id,
      meshLevel: frontier.level,
      latitude: lat,
      longitude: lon,
      horizontalAccuracyM: 5,
      nonce,
    }),
    miner,
  );
  const record = await gw.submitClaim(claim);
  check("claim finalised on-chain", record.status === "finalised", JSON.stringify(record.reject_reasons));

  const bal = (await pub.readContract({
    address: deployments.TrinityToken!,
    abi: TrinityTokenAbi,
    functionName: "balanceOf",
    args: [miner.address],
  })) as bigint;
  check("miner received Trinity", bal > 0n, `balance=${bal}`);

  const twin = (await pub.readContract({
    address: deployments.FoundationTreasury!,
    abi: FoundationTreasuryAbi,
    functionName: "totalTwinMinted",
    args: [],
  })) as bigint;
  check("treasury twin minted", twin > 0n, `twin=${twin}`);

  // Indexer reflects it (poll briefly — 2s poll interval).
  let indexed = false;
  for (let i = 0; i < 10 && !indexed; i++) {
    try {
      const stats = await idx.stats();
      if (Number(stats.claims_finalised) >= 1) indexed = true;
    } catch {
      /* retry */
    }
    if (!indexed) await new Promise((r) => setTimeout(r, 1000));
  }
  check("indexer reflects the finalised claim", indexed);
  return record.claim_hash;
}

async function merchantFlow() {
  console.log("merchant onboarding flow:");
  const reg = (await merchant.register({
    name: "Smoke Café",
    category: "horeca",
    rights_confirmed: true,
  })) as { merchant_id: string; status: string };
  check("merchant registers (pending)", reg.status === "pending");

  // Approve via foundation token.
  const approve = await fetch(`${env.MERCHANT_API_URL}/v1/merchants/${reg.merchant_id}/review`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${env.FOUNDATION_API_TOKEN}` },
    body: JSON.stringify({ approve: true }),
  });
  check("foundation approves merchant", approve.ok);

  const poi = (await merchant.createPoi({
    merchant_id: reg.merchant_id,
    name: "Front door",
    lat: 47.4979,
    lon: 19.0402,
    level: 21,
  })) as { poi_id: string; triangle_id: string };
  check("POI maps to canonical triangle", poi.triangle_id.split(".").length === 21);

  const qr = (await merchant.qr(poi.poi_id)) as { payload: string };
  check("rotating QR issued", qr.payload.startsWith("stepqr1:"));
}

async function exchangeFlow() {
  console.log("closed campaign credits (ADR-011):");
  const grant = await fetch(`${env.EXCHANGE_URL}/v1/credits/grant`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${env.FOUNDATION_API_TOKEN}` },
    body: JSON.stringify({ merchant_id: "smoke_mer", amount_credits: 100 }),
  });
  const grantBody = (await grant.json()) as { disclaimer?: string };
  check("credit grant carries the non-market disclaimer", !!grantBody.disclaimer?.includes("not a market price"));

  const conv = await fetch(`${env.EXCHANGE_URL}/v1/credits/convert`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ merchant_id: "smoke_mer", amount_credits: 2.5 }),
  });
  const convBody = (await conv.json()) as { trinity_budget?: string };
  check("credits convert to whole Trinity", convBody.trinity_budget === "250000000", `got ${convBody.trinity_budget}`);
}

async function main() {
  console.log("STEP pilot smoke test\n");
  await health();
  await naturalMine();
  await merchantFlow();
  await exchangeFlow();
  console.log("");
  if (failures === 0) {
    console.log("SMOKE PASSED — pilot stack is serving end-to-end.");
  } else {
    console.log(`SMOKE FAILED — ${failures} check(s) failed.`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(`smoke error: ${err.message}`);
  process.exit(1);
});
