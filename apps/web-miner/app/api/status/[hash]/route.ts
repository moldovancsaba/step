import { NextResponse } from "next/server";
import { GATEWAY_URL } from "@/lib/config";

// Proxy: claim status by hash.
export async function GET(_req: Request, ctx: { params: Promise<{ hash: string }> }) {
  const { hash } = await ctx.params;
  const r = await fetch(`${GATEWAY_URL}/v1/claims/${hash}`);
  return NextResponse.json(await r.json(), { status: r.status });
}
