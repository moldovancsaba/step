"use client";

/**
 * Interactive MESH map (WEB-003 /mesh): MapLibre GL with the canonical
 * triangle geometry fetched live from the validator mesh API (single Rust
 * implementation, ADR-004). Click anywhere to resolve that point's triangle;
 * the resolved triangle and its neighbours render as a GeoJSON overlay with
 * the SYS §7.6 state colours, joined with indexer mining state.
 */
import maplibregl, { Map as MlMap } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef, useState } from "react";
import type { TriangleInfo } from "@step/shared-types";

const MESH_API =
  process.env.NEXT_PUBLIC_MESH_API_URL ?? "http://127.0.0.1:9100";
const INDEXER =
  process.env.NEXT_PUBLIC_INDEXER_URL ?? "http://127.0.0.1:8090";
const PILOT_CENTER: [number, number] = [19.0402, 47.4979]; // pilot default (config)
const MIN_LEVEL = 1;
const MAX_LEVEL = 21;

function triangleToFeature(t: TriangleInfo, state: { used_slots?: number; frozen?: boolean; oasis?: boolean }) {
  const ring = [...t.vertices, t.vertices[0]!].map((v) => [v.lon, v.lat]);
  let fill = "#fafafa";
  if (state.frozen) fill = "#dc2626";
  else if (state.oasis) fill = "#2563eb";
  else if ((state.used_slots ?? 0) >= 27) fill = "#171717";
  else if ((state.used_slots ?? 0) > 0) fill = "#a3a3a3";
  return {
    type: "Feature" as const,
    properties: { id: t.triangle_id, fill, level: t.level },
    geometry: { type: "Polygon" as const, coordinates: [ring] },
  };
}

export default function MeshMap() {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  const [meshLevel, setMeshLevel] = useState<number>(1);
  const meshLevelRef = useRef(meshLevel);
  const [selected, setSelected] = useState<TriangleInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  const resolvedLevel = selected?.level ?? meshLevel;

  useEffect(() => {
    meshLevelRef.current = meshLevel;
  }, [meshLevel]);

  useEffect(() => {
    if (!container.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: container.current,
      style: "https://demotiles.maplibre.org/style.json",
      center: PILOT_CENTER,
      zoom: 11,
    });
    mapRef.current = map;

    map.on("load", () => {
      map.addSource("mesh", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      map.addLayer({
        id: "mesh-fill",
        type: "fill",
        source: "mesh",
        paint: { "fill-color": ["get", "fill"], "fill-opacity": 0.35 },
      });
      map.addLayer({
        id: "mesh-line",
        type: "line",
        source: "mesh",
        paint: { "line-color": "#10b981", "line-width": 1.5 },
      });
    });

    map.on("click", async (e) => {
      try {
        setError(null);
        const resp = await fetch(
          `${MESH_API}/v1/mesh/resolve?lat=${e.lngLat.lat}&lon=${e.lngLat.lng}&level=${meshLevelRef.current}`,
        );
        if (!resp.ok) throw new Error(`mesh API ${resp.status}`);
        const tri: TriangleInfo = await resp.json();
        setSelected(tri);

        // Neighbours for context.
        const neighbours = await Promise.all(
          tri.neighbours.map(async (id) => {
            const r = await fetch(`${MESH_API}/v1/mesh/triangle/${id}`);
            return r.ok ? ((await r.json()) as TriangleInfo) : null;
          }),
        );

        // Join indexer state (frozen/slots/oasis) for the selected triangle.
        let state: { used_slots?: number; frozen?: boolean; oasis?: boolean } = {};
        try {
          const s = await fetch(`${INDEXER}/v1/triangles/${tri.triangle_id_hash}`);
          if (s.ok) {
            const row = await s.json();
            state = {
              used_slots: row.used_slots,
              frozen: row.frozen,
              oasis: (row.oasis_campaigns ?? []).length > 0,
            };
          }
        } catch {
          /* indexer optional for pure geometry browsing */
        }

        const features = [
          triangleToFeature(tri, state),
          ...neighbours.filter((n): n is TriangleInfo => n !== null).map((n) =>
            triangleToFeature(n, {}),
          ),
        ];
        const src = map.getSource("mesh") as maplibregl.GeoJSONSource | undefined;
        src?.setData({ type: "FeatureCollection", features });
      } catch (err) {
        setError(err instanceof Error ? err.message : "mesh API unreachable");
      }
    });

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  return (
    <div className="space-y-4">
      <div ref={container} className="h-[480px] w-full rounded-lg border border-neutral-800" />
      {error && (
        <p className="rounded border border-amber-800 bg-amber-950/40 p-3 text-sm text-amber-300">
          {error} — is the validator node running? (see README quick start)
        </p>
      )}
      {selected && (
        <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-4 text-sm">
          <div className="font-mono text-emerald-400">{selected.triangle_id}</div>
          <dl className="mt-2 grid grid-cols-2 gap-x-8 gap-y-1 text-neutral-300 md:grid-cols-4">
            <dt className="text-neutral-500">Level</dt>
            <dd>{selected.level}</dd>
            <dt className="text-neutral-500">Area</dt>
            <dd>
              {selected.area_m2 > 1e6
                ? `${(selected.area_m2 / 1e6).toFixed(1)} km²`
                : `${selected.area_m2.toFixed(1)} m²`}
            </dd>
            <dt className="text-neutral-500">Min side</dt>
            <dd>{selected.min_side_m.toFixed(1)} m</dd>
            <dt className="text-neutral-500">Parent</dt>
            <dd className="truncate font-mono text-xs">{selected.parent ?? "—"}</dd>
          </dl>
          <a
            className="mt-2 inline-block text-xs text-emerald-400 hover:underline"
            href={`/triangle/${selected.triangle_id}`}
          >
            triangle details →
          </a>
        </div>
      )}
      <label className="text-xs text-neutral-400">
        Resolve level
        <input
          type="number"
          min={MIN_LEVEL}
          max={MAX_LEVEL}
          value={meshLevel}
          onChange={(event) => {
            const value = Number(event.target.value);
            if (!Number.isFinite(value)) return;
            const next = Math.max(MIN_LEVEL, Math.min(MAX_LEVEL, Math.floor(value)));
            setMeshLevel(next);
          }}
          className="ml-2 rounded border border-neutral-700 bg-neutral-900 px-2 py-1"
        />
      </label>
      <p className="text-xs text-neutral-500">
        Click the map to resolve the spherical triangle at that point (selected level {resolvedLevel}).
        Geometry is computed by the canonical Rust MESH engine.
      </p>
    </div>
  );
}
