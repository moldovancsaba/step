"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { TriangleInfo } from "@step/shared-types";

const MIN_MESH_LEVEL = 1;
const MAX_MESH_LEVEL = 21;
const INITIAL_VIEW = { lat: 18, lon: 18 };
const GLOBE_SIZE = 1000;
const GLOBE_CENTER = GLOBE_SIZE / 2;
const GLOBE_RADIUS = 455;
const DEG = Math.PI / 180;
const RAD = 180 / Math.PI;
const LEVEL_ONE_FACE_COUNT = 20;

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

interface CoverTriangle {
  triangle_id: string;
  triangle_id_hash: string;
  vertices: MeshCursor[];
}

interface MeshCoverResponse {
  triangles: CoverTriangle[];
  truncated: boolean;
  suggested_level: number;
  level: number;
  mesh_spec_version: string;
}

interface ViewCenter {
  lat: number;
  lon: number;
}

interface Vec3 {
  x: number;
  y: number;
  z: number;
}

interface ProjectedPoint {
  x: number;
  y: number;
  z: number;
  visible: boolean;
}

interface DragState {
  pointerId: number;
  startX: number;
  startY: number;
  startLat: number;
  startLon: number;
  moved: boolean;
}

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

function normalizeLon(lon: number) {
  const normalized = ((((lon + 180) % 360) + 360) % 360) - 180;
  return normalized === -180 ? 180 : normalized;
}

function latLonToVec(point: MeshCursor): Vec3 {
  const lat = point.lat * DEG;
  const lon = point.lon * DEG;
  const cosLat = Math.cos(lat);
  return {
    x: cosLat * Math.cos(lon),
    y: Math.sin(lat),
    z: cosLat * Math.sin(lon),
  };
}

function vecToLatLon(v: Vec3): MeshCursor {
  const hyp = Math.hypot(v.x, v.z);
  return {
    lat: Math.atan2(v.y, hyp) * RAD,
    lon: normalizeLon(Math.atan2(v.z, v.x) * RAD),
  };
}

function normalizeVec(v: Vec3): Vec3 {
  const len = Math.hypot(v.x, v.y, v.z) || 1;
  return { x: v.x / len, y: v.y / len, z: v.z / len };
}

