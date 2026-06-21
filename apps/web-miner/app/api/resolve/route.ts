import { NextResponse } from "next/server";
import { GATEWAY_URL, MESH_API_URL } from "@/lib/config";

const MAX_MESH_LEVEL = 21;

interface TriangleInfo {
  triangle_id: string;
  triangle_id_hash: string;
  level: number;
}

function parseLevel(level: string | null): number | null {
  if (!level) return null;
  const parsed = Number(level);
  return Number.isInteger(parsed) ? Math.max(1, Math.min(MAX_MESH_LEVEL, parsed)) : null;
}

async function resolveTriangleAtLevel(lat: string, lon: string, level: number): Promise<TriangleInfo> {
  const resp = await fetch(`${MESH_API_URL}/v1/mesh/resolve?lat=${lat}&lon=${lon}&level=${level}`);
  if (!resp.ok) {
    throw new Error(`mesh API returned ${resp.status} for level ${level}`);
  }
  return (await resp.json()) as TriangleInfo;
}

/**
 * The mining frontier (Mesh ID v2): a coordinate resolves to a level-21 triangle,
 * but a triangle at level N>1 is only mineable once its parent is Exhausted. The
 * gateway resolves the deepest currently-mineable ANCESTOR from authoritative
 * on-chain `TriangleMiningState` (no hardcoded slot limit, no indexer lag); we
 * then fetch that ancestor's canonical id + hash from the mesh engine.
 */
async function resolveMiningFrontier(lat: string, lon: string): Promise<TriangleInfo> {
  const resp = await fetch(`${GATEWAY_URL}/v1/mesh/mineable?lat=${lat}&lon=${lon}`);
  if (!resp.ok) {
    throw new Error(`mining frontier resolution failed (${resp.status})`);
  }
  const frontier = (await resp.json()) as { level?: number; fully_mined?: boolean };
  if (frontier.fully_mined || !frontier.level) {
    throw new Error("All levels are exhausted for this location.");
  }
  return resolveTriangleAtLevel(lat, lon, frontier.level);
}

// Proxy: canonical triangle resolution for a coordinate (single Rust engine).
// With no `level`, returns the on-chain mining frontier the miner should claim.
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const lat = searchParams.get("lat");
  const lon = searchParams.get("lon");
  const level = parseLevel(searchParams.get("level"));
  if (!lat || !lon) {
    return NextResponse.json({ error: "lat and lon required" }, { status: 400 });
  }

  try {
    const tri = level ? await resolveTriangleAtLevel(lat, lon, level) : await resolveMiningFrontier(lat, lon);
    return NextResponse.json(tri);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "triangle resolution failed" },
      { status: 409 },
    );
  }
}
