"use server";

/**
 * Foundation admin actions (WEB-005): merchant approval, campaign moderation,
 * triangle freeze/unfreeze, emergency pause. Every on-chain action lands as a
 * publicly reviewable event (HARD §11.4). The admin key comes from env —
 * a multisig replaces it before any non-internal deployment (documented gap).
 */
import { readFileSync } from "node:fs";
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
  SafetyRegistryAbi,
  StepAccessAbi,
} from "@step/shared-types/abis";

function env(key: string): string {
  const v = process.env[key];
  if (!v) throw new Error(`missing env ${key}`);
  return v;
}

function clients() {
  const deployments = JSON.parse(readFileSync(env("STEP_DEPLOYMENTS_FILE"), "utf8"));
  const chain = defineChain({
    id: 31337,
    name: "step-internal",
    nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [env("STEP_RPC_URL")] } },
  });
  const account = privateKeyToAccount(env("ADMIN_PRIVATE_KEY") as Hex);
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
}

async function exec(
  fn: (c: ReturnType<typeof clients>) => Promise<string>,
): Promise<ActionResult> {
  try {
    return { ok: true, message: await fn(clients()) };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message.slice(0, 300) : "failed" };
  }
}

export async function reviewMerchant(formData: FormData): Promise<ActionResult> {
  try {
    const id = formData.get("merchant_id");
    const approve = formData.get("decision") === "approve";
    const resp = await fetch(`${env("MERCHANT_API_URL")}/v1/merchants/${id}/review`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${env("FOUNDATION_API_TOKEN")}`,
      },
      body: JSON.stringify({ approve }),
    });
    const body = await resp.json();
    if (!resp.ok) return { ok: false, message: body.error ?? `HTTP ${resp.status}` };
    return { ok: true, message: `Merchant ${id} → ${body.status}` };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "failed" };
  }
}

export async function moderateCampaign(formData: FormData): Promise<ActionResult> {
  const campaignId = formData.get("campaign_id") as Hex;
  const approve = formData.get("decision") === "approve";
  return exec(async ({ deployments, pub, wallet, account }) => {
    const { request } = await pub.simulateContract({
      address: deployments.CampaignRegistry as Address,
      abi: CampaignRegistryAbi,
      functionName: "reviewCampaign",
      args: [campaignId, approve],
      account,
    });
    await pub.waitForTransactionReceipt({ hash: await wallet.writeContract(request) });
    return `Campaign ${campaignId.slice(0, 12)}… ${approve ? "approved" : "rejected"} on-chain.`;
  });
}

export async function freezeTriangle(formData: FormData): Promise<ActionResult> {
  const tid = formData.get("triangle_id_hash") as Hex;
  const reason = (formData.get("reason") as string) || "SAFETY_REVIEW";
  const unfreeze = formData.get("decision") === "unfreeze";
  return exec(async ({ deployments, pub, wallet, account }) => {
    const { request } = await pub.simulateContract({
      address: deployments.SafetyRegistry as Address,
      abi: SafetyRegistryAbi,
      functionName: unfreeze ? "unfreezeTriangle" : "freezeTriangle",
      args: unfreeze ? [tid] : [tid, keccak256(stringToBytes(reason))],
      account,
    });
    await pub.waitForTransactionReceipt({ hash: await wallet.writeContract(request) });
    return `Triangle ${tid.slice(0, 12)}… ${unfreeze ? "unfrozen" : `FROZEN (${reason})`} — event emitted for public review.`;
  });
}

export async function setEmergencyPause(formData: FormData): Promise<ActionResult> {
  const domain = formData.get("domain") as string; // "PAUSE_MINTING" | "PAUSE_CAMPAIGNS"
  const paused = formData.get("decision") === "pause";
  return exec(async ({ deployments, pub, wallet, account }) => {
    const { request } = await pub.simulateContract({
      address: deployments.StepAccess as Address,
      abi: StepAccessAbi,
      functionName: "setPaused",
      args: [keccak256(stringToBytes(domain)), paused],
      account,
    });
    await pub.waitForTransactionReceipt({ hash: await wallet.writeContract(request) });
    return `${domain} ${paused ? "PAUSED" : "resumed"} — drill/incident logged on-chain.`;
  });
}