function dot(a: Vec3, b: Vec3) {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function slerp(a: MeshCursor, b: MeshCursor, t: number): MeshCursor {
  const va = latLonToVec(a);
  const vb = latLonToVec(b);
  const d = clamp(dot(va, vb), -1, 1);

  if (d > 0.9995) {
    return vecToLatLon(
      normalizeVec({
        x: va.x + (vb.x - va.x) * t,
        y: va.y + (vb.y - va.y) * t,
        z: va.z + (vb.z - va.z) * t,
      }),
    );
  }

  const omega = Math.acos(d);
  const sinOmega = Math.sin(omega) || 1;
  const aScale = Math.sin((1 - t) * omega) / sinOmega;
  const bScale = Math.sin(t * omega) / sinOmega;
  return vecToLatLon({
    x: va.x * aScale + vb.x * bScale,
    y: va.y * aScale + vb.y * bScale,
    z: va.z * aScale + vb.z * bScale,
  });
}

function edgeSegmentsForLevel(level: number) {
  if (level <= 1) return 56;
  if (level <= 3) return 32;
  if (level <= 7) return 18;
  if (level <= 12) return 10;
  return 5;
}

function sphericalRing(vertices: MeshCursor[], level: number) {
  if (vertices.length < 3) return [];
  const segments = edgeSegmentsForLevel(level);
  const ring: MeshCursor[] = [];
  for (let i = 0; i < vertices.length; i += 1) {
    const a = vertices[i];
    const b = vertices[(i + 1) % vertices.length];
    if (!a || !b) continue;
    for (let s = 0; s < segments; s += 1) {
      ring.push(slerp(a, b, s / segments));
    }
  }
  return ring;
}

function projectPoint(point: MeshCursor, view: ViewCenter): ProjectedPoint {
  const lat = point.lat * DEG;
  const lon = point.lon * DEG;
  const viewLat = view.lat * DEG;
  const dLon = normalizeLon(point.lon - view.lon) * DEG;
  const sinLat = Math.sin(lat);
  const cosLat = Math.cos(lat);
  const sinViewLat = Math.sin(viewLat);
  const cosViewLat = Math.cos(viewLat);
  const cosDLon = Math.cos(dLon);

  const x = cosLat * Math.sin(dLon);
  const y = cosViewLat * sinLat - sinViewLat * cosLat * cosDLon;
  const z = sinViewLat * sinLat + cosViewLat * cosLat * cosDLon;

  return {
    x: GLOBE_CENTER + GLOBE_RADIUS * x,
    y: GLOBE_CENTER - GLOBE_RADIUS * y,
    z,
    visible: z >= -0.015,
  };
}

function pointFromScreen(x: number, y: number, view: ViewCenter): MeshCursor | null {
  const nx = (x - GLOBE_CENTER) / GLOBE_RADIUS;
  const ny = -(y - GLOBE_CENTER) / GLOBE_RADIUS;
  const rho2 = nx * nx + ny * ny;
  if (rho2 > 1) return null;

  const z = Math.sqrt(Math.max(0, 1 - rho2));
  const viewLat = view.lat * DEG;
  const viewLon = view.lon * DEG;
  const sinViewLat = Math.sin(viewLat);
  const cosViewLat = Math.cos(viewLat);
  const lat = Math.asin(clamp(ny * cosViewLat + z * sinViewLat, -1, 1));
  const lon = viewLon + Math.atan2(nx, z * cosViewLat - ny * sinViewLat);

  return { lat: lat * RAD, lon: normalizeLon(lon * RAD) };
}

function visiblePathSegments(points: MeshCursor[], view: ViewCenter) {
  const first = points[0];
  const closed = first ? [...points, first] : [];
  const paths: string[] = [];
  let current = "";

  for (const point of closed) {
    const projected = projectPoint(point, view);
    if (!projected.visible) {
      if (current) paths.push(current);
      current = "";
      continue;
    }
    current += current
      ? ` L ${projected.x.toFixed(2)} ${projected.y.toFixed(2)}`
      : `M ${projected.x.toFixed(2)} ${projected.y.toFixed(2)}`;
  }

  if (current) paths.push(current);
  return paths;
}

function fullyVisibleFillPath(points: MeshCursor[], view: ViewCenter) {
  if (points.length === 0) return null;
  const projected = points.map((point) => projectPoint(point, view));
  if (!projected.every((point) => point.z > 0.015)) return null;
  return `${projected
    .map((point, index) => `${index === 0 ? "M" : "L"} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`)
    .join(" ")} Z`;
}

function graticulePaths(view: ViewCenter) {
  const paths: string[] = [];
  const latLines = [-60, -30, 0, 30, 60];
  const lonLines = Array.from({ length: 12 }, (_, index) => -180 + index * 30);

  for (const lat of latLines) {
    const points = Array.from({ length: 73 }, (_, index) => ({ lat, lon: -180 + index * 5 }));
    paths.push(...visiblePathSegments(points, view));
  }

  for (const lon of lonLines) {
    const points = Array.from({ length: 37 }, (_, index) => ({ lat: -90 + index * 5, lon }));
    paths.push(...visiblePathSegments(points, view));
  }

  return paths;
}

function coverQueryFor(level: number, view: ViewCenter) {
  const params = new URLSearchParams();
  if (level === 1) {
    params.set("minLat", "-90");
    params.set("minLon", "-180");
    params.set("maxLat", "90");
    params.set("maxLon", "180");
    params.set("max", "64");
  } else {
    const span = Math.max(0.0002, 120 / 2 ** (level - 1));
    params.set("minLat", String(clamp(view.lat - span, -90, 90)));
    params.set("maxLat", String(clamp(view.lat + span, -90, 90)));
    params.set("minLon", String(normalizeLon(view.lon - span)));
    params.set("maxLon", String(normalizeLon(view.lon + span)));
    params.set("max", "6000");
  }
  params.set("level", String(level));
  return params;
}

function triangleFill(state: MeshState, selected: boolean) {
  if (selected) return "rgba(245, 158, 11, 0.42)";
  if (state.frozen) return "rgba(220, 38, 38, 0.36)";
  if (state.oasis) return "rgba(37, 99, 235, 0.34)";
  if ((state.used_slots ?? 0) >= 27) return "rgba(23, 23, 23, 0.42)";
  if ((state.used_slots ?? 0) > 0) return "rgba(163, 163, 163, 0.32)";
  return "rgba(16, 185, 129, 0.16)";
}

function formatArea(areaM2: number) {
  return areaM2 > 1_000_000 ? `${(areaM2 / 1_000_000).toFixed(1)} km2` : `${areaM2.toFixed(1)} m2`;
}

async function fetchJson<T>(url: string) {
  const resp = await fetch(url);
  if (!resp.ok) return null;
  return (await resp.json()) as T;
}

export default function MeshMap({ gatewayUrl, indexerUrl }: MeshMapProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const coverRequestRef = useRef(0);
  const meshLevelRef = useRef(MIN_MESH_LEVEL);
  const [selected, setSelected] = useState<TriangleInfo | null>(null);
  const [selectedState, setSelectedState] = useState<MeshState>({});
  const [cover, setCover] = useState<MeshCoverResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [meshLevel, setMeshLevel] = useState(MIN_MESH_LEVEL);
  const [meshLevelInput, setMeshLevelInput] = useState(String(MIN_MESH_LEVEL));
  const [cursor, setCursor] = useState<MeshCursor | null>(null);
  const [view, setView] = useState<ViewCenter>(INITIAL_VIEW);
  meshLevelRef.current = meshLevel;

  const loadCover = useCallback(
    async (level: number, center: ViewCenter) => {
      const targetLevel = Math.min(MAX_MESH_LEVEL, Math.max(MIN_MESH_LEVEL, Math.floor(level)));
      const requestId = coverRequestRef.current + 1;
      coverRequestRef.current = requestId;
      setError(null);
      try {
        const response = await fetchJson<MeshCoverResponse>(
          `${gatewayUrl}/v1/mesh/cover?${coverQueryFor(targetLevel, center).toString()}`,
        );
        if (!response) throw new Error("mesh cover API unreachable");
        if (coverRequestRef.current !== requestId) return;
        setCover(response);
      } catch (err) {
        if (coverRequestRef.current !== requestId) return;
        setCover(null);
        setError(err instanceof Error ? err.message : "mesh cover API unreachable");
      }
    },
    [gatewayUrl],
  );

  const refreshFromCoordinates = useCallback(
    async (lat: number, lon: number, level: number) => {
      const targetLevel = Math.min(MAX_MESH_LEVEL, Math.max(MIN_MESH_LEVEL, Math.floor(level)));
      setError(null);
      try {
        const resolved = await fetchJson<TriangleInfo>(
          `${gatewayUrl}/v1/mesh/resolve?lat=${lat}&lon=${lon}&level=${targetLevel}`,
        );
        if (!resolved) throw new Error("mesh resolve API unreachable");
        setSelected(resolved);
        setMeshLevel(targetLevel);
        setMeshLevelInput(String(targetLevel));

        const row = await fetchJson<{ used_slots?: number; frozen?: boolean; oasis_campaigns?: unknown[] }>(
          `${indexerUrl}/v1/triangles/${resolved.triangle_id_hash}`,
        );
        setSelectedState(
          row
            ? {
                used_slots: row.used_slots,
                frozen: row.frozen,
                oasis: Array.isArray(row.oasis_campaigns) && row.oasis_campaigns.length > 0,
              }
            : {},
        );
      } catch (err) {
        setError(err instanceof Error ? err.message : "mesh API unreachable");
      }
    },
    [gatewayUrl, indexerUrl],
  );

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void loadCover(meshLevel, view);
    }, meshLevel === 1 ? 0 : 220);
    return () => window.clearTimeout(timeout);
  }, [loadCover, meshLevel, view]);

  const applyLevel = useCallback(() => {
    const next = Number.parseInt(meshLevelInput, 10);
    const bounded = Number.isNaN(next) ? meshLevel : Math.min(MAX_MESH_LEVEL, Math.max(MIN_MESH_LEVEL, next));
    setMeshLevel(bounded);
    setMeshLevelInput(String(bounded));
    if (cursor) {
      void refreshFromCoordinates(cursor.lat, cursor.lon, bounded);
    } else {
      void loadCover(bounded, view);
    }
  }, [cursor, loadCover, meshLevel, meshLevelInput, refreshFromCoordinates, view]);

  const useDeviceLocation = useCallback(() => {
    if (!navigator.geolocation) {
      setError("Geolocation is not available in this browser.");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const location = { lat: position.coords.latitude, lon: position.coords.longitude };
        setCursor(location);
        setView({ lat: clamp(location.lat, -85, 85), lon: normalizeLon(location.lon) });
        void refreshFromCoordinates(location.lat, location.lon, meshLevelRef.current);
      },
      () => {
        setError("No location permission. Click the globe to resolve manually.");
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    );
  }, [refreshFromCoordinates]);

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<SVGSVGElement>) => {
      svgRef.current?.setPointerCapture(event.pointerId);
      dragRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        startLat: view.lat,
        startLon: view.lon,
        moved: false,
      };
    },
    [view],
  );

  const handlePointerMove = useCallback((event: React.PointerEvent<SVGSVGElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    if (Math.hypot(dx, dy) > 4) drag.moved = true;
    setView({
      lat: clamp(drag.startLat + dy * 0.25, -85, 85),
      lon: normalizeLon(drag.startLon - dx * 0.35),
    });
  }, []);

  const handlePointerUp = useCallback(
    (event: React.PointerEvent<SVGSVGElement>) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      dragRef.current = null;
      svgRef.current?.releasePointerCapture(event.pointerId);
      if (drag.moved) return;

      const rect = svgRef.current?.getBoundingClientRect();
      if (!rect) return;
      const x = ((event.clientX - rect.left) / rect.width) * GLOBE_SIZE;
      const y = ((event.clientY - rect.top) / rect.height) * GLOBE_SIZE;
      const location = pointFromScreen(x, y, view);
      if (!location) return;
      setCursor(location);
      void refreshFromCoordinates(location.lat, location.lon, meshLevelRef.current);
    },
    [refreshFromCoordinates, view],
  );

  const selectedHash = selected?.triangle_id_hash;
  const selectedId = selected?.triangle_id;
  const coverTriangles = cover?.triangles ?? [];
  const coverIncludesSelected = coverTriangles.some(
    (triangle) => triangle.triangle_id_hash === selectedHash || triangle.triangle_id === selectedId,
  );
  const selectedAsCoverTriangle: CoverTriangle[] =
    selected && !coverIncludesSelected
      ? [
          {
            triangle_id: selected.triangle_id,
            triangle_id_hash: selected.triangle_id_hash,
            vertices: selected.vertices,
          },
        ]
      : [];
  const trianglesToRender = [...coverTriangles, ...selectedAsCoverTriangle];
  const gridPaths = graticulePaths(view);
  const selectedPoint = selected ? projectPoint(selected.centroid, view) : null;

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
            onBlur={applyLevel}
            onKeyDown={(event) => {
              if (event.key !== "Enter") return;
              applyLevel();
              event.preventDefault();
            }}
          />
          <button type="button" className="primary" onClick={applyLevel}>
            Apply
          </button>
        </div>
        <p className="mesh-hint">
          Globe level: {meshLevel}. Level 1 loads the complete 20-face spherical icosahedron;
          deeper levels load the visible spherical cover around the globe center.
        </p>
      </article>

      <div className="mesh-map-canvas mesh-globe-shell">
        <div className="mesh-globe-toolbar" aria-live="polite">
          <span className="mesh-globe-stat">
            {cover
              ? `Loaded ${cover.triangles.length}${meshLevel === 1 ? `/${LEVEL_ONE_FACE_COUNT}` : ""} spherical triangles`
              : "Loading spherical mesh"}
          </span>
          {cover?.truncated && (
            <span className="mesh-globe-stat warn">Cover truncated. Suggested level {cover.suggested_level}.</span>
          )}
          <button type="button" className="primary" onClick={useDeviceLocation}>
            Use my location
          </button>
          <button
            type="button"
            className="primary subtle"
            onClick={() => setView(selected ? { lat: clamp(selected.centroid.lat, -85, 85), lon: selected.centroid.lon } : INITIAL_VIEW)}
          >
            Reset globe
          </button>
        </div>

        <svg
          ref={svgRef}
          className="mesh-globe-svg"
          viewBox={`0 0 ${GLOBE_SIZE} ${GLOBE_SIZE}`}
          role="img"
          tabIndex={0}
          aria-label={`Spherical STEP mesh globe at level ${meshLevel}. ${coverTriangles.length} triangles loaded.`}
          aria-describedby="mesh-globe-help"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={() => {
            dragRef.current = null;
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowLeft") setView((current) => ({ ...current, lon: normalizeLon(current.lon - 8) }));
            if (event.key === "ArrowRight") setView((current) => ({ ...current, lon: normalizeLon(current.lon + 8) }));
            if (event.key === "ArrowUp") setView((current) => ({ ...current, lat: clamp(current.lat + 6, -85, 85) }));
            if (event.key === "ArrowDown") setView((current) => ({ ...current, lat: clamp(current.lat - 6, -85, 85) }));
          }}
        >
          <defs>
            <radialGradient id="mesh-ocean" cx="36%" cy="28%" r="72%">
              <stop offset="0%" stopColor="#d8fff4" />
              <stop offset="52%" stopColor="#168f82" />
              <stop offset="100%" stopColor="#062421" />
            </radialGradient>
            <filter id="mesh-glow" x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="5" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>
          <circle cx={GLOBE_CENTER} cy={GLOBE_CENTER} r={GLOBE_RADIUS} className="mesh-globe-shadow" />
          <circle cx={GLOBE_CENTER} cy={GLOBE_CENTER} r={GLOBE_RADIUS} fill="url(#mesh-ocean)" className="mesh-globe-ocean" />
          {gridPaths.map((path, index) => (
            <path key={`grid-${index}`} d={path} className="mesh-globe-grid" />
          ))}
          {trianglesToRender.map((triangle) => {
            const selectedTriangle = triangle.triangle_id_hash === selectedHash || triangle.triangle_id === selectedId;
            const ring = sphericalRing(triangle.vertices, meshLevel);
            const fillPath = fullyVisibleFillPath(ring, view);
            const linePaths = visiblePathSegments(ring, view);
            return (
              <g key={triangle.triangle_id} filter={selectedTriangle ? "url(#mesh-glow)" : undefined}>
                {fillPath && (
                  <path
                    d={fillPath}
                    className="mesh-globe-face"
                    fill={triangleFill(selectedTriangle ? selectedState : {}, selectedTriangle)}
                  />
                )}
                {linePaths.map((path, index) => (
                  <path
                    key={`${triangle.triangle_id}-${index}`}
                    d={path}
                    className={selectedTriangle ? "mesh-globe-edge selected" : "mesh-globe-edge"}
                  />
                ))}
              </g>
            );
          })}
          <circle cx={GLOBE_CENTER} cy={GLOBE_CENTER} r={GLOBE_RADIUS} className="mesh-globe-rim" />
          {selectedPoint?.visible && (
            <g>
              <circle cx={selectedPoint.x} cy={selectedPoint.y} r="8" className="mesh-globe-marker" />
              <circle cx={selectedPoint.x} cy={selectedPoint.y} r="18" className="mesh-globe-marker-ring" />
            </g>
          )}
        </svg>
      </div>

      {error && (
        <p className="mesh-error">
          {error} - check /api/gateway/healthz and /api/indexer/healthz.
        </p>
      )}
      {selected && (
        <div className="mesh-selected">
          <div className="eyebrow mono">{selected.triangle_id}</div>
          <dl className="mesh-details">
            <dt>Level</dt>
            <dd>{selected.level}</dd>
            <dt>Area</dt>
            <dd>{formatArea(selected.area_m2)}</dd>
            <dt>Min side</dt>
            <dd>{selected.min_side_m.toFixed(1)} m</dd>
            <dt>Parent</dt>
            <dd className="break">{selected.parent ?? "-"}</dd>
          </dl>
        </div>
      )}
      <p id="mesh-globe-help" className="mesh-hint">
        Drag to rotate the spherical icosahedron. Click the globe to resolve the canonical triangle for that
        point. The renderer draws great-circle triangle edges from the same mesh engine used by mining.
      </p>
    </div>
  );
}
