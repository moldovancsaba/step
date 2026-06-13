"use server";

/**
 * Server actions for the merchant dashboard. Merchants are managed accounts in
 * alpha (MER-009/ADR-012): the foundation operates the merchant key, so the
 * dashboard never exposes wallets to business users — they buy verified
 * visits, not crypto (PRD-007).
 *
 * Env: STEP_RPC_URL, STEP_DEPLOYMENTS_FILE, MANAGED_MERCHANT_PRIVATE_KEY,
 * MERCHANT_API_URL, MESH_API_URL, INDEXER_URL, EXCHANGE_URL.
 */
import { readFileSync } from "node:fs";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { CampaignRegistryAbi, RewardPoolAbi, TrinityTokenAbi } from "@step/shared-types/abis";

function env(key: string): string {
  const v = process.env[key];
  if (!v) throw new Error(`missing env ${key}`);
  return v;
}

function chainClients() {
  const deployments = JSON.parse(readFileSync(env("STEP_DEPLOYMENTS_FILE"), "utf8"));
  const chain = defineChain({
    id: 31337,
    name: "step-internal",
    nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [env("STEP_RPC_URL")] } },
  });
  const account = privateKeyToAccount(env("MANAGED_MERCHANT_PRIVATE_KEY") as Hex);
  return {
    deployments,
    pub: createPublicClient({ chain, transport: http() }),
    wallet: createWalletClient({ chain, transport: http(), account }),
    account,
  };
}

export interface ActionResult {
  ok: boolean;
  message: string;
  data?: Record<string, string>;
}

export async function registerMerchant(formData: FormData): Promise<ActionResult> {
  try {
    const resp = await fetch(`${env("MERCHANT_API_URL")}/v1/merchants`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: formData.get("name"),
        category: formData.get("category"),
        rights_confirmed: formData.get("rights_confirmed") === "on",
      }),
    });
    const body = await resp.json();
    if (!resp.ok) return { ok: false, message: body.error ?? `HTTP ${resp.status}` };
    return {
      ok: true,
      message: `Registered ${body.merchant_id} — pending foundation review (alpha is admin-approved).`,
      data: { merchant_id: body.merchant_id },
    };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "failed" };
  }
}

export async function createPoi(formData: FormData): Promise<ActionResult> {
  try {
    const resp = await fetch(`${env("MERCHANT_API_URL")}/v1/pois`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        merchant_id: formData.get("merchant_id"),
        name: formData.get("name"),
        lat: Number(formData.get("lat")),
        lon: Number(formData.get("lon")),
        level: 21,
      }),
    });
    const body = await resp.json();
    if (!resp.ok) return { ok: false, message: body.error ?? `HTTP ${resp.status}` };
    return {
      ok: true,
      message: `POI ${body.poi_id} mapped to triangle ${body.triangle_id}`,
      data: { poi_id: body.poi_id, triangle_id: body.triangle_id, triangle_id_hash: body.triangle_id_hash },
    };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "failed" };
  }
}

/** Create + fund + activate a front-door oasis on-chain with the managed key. */
export async function createCampaign(formData: FormData): Promise<ActionResult> {
  try {
    const { deployments, pub, wallet, account } = chainClients();
    const triangleIdHash = formData.get("triangle_id_hash") as Hex;
    const rewardPerClaim = BigInt(formData.get("reward_per_claim") as string);
    const budget = BigInt(formData.get("budget_trinity") as string);
    const days = BigInt((formData.get("duration_days") as string) || "7");
    const now = BigInt(Math.floor(Date.now() / 1000));

    const { request, result: campaignId } = await pub.simulateContract({
      address: deployments.CampaignRegistry as Address,
      abi: CampaignRegistryAbi,
      functionName: "createCampaign",
      args: [[triangleIdHash], rewardPerClaim, now - 10n, now + days * 86_400n, 1, 4, 0],
      account,
    });
    await pub.waitForTransactionReceipt({ hash: await wallet.writeContract(request) });

    return {
      ok: true,
      message:
        "Campaign created on-chain — pending foundation moderation. Fund it after approval from the campaign list.",
      data: { campaign_id: campaignId as string },
    };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message.slice(0, 300) : "failed" };
  }
}

export async function fundAndActivate(formData: FormData): Promise<ActionResult> {
  try {
    const { deployments, pub, wallet } = chainClients();
    const campaignId = formData.get("campaign_id") as Hex;
    const budget = BigInt(formData.get("budget_trinity") as string);

    const approveTx = await wallet.writeContract({
      address: deployments.TrinityToken as Address,
      abi: TrinityTokenAbi as never,
      functionName: "approve",
      args: [deployments.RewardPool, budget],
    });
    await pub.waitForTransactionReceipt({ hash: approveTx });
    const fundTx = await wallet.writeContract({
      address: deployments.RewardPool as Address,
      abi: RewardPoolAbi as never,
      functionName: "fund",
      args: [campaignId, budget],
    });
    await pub.waitForTransactionReceipt({ hash: fundTx });
    const activateTx = await wallet.writeContract({
      address: deployments.CampaignRegistry as Address,
      abi: CampaignRegistryAbi as never,
      functionName: "activateCampaign",
      args: [campaignId],
    });
    await pub.waitForTransactionReceipt({ hash: activateTx });
    return { ok: true, message: "Campaign funded and ACTIVE — your oasis is live." };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message.slice(0, 300) : "failed" };
  }
}
