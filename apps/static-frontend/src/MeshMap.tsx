"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { TriangleInfo } from "@step/shared-types";

const MIN_MESH_LEVEL = 1;
const MAX_MESH_LEVEL = 21;
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

interface MeshCursor {
  lat: number;
  lon: number;
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
  const [meshLevel, setMeshLevel] = useState(MIN_MESH_LEVEL);
  const [meshLevelInput, setMeshLevelInput] = useState(String(MIN_MESH_LEVEL));
  const [cursor, setCursor] = useState<MeshCursor | null>(null);
  const meshLevelRef = useRef(meshLevel);
  meshLevelRef.current = meshLevel;

  const refreshFromCoordinates = useCallback(
      async (lat: number, lon: number, level: number) => {
      const targetLevel = Math.min(MAX_MESH_LEVEL, Math.max(MIN_MESH_LEVEL, Math.floor(level)));
      setError(null);
      try {
        const resolved = await fetchJson<TriangleInfo>(
          `${gatewayUrl}/v1/mesh/resolve?lat=${lat}&lon=${lon}&level=${targetLevel}`,
        );
        if (!resolved) throw new Error("mesh API unreachable");
        setSelected(resolved);
        setMeshLevel(targetLevel);
        setMeshLevelInput(String(targetLevel));

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
        const src = mapRef.current?.getSource("mesh") as maplibregl.GeoJSONSource | undefined;
        src?.setData({ type: "FeatureCollection", features });
      } catch (err) {
        setError(err instanceof Error ? err.message : "mesh API unreachable");
      }
    },
    [gatewayUrl, indexerUrl],
  );

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
      const GeolocateControl = (maplibregl as unknown as {
        GeolocateControl?: new (options: {
          positionOptions?: PositionOptions;
          trackUserLocation?: boolean;
          showAccuracyCircle?: boolean;
        }) => maplibregl.IControl;
      }).GeolocateControl;
      if (GeolocateControl) {
        map.addControl(
          new GeolocateControl({
            positionOptions: { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
            trackUserLocation: true,
            showAccuracyCircle: true,
          }),
        );
      }

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

      map.on("geolocate", (event: unknown) => {
        const anyEvent = event as { coords: { latitude: number; longitude: number } };
        const location = { lat: anyEvent.coords.latitude, lon: anyEvent.coords.longitude };
        setCursor(location);
        void refreshFromCoordinates(location.lat, location.lon, meshLevelRef.current);
      });

      map.on("click", (event: unknown) => {
        const anyEvent = event as { lngLat: { lat: number; lng: number } };
        const location = { lat: anyEvent.lngLat.lat, lon: anyEvent.lngLat.lng };
        setCursor(location);
        void refreshFromCoordinates(location.lat, location.lon, meshLevelRef.current);
      });

      if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
          (position) => {
            const location = { lat: position.coords.latitude, lon: position.coords.longitude };
            setCursor(location);
            void refreshFromCoordinates(location.lat, location.lon, meshLevelRef.current);
          },
          () => {
            setError("No location permission. Click map to resolve manually.");
          },
          { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 },
        );
      }
    });

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [gatewayUrl, indexerUrl, refreshFromCoordinates]);

  useEffect(() => {
    if (!cursor) return;
    void refreshFromCoordinates(cursor.lat, cursor.lon, meshLevel);
  }, [cursor, meshLevel, refreshFromCoordinates]);

  return (
    <div className="space-y-4">
      <article className="panel">
        <div className="row">
          <label htmlFor="mesh-level">Mesh depth level</label>
          <input
            id="mesh-level"
            type="number"
            min={MIN_MESH_LEVEL}
            max={MAX_MESH_LEVEL}
            value={meshLevelInput}
            onChange={(event) => setMeshLevelInput(event.target.value)}
            onBlur={() => {
              const next = Number.parseInt(meshLevelInput, 10);
              const bounded = Number.isNaN(next)
                ? meshLevel
                : Math.min(MAX_MESH_LEVEL, Math.max(MIN_MESH_LEVEL, next));
              setMeshLevel(bounded);
              setMeshLevelInput(String(bounded));
            }}
            onKeyDown={(event) => {
              if (event.key !== "Enter") return;
              const next = Number.parseInt(meshLevelInput, 10);
              const bounded = Number.isNaN(next)
                ? meshLevel
                : Math.min(MAX_MESH_LEVEL, Math.max(MIN_MESH_LEVEL, next));
              setMeshLevel(bounded);
              setMeshLevelInput(String(bounded));
              if (cursor) {
                void refreshFromCoordinates(cursor.lat, cursor.lon, bounded);
              }
              event.preventDefault();
            }}
          />
          <button
            type="button"
            className="primary"
            onClick={() => {
              const next = Number.parseInt(meshLevelInput, 10);
              const bounded = Number.isNaN(next)
                ? meshLevel
                : Math.min(MAX_MESH_LEVEL, Math.max(MIN_MESH_LEVEL, next));
              setMeshLevel(bounded);
              setMeshLevelInput(String(bounded));
              if (cursor) {
                void refreshFromCoordinates(cursor.lat, cursor.lon, bounded);
              }
            }}
          >
            Apply
          </button>
        </div>
        <p className="mesh-hint">
          Current level: {meshLevel}. Resolution is always ancestor-gated by triangle state.
        </p>
      </article>
      <div ref={container} className="mesh-map-canvas" />
      {error && (
        <p className="mesh-error">
          {error} — is the mesh API and indexer online? Check /api/gateway/healthz and /api/indexer/healthz.
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
