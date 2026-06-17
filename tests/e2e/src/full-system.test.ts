/**
 * E2E-1/2/3/5 (test plan §3): the complete vertical slice on real components —
 * miner key signs a claim → gateway nonce → THREE REAL Rust validator nodes
 * independently recompute geometry and sign EIP-712 votes → gateway aggregates
 * quorum → REAL contracts on Anvil finalise → Trinity minted to miner, twin to
 * treasury → fraud rejection (teleport) → safety freeze enforcement →
 * sponsored oasis loop funded from previously-mined supply (TOK-003).
 *
 * This is the alpha's central claim made executable: an iPhone-shaped client
 * can mine a spherical triangle through privacy-safe, quorum-verified,
 * contract-finalised flow.
 *
 * Prerequisites built by the harness: anvil, forge deploy, cargo validator
 * binary. Run: pnpm --filter @step/e2e test  (~1–2 min cold).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execSync, spawn, type ChildProcess } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  keccak256,
  stringToBytes,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  CampaignRegistryAbi,
  FoundationTreasuryAbi,
  RewardPoolAbi,
  SafetyRegistryAbi,
  StepAccessAbi,
  TrinityTokenAbi,
  ValidatorRegistryAbi,
} from "@step/shared-types/abis";
import { buildUnsignedClaim, signClaim } from "@step/proof-protocol";
import { gatewayClient, meshClient } from "@step/api-client";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const RPC = "http://127.0.0.1:18545";
const NONCE_SECRET = "e2e-nonce-secret";

// Anvil's deterministic accounts.
const ADMIN_PK = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as Hex;
const RELAYER_PK = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as Hex;
const MINER_PK = "0x4242424242424242424242424242424242424242424242424242424242424242" as Hex;
const MINER2_PK = "0x4343434343434343434343434343434343434343434343434343434343434343" as Hex;
const VALIDATOR_PKS = [
  "0x1111111111111111111111111111111111111111111111111111111111111111",
  "0x2222222222222222222222222222222222222222222222222222222222222222",
  "0x3333333333333333333333333333333333333333333333333333333333333333",
] as Hex[];

const admin = privateKeyToAccount(ADMIN_PK);
const miner = privateKeyToAccount(MINER_PK);
const miner2 = privateKeyToAccount(MINER2_PK);

const chain = defineChain({
  id: 31337,
  name: "e2e",
  nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [RPC] } },
});
const pub = createPublicClient({ chain, transport: http() });
const adminWallet = createWalletClient({ chain, transport: http(), account: admin });

let deployments: Record<string, Address>;
const procs: ChildProcess[] = [];
const gw = gatewayClient("http://127.0.0.1:18080");
const mesh = meshClient("http://127.0.0.1:19101");

const BUDAPEST = { lat: 47.4979, lon: 19.0402 };
const LONDON = { lat: 51.5074, lon: -0.1278 };

async function waitFor(url: string, timeoutMs = 30_000): Promise<void> {
  const start = Date.now();
  for (;;) {
    try {
      const resp = await fetch(url);
      if (resp.ok) return;
    } catch {
      /* not up yet */
    }
    if (Date.now() - start > timeoutMs) throw new Error(`timeout waiting for ${url}`);
    await new Promise((r) => setTimeout(r, 250));
  }
}

async function write(address: Address, abi: unknown, functionName: string, args: unknown[]) {
  const { request } = await pub.simulateContract({
    address,
    abi: abi as never,
    functionName: functionName as never,
    args: args as never,
    account: admin,
  });
  const hash = await adminWallet.writeContract(request);
  await pub.waitForTransactionReceipt({ hash });
}

