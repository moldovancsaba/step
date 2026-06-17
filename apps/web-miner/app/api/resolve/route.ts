import { NextResponse } from "next/server";
import { MESH_API_URL } from "@/lib/config";

const INDEXER_URL = process.env.INDEXER_URL ?? process.env.INDEXER_API_URL ?? "http://127.0.0.1:8090";
const MAX_MESH_LEVEL = 21;
const SLOT_LIMIT = 27;

interface TriangleInfo {
  triangle_id: string;
  triangle_id_hash: string;
  level: number;
}

interface IndexerTriangleState {
  used_slots?: number;
  frozen?: boolean;
}

function parseLevel(level: string | null): number | null {
  if (!level) return null;
  const parsed = Number(level);
  return Number.isInteger(parsed) ? Math.max(1, Math.min(MAX_MESH_LEVEL, parsed)) : null;
}

async function fetchTriangleState(hash: string): Promise<IndexerTriangleState | null> {
  try {
    const stateResp = await fetch(`${INDEXER_URL}/v1/triangles/${hash}`);
    if (!stateResp.ok) return null;
    return (await stateResp.json()) as IndexerTriangleState;
  } catch {
    return null;
  }
}

async function resolveMineableTriangle(lat: string, lon: string, level: number): Promise<TriangleInfo> {
  const stateResp = await fetch(
    `${MESH_API_URL}/v1/mesh/resolve?lat=${lat}&lon=${lon}&level=${level}`,
  );
  if (!stateResp.ok) {
    throw new Error(`mesh API returned ${stateResp.status} for level ${level}`);
  }
  return (await stateResp.json()) as TriangleInfo;
}

async function resolveFirstMineableTriangle(lat: string, lon: string): Promise<TriangleInfo> {
  for (let level = 1; level <= MAX_MESH_LEVEL; level += 1) {
    const tri = await resolveMineableTriangle(lat, lon, level);
    const state = await fetchTriangleState(tri.triangle_id_hash);

    if (state?.frozen) {
      throw new Error(`triangle ${tri.triangle_id} is frozen by indexer safety policy`);
    }

    if (!state) {
      return tri;
    }

    const usedSlots = Number.isFinite(state.used_slots as number) ? (state.used_slots as number) : 0;
    if (usedSlots < SLOT_LIMIT) {
      return tri;
    }
  }

  throw new Error(`All levels 1-${MAX_MESH_LEVEL} are exhausted for this location.`);
}

// Proxy: canonical triangle resolution for a coordinate (single Rust engine).
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const lat = searchParams.get("lat");
  const lon = searchParams.get("lon");
  const level = parseLevel(searchParams.get("level"));
  if (!lat || !lon) {
    return NextResponse.json({ error: "lat and lon required" }, { status: 400 });
  }

  try {
    if (level) {
      const tri = await resolveMineableTriangle(lat, lon, level);
      return NextResponse.json(tri);
    }
    const tri = await resolveFirstMineableTriangle(lat, lon);
    return NextResponse.json(tri);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "triangle resolution failed" },
      { status: 409 },
    );
  }
}
