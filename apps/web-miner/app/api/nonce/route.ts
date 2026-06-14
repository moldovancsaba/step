import { NextResponse } from "next/server";
import { GATEWAY_URL } from "@/lib/config";

// Proxy: issue a gateway nonce for a wallet (ADR-017).
export async function POST(req: Request) {
  const { wallet } = await req.json().catch(() => ({}));
  if (!wallet || !/^0x[0-9a-fA-F]{40}$/.test(wallet)) {
    return NextResponse.json({ error: "valid wallet required" }, { status: 400 });
  }
  const r = await fetch(`${GATEWAY_URL}/v1/nonce`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ wallet }),
  });
  return NextResponse.json(await r.json(), { status: r.status });
}
