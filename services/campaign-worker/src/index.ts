/**
 * Campaign settlement worker: polls known campaigns (from the indexer) and
 * drives expireCampaign / refund on-chain when due. Both functions are
 * permissionless by design, so this worker holds an ordinary funded key.
 * Env: STEP_RPC_URL, STEP_CHAIN_ID, STEP_DEPLOYMENTS_FILE, INDEXER_URL,
 * WORKER_PRIVATE_KEY, WORKER_INTERVAL_MS.
 */
import { readFileSync } from "node:fs";
import { createPublicClient, createWalletClient, defineChain, http, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { CampaignRegistryAbi, RewardPoolAbi } from "@step/shared-types/abis";
import type { Hex } from "@step/shared-types";
import { shouldExpire, shouldRefund } from "./expiry.js";

function env(key: string): string {
  const v = process.env[key];
  if (!v) throw new Error(`missing env ${key}`);
  return v;
}

const deployments = JSON.parse(readFileSync(env("STEP_DEPLOYMENTS_FILE"), "utf8"));
const chain = defineChain({
  id: Number(env("STEP_CHAIN_ID")),
  name: "step-internal",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [env("STEP_RPC_URL")] } },
});
const publicClient = createPublicClient({ chain, transport: http() });
const account = privateKeyToAccount(env("WORKER_PRIVATE_KEY") as Hex);
const wallet = createWalletClient({ chain, transport: http(), account });
const registry = deployments.CampaignRegistry as Address;
const pool = deployments.RewardPool as Address;
const indexerUrl = env("INDEXER_URL");

async function tick() {
  try {
    const campaigns = (await (await fetch(`${indexerUrl}/v1/campaigns`)).json()) as {
      campaign_id: Hex;
    }[];
    const nowUnix = BigInt(Math.floor(Date.now() / 1000));
    for (const { campaign_id } of campaigns) {
      const onChain = (await publicClient.readContract({
        address: registry,
        abi: CampaignRegistryAbi,
        functionName: "getCampaign",
        args: [campaign_id],
      })) as { status: number; endsAt: bigint; budget: bigint; released: bigint; refunded: bigint };

      if (shouldExpire(onChain, nowUnix)) {
        const tx = await wallet.writeContract({
          address: registry,
          abi: CampaignRegistryAbi,
          functionName: "expireCampaign",
          args: [campaign_id],
        });
        console.log(`expired ${campaign_id}: ${tx}`);
      } else if (shouldRefund(onChain)) {
        const tx = await wallet.writeContract({
          address: pool,
          abi: RewardPoolAbi,
          functionName: "refund",
          args: [campaign_id],
        });
        console.log(`refunded ${campaign_id}: ${tx}`);
      }
    }
  } catch (err) {
    console.error("worker tick error:", err instanceof Error ? err.message : err);
  }
}

const interval = Number(process.env.WORKER_INTERVAL_MS ?? 15_000);
console.log(`campaign-worker polling every ${interval} ms`);
setInterval(tick, interval);
void tick();