beforeAll(async () => {
  const cargoBin = `${process.env.HOME}/.cargo/bin`;
  const foundryBin = `${process.env.HOME}/.foundry/bin`;
  const PATH = `${cargoBin}:${foundryBin}:${process.env.PATH}`;

  // 1. Fresh chain.
  procs.push(
    spawn(`${foundryBin}/anvil`, ["--port", "18545", "--chain-id", "31337"], {
      stdio: "ignore",
    }),
  );
  // anvil has no GET health endpoint; poll eth_blockNumber until it answers.
  for (let i = 0; i < 60; i++) {
    try {
      await pub.getBlockNumber();
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 250));
    }
  }

  // 2. Deploy the full system (param delay 0 so tests can apply params if needed).
  execSync(
    `forge script script/Deploy.s.sol --rpc-url ${RPC} --broadcast`,
    {
      cwd: join(ROOT, "contracts"),
      env: { ...process.env, PATH, DEPLOYER_PRIVATE_KEY: ADMIN_PK, STEP_PARAM_DELAY: "0" },
      stdio: "ignore",
    },
  );
  deployments = JSON.parse(
    readFileSync(join(ROOT, "contracts/deployments/31337.json"), "utf8"),
  );

  // 3. Register the three validator identities on-chain (Protocol type, weight 50).
  for (const pk of VALIDATOR_PKS) {
    const v = privateKeyToAccount(pk);
    await write(deployments.ValidatorRegistry!, ValidatorRegistryAbi, "registerValidator", [
      v.address,
      5, // ValidatorType.Protocol
      50,
    ]);
  }

  // 4. Build + spawn three REAL Rust validator nodes.
  execSync("cargo build -p step-validator-node --release", {
    cwd: ROOT,
    env: { ...process.env, PATH },
    stdio: "ignore",
  });
  VALIDATOR_PKS.forEach((pk, i) => {
    procs.push(
      spawn(join(ROOT, "target/release/step-validator-node"), [], {
        env: {
          ...process.env,
          VALIDATOR_PORT: String(19101 + i),
          STEP_CHAIN_ID: "31337",
          VERIFIER_CONTRACT_ADDRESS: deployments.MiningClaimVerifier!,
          VALIDATOR_PRIVATE_KEY: pk,
          GATEWAY_NONCE_SECRET: NONCE_SECRET,
          VALIDATOR_ALLOW_DEV_CLAIMS: "true",
          STEP_PROTOCOL_PARAMS: join(ROOT, "config/protocol-params.alpha.json"),
        },
        stdio: "ignore",
      }),
    );
  });
  for (let i = 0; i < 3; i++) await waitFor(`http://127.0.0.1:${1910 * 10 + 1 + i}/healthz`);

  // 5. Spawn the gateway.
  procs.push(
    spawn("node", ["--import", "tsx", "src/index.ts"], {
      cwd: join(ROOT, "services/gateway-api"),
      env: {
        ...process.env,
        PATH,
        STEP_RPC_URL: RPC,
        STEP_DEPLOYMENTS_FILE: join(ROOT, "contracts/deployments/31337.json"),
        STEP_PROTOCOL_PARAMS: join(ROOT, "config/protocol-params.alpha.json"),
        RELAYER_PRIVATE_KEY: RELAYER_PK,
        GATEWAY_NONCE_SECRET: NONCE_SECRET,
        VALIDATOR_URLS: "http://127.0.0.1:19101,http://127.0.0.1:19102,http://127.0.0.1:19103",
        GATEWAY_PORT: "18080",
      },
      stdio: "ignore",
    }),
  );
  await waitFor("http://127.0.0.1:18080/healthz");
}, 240_000);

afterAll(() => {
  for (const p of procs) p.kill("SIGKILL");
});

async function mine(account: typeof miner, lat: number, lon: number) {
  const { nonce } = await gw.nonce(account.address);
  const triangle = await mesh.resolve(lat, lon, 1);
  const unsigned = buildUnsignedClaim({
    wallet: account.address,
    triangleId: triangle.triangle_id,
    meshLevel: 1,
    latitude: lat,
    longitude: lon,
    horizontalAccuracyM: 5,
    nonce,
  });
  const claim = await signClaim(unsigned, account);
  return { record: await gw.submitClaim(claim), triangle };
}

