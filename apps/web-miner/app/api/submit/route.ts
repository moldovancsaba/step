import { NextResponse } from "next/server";
import { GATEWAY_URL } from "@/lib/config";

// Proxy: submit a signed claim to the gateway. The claim is built and signed
// in the browser (self-custody); this route only forwards it.
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  if (!body?.claim) {
    return NextResponse.json({ error: "claim required" }, { status: 400 });
  }
  const r = await fetch(`${GATEWAY_URL}/v1/claims`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ claim: body.claim }),
  });
  return NextResponse.json(await r.json(), { status: r.status });
}
