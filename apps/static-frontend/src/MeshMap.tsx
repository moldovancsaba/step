"use client";

import { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { TriangleInfo } from "@step/shared-types";

const MESH_LEVEL = 15;
const PILOT_CENTER: [number, number] = [19.0402, 47.4979];

interface MeshState {
  used_slots?: number;
  frozen?: boolean;
  oasis?: boolean;
}

interface MeshMapProps {
  gatewayUrl: string;
  indexerUrl: string;
}

function triangleToFeature(
  t: TriangleInfo,
  state: MeshState = {},
) {
  const ring = [...t.vertices, t.vertices[0] || t.centroid].map((v) => [v.lon, v.lat]);
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

async function fetchJson<T>(url: string) {
  const resp = await fetch(url);
  if (!resp.ok) return null;
  return (await resp.json()) as T;
}

export default function MeshMap({ gatewayUrl, indexerUrl }: MeshMapProps) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [selected, setSelected] = useState<TriangleInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

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
      const level = map.getZoom() >= 16 ? 21 : MESH_LEVEL;
      try {
        setError(null);

        const resolved = await fetchJson<TriangleInfo>(
          `${gatewayUrl}/v1/mesh/resolve?lat=${e.lngLat.lat}&lon=${e.lngLat.lng}&level=${level}`,
        );
        if (!resolved) throw new Error("mesh API unreachable");
        setSelected(resolved);

        const state = await (async () => {
          const row = await fetchJson<{ used_slots?: number; frozen?: boolean; oasis_campaigns?: unknown[] }>(
            `${indexerUrl}/v1/triangles/${resolved.triangle_id_hash}`,
          );
          if (!row) return {};
          return {
            used_slots: row.used_slots,
            frozen: row.frozen,
            oasis: Array.isArray(row.oasis_campaigns) && row.oasis_campaigns.length > 0,
          };
        })();

        const neighbours = await Promise.all(
          resolved.neighbours.map(async (id) =>
            fetchJson<TriangleInfo>(`${gatewayUrl}/v1/mesh/triangle/${id}`),
          ),
        );

        const features = [
          triangleToFeature(resolved, state),
          ...neighbours.filter((n): n is TriangleInfo => n !== null).map((n) => triangleToFeature(n)),
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
  }, [gatewayUrl, indexerUrl]);

  return (
    <div className="space-y-4">
      <div ref={container} className="mesh-map-canvas" />
      {error && (
        <p className="mesh-error">
          {error} — is the mesh API/indexer online? (open /mesh path to check backend health)
        </p>
      )}
      {selected && (
        <div className="mesh-selected">
          <div className="eyebrow mono">{selected.triangle_id}</div>
          <dl className="mesh-details">
            <dt>Level</dt>
            <dd>{selected.level}</dd>
            <dt>Area</dt>
            <dd>
              {selected.area_m2 > 1_000_000
                ? `${(selected.area_m2 / 1_000_000).toFixed(1)} km²`
                : `${selected.area_m2.toFixed(1)} m²`}
            </dd>
            <dt>Min side</dt>
            <dd>{selected.min_side_m.toFixed(1)} m</dd>
            <dt>Parent</dt>
            <dd className="break">{selected.parent ?? "—"}</dd>
          </dl>
        </div>
      )}
      <p className="mesh-hint">
        Click anywhere on the map to resolve that point. Geometry comes from the same
        canonical mesh engine used by mining.
      </p>
    </div>
  );
}