describe("E2E full system on real components", () => {
  const BASE_REWARD = 67_108_864n;

  it("E2E-1: natural mining — claim → 3 Rust validators → quorum → on-chain mint + twin", async () => {
    const { record, triangle } = await mine(miner, BUDAPEST.lat, BUDAPEST.lon);
    expect(record.status, JSON.stringify(record.reject_reasons)).toBe("finalised");
    expect(record.tx_hash).toBeDefined();
    expect(record.votes.filter((v) => v.approve).length).toBeGreaterThanOrEqual(2);

    const balance = (await pub.readContract({
      address: deployments.TrinityToken!,
      abi: TrinityTokenAbi,
      functionName: "balanceOf",
      args: [miner.address],
    })) as bigint;
    expect(balance).toBe(BASE_REWARD);

    const twin = (await pub.readContract({
      address: deployments.FoundationTreasury!,
      abi: FoundationTreasuryAbi,
      functionName: "totalTwinMinted",
      args: [],
    })) as bigint;
    expect(twin).toBe(BASE_REWARD); // 100% bootstrap twin

    // Triangle identity on-chain == keccak(triangle id string).
    expect(record.triangle_id_hash).toBe(keccak256(stringToBytes(triangle.triangle_id)));
  }, 120_000);

  it("E2E-3: teleporting miner is rejected by the validators (fraud)", async () => {
    // Same miner claims from London seconds after Budapest: impossible travel.
    const { record } = await mine(miner, LONDON.lat, LONDON.lon);
    expect(record.status).toBe("rejected");
    expect(record.reject_reasons).toContain("fraud_score_too_high");
  }, 60_000);

  it("E2E-3b: replayed nonce is rejected", async () => {
    const { nonce } = await gw.nonce(miner2.address);
    // Distinct base face from E2E-1: at genesis level 1 the 20 icosahedron
    // faces are continental, so Budapest (face 1) is in post-claim cooldown for
    // the whole face (COOLDOWN=3600). Tokyo is on a different north-cap face, so
    // this claim can finalise fresh.
    const spot = { lat: 35.6762, lon: 139.6503 };
    const triangle = await mesh.resolve(spot.lat, spot.lon, 1);
    const make = async (ts: string) =>
      signClaim(
        buildUnsignedClaim({
          wallet: miner2.address,
          triangleId: triangle.triangle_id,
          meshLevel: 1,
          latitude: spot.lat,
          longitude: spot.lon,
          horizontalAccuracyM: 5,
          nonce,
          timestampUtc: ts,
        }),
        miner2,
      );
    const now = new Date();
    const first = await gw.submitClaim(await make(now.toISOString().replace(/\.\d+Z$/, "Z")));
    expect(first.status).toBe("finalised");
    // Different timestamp → different claim hash, but SAME nonce → replay.
    const replay = await gw.submitClaim(
      await make(new Date(now.getTime() + 2000).toISOString().replace(/\.\d+Z$/, "Z")),
    );
    expect(replay.status).toBe("rejected");
    expect(replay.reject_reasons).toContain("nonce_rejected");
  }, 60_000);

  it("E2E-5: safety freeze blocks finalisation at the contract", async () => {
    // Fresh wallet (no teleport history), triangle near Budapest.
    const m3 = privateKeyToAccount(("0x" + "44".repeat(32)) as Hex);
    const spot = { lat: 47.51, lon: 19.05 };
    const triangle = await mesh.resolve(spot.lat, spot.lon, 1);
    const tidHash = keccak256(stringToBytes(triangle.triangle_id));
    await write(deployments.SafetyRegistry!, SafetyRegistryAbi, "freezeTriangle", [
      tidHash,
      keccak256(stringToBytes("SAFETY_TEST")),
    ]);

    const { nonce } = await gw.nonce(m3.address);
    const claim = await signClaim(
      buildUnsignedClaim({
        wallet: m3.address,
        triangleId: triangle.triangle_id,
        meshLevel: 1,
        latitude: spot.lat,
        longitude: spot.lon,
        horizontalAccuracyM: 5,
        nonce,
      }),
      m3,
    );
    const record = await gw.submitClaim(claim);
    // Validators approve the geometry; the CONTRACT enforces the freeze.
    expect(record.status).toBe("rejected");
    expect(record.reject_reasons[0]).toMatch(/^chain_revert:/);

    await write(deployments.SafetyRegistry!, SafetyRegistryAbi, "unfreezeTriangle", [tidHash]);
  }, 60_000);

  it("E2E-2: sponsored oasis loop funded from previously-mined Trinity", async () => {
    // Treasury → merchant: sponsored supply is pre-existing Trinity (TOK-003).
    const merchant = privateKeyToAccount(("0x" + "77".repeat(32)) as Hex);
    const REWARD = 100_000n;
    const BUDGET = 250_000n;

    await write(deployments.StepAccess!, StepAccessAbi, "grantRole", [
      keccak256(stringToBytes("MERCHANT_ROLE")),
      merchant.address,
    ]);
    await write(deployments.FoundationTreasury!, FoundationTreasuryAbi, "withdraw", [
      merchant.address,
      BUDGET,
      keccak256(stringToBytes("PILOT_CAMPAIGN_GRANT")),
    ]);
    // Fund merchant with gas.
    const gasTx = await adminWallet.sendTransaction({
      to: merchant.address,
      value: 10n ** 18n,
    });
    await pub.waitForTransactionReceipt({ hash: gasTx });

    // Merchant creates + funds + activates a front-door oasis at a POI triangle.
    const poi = { lat: 47.4925, lon: 19.0514 }; // different triangle than earlier tests
    const triangle = await mesh.resolve(poi.lat, poi.lon, 1);
    const tidHash = keccak256(stringToBytes(triangle.triangle_id));
    const merchantWallet = createWalletClient({ chain, transport: http(), account: merchant });

    const now = BigInt(Math.floor(Date.now() / 1000));
    const { request: createReq, result: campaignId } = await pub.simulateContract({
      address: deployments.CampaignRegistry!,
      abi: CampaignRegistryAbi,
      functionName: "createCampaign",
      args: [[tidHash], REWARD, now - 10n, now + 86_400n, 1, 4, 0],
      account: merchant,
    });
    await pub.waitForTransactionReceipt({ hash: await merchantWallet.writeContract(createReq) });

    await write(deployments.CampaignRegistry!, CampaignRegistryAbi, "reviewCampaign", [
      campaignId,
      true,
    ]);
    const approveTx = await merchantWallet.writeContract({
      address: deployments.TrinityToken!,
      abi: TrinityTokenAbi as never,
      functionName: "approve",
      args: [deployments.RewardPool!, BUDGET],
    });
    await pub.waitForTransactionReceipt({ hash: approveTx });
    const fundTx = await merchantWallet.writeContract({
      address: deployments.RewardPool!,
      abi: RewardPoolAbi as never,
      functionName: "fund",
      args: [campaignId, BUDGET],
    });
    await pub.waitForTransactionReceipt({ hash: fundTx });
    const activateTx = await merchantWallet.writeContract({
      address: deployments.CampaignRegistry!,
      abi: CampaignRegistryAbi as never,
      functionName: "activateCampaign",
      args: [campaignId],
    });
    await pub.waitForTransactionReceipt({ hash: activateTx });

    // A fresh miner physically "visits" the oasis and claims with campaign_id.
    const visitor = privateKeyToAccount(("0x" + "88".repeat(32)) as Hex);
    const { nonce } = await gw.nonce(visitor.address);
    const claim = await signClaim(
      buildUnsignedClaim({
        wallet: visitor.address,
        triangleId: triangle.triangle_id,
        meshLevel: 1,
        latitude: poi.lat,
        longitude: poi.lon,
        horizontalAccuracyM: 5,
        nonce,
        campaignId: campaignId as string,
      }),
      visitor,
    );
    const supplyBefore = (await pub.readContract({
      address: deployments.TrinityToken!,
      abi: TrinityTokenAbi,
      functionName: "totalSupply",
      args: [],
    })) as bigint;

    const record = await gw.submitClaim(claim);
    expect(record.status, JSON.stringify(record.reject_reasons)).toBe("finalised");

    const visitorBalance = (await pub.readContract({
      address: deployments.TrinityToken!,
      abi: TrinityTokenAbi,
      functionName: "balanceOf",
      args: [visitor.address],
    })) as bigint;
    expect(visitorBalance).toBe(REWARD);

    // Sponsored path NEVER mints (TOK-003): supply unchanged.
    const supplyAfter = (await pub.readContract({
      address: deployments.TrinityToken!,
      abi: TrinityTokenAbi,
      functionName: "totalSupply",
      args: [],
    })) as bigint;
    expect(supplyAfter).toBe(supplyBefore);

    // Merchant report: verified visit recorded on-chain.
    const campaign = (await pub.readContract({
      address: deployments.CampaignRegistry!,
      abi: CampaignRegistryAbi,
      functionName: "getCampaign",
      args: [campaignId],
    })) as { released: bigint };
    expect(campaign.released).toBe(REWARD);
  }, 120_000);
});
