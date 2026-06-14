import { NextResponse } from "next/server";
import { readFileSync } from "node:fs";
import { createPublicClient, defineChain, http, type Address } from "viem";
import { TrinityTokenAbi } from "@step/shared-types/abis";
import { STEP_DEPLOYMENTS_FILE, STEP_RPC_URL } from "@/lib/config";

// Read the on-chain Trinity balance for a wallet (public chain state).
export async function GET(req: Request) {
  const wallet = new URL(req.url).searchParams.get("wallet");
  if (!wallet || !/^0x[0-9a-fA-F]{40}$/.test(wallet)) {
    return NextResponse.json({ error: "valid wallet required" }, { status: 400 });
  }
  try {
    const deployments = JSON.parse(readFileSync(STEP_DEPLOYMENTS_FILE, "utf8")) as Record<string, Address>;
    const chain = defineChain({
      id: 31337,
      name: "step",
      nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
      rpcUrls: { default: { http: [STEP_RPC_URL] } },
    });
    const client = createPublicClient({ chain, transport: http() });
    const balance = (await client.readContract({
      address: deployments.TrinityToken!,
      abi: TrinityTokenAbi,
      functionName: "balanceOf",
      args: [wallet as Address],
    })) as bigint;
    return NextResponse.json({ trinity: balance.toString() });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "balance unavailable" },
      { status: 502 },
    );
  }
}
