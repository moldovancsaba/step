import { NextResponse } from "next/server";
import { MESH_API_URL } from "@/lib/config";

// Proxy: canonical triangle resolution for a coordinate (single Rust engine).
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const lat = searchParams.get("lat");
  const lon = searchParams.get("lon");
  const level = searchParams.get("level") ?? "21";
  if (!lat || !lon) {
    return NextResponse.json({ error: "lat and lon required" }, { status: 400 });
  }
  const r = await fetch(`${MESH_API_URL}/v1/mesh/resolve?lat=${lat}&lon=${lon}&level=${level}`);
  return NextResponse.json(await r.json(), { status: r.status });
}
