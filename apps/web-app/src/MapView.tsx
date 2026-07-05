/**
 * Mining map (#17): one MapLibre globe is the visual source of truth for
 * Earth, the live visible spherical mesh cover, and the GPS-locked mining
 * triangle. Users can rotate and zoom to discover the globe, but only their
 * real current triangle is selected.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EmptyState, MetricCard } from "@sovereignsquad/gds";
import { Button, Group, Paper, Stack, Text } from "@mantine/core";
import maplibregl, { type CustomLayerInterface, type CustomRenderMethodInput } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { mesh, meshConfigured, type CoverResult, type MeshState, type TriangleInfo } from "./api.js";

interface MeshCursor {
  lat: number;
  lon: number;
}

interface Vec3 {
  x: number;
  y: number;
  z: number;
}

interface GlobeMeshLayerData {
  visibleTriangles: CoverResult["triangles"];
  meshLevel: number;
  activeTriangle: TriangleInfo | null;
}

interface ProjectionShader {
  program: WebGLProgram;
  aPos: number;
  uColor: WebGLUniformLocation | null;
  uProjectionFallbackMatrix: WebGLUniformLocation | null;
  uProjectionMatrix: WebGLUniformLocation | null;
  uProjectionTileMercatorCoords: WebGLUniformLocation | null;
  uProjectionClippingPlane: WebGLUniformLocation | null;
  uProjectionTransition: WebGLUniformLocation | null;
}

const INITIAL_CENTER: [number, number] = [18, 18];
const INITIAL_ZOOM = 0.15;
const EARTH_ZOOM = 0.15;
const MAX_GLOBE_ZOOM = 12;
const LEVEL_ONE = 1;
const MAX_MESH_LEVEL = 21;
const MINING_MAP_STYLE = "https://tiles.openfreemap.org/styles/bright";
const STEP_GLOBE_MESH_LAYER = "step-globe-mesh-custom";
const LEVEL_ONE_MESH_SOURCE = "step-level-one-mesh";
const ACTIVE_TRIANGLE_SOURCE = "step-active-triangle";
const ACTIVE_LOCATION_SOURCE = "step-active-location";
const DEG = Math.PI / 180;
const RAD = 180 / Math.PI;

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

function normalizeLon(lon: number) {
  const normalized = ((((lon + 180) % 360) + 360) % 360) - 180;
  return normalized === -180 ? 180 : normalized;
}

function formatArea(areaM2: number) {
  return areaM2 > 1_000_000
    ? `${(areaM2 / 1_000_000).toLocaleString(undefined, { maximumFractionDigits: 1 })} km2`
    : `${areaM2.toLocaleString(undefined, { maximumFractionDigits: 1 })} m2`;
}

function formatDistance(distanceM: number) {
  return distanceM > 1_000
    ? `${(distanceM / 1_000).toLocaleString(undefined, { maximumFractionDigits: 1 })} km`
    : `${distanceM.toLocaleString(undefined, { maximumFractionDigits: 1 })} m`;
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
  const length = Math.hypot(v.x, v.y, v.z) || 1;
  return { x: v.x / length, y: v.y / length, z: v.z / length };
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

function coverBoundsFor(center: MeshCursor, level: number) {
  if (level <= LEVEL_ONE) {
    return { minLat: -90, minLon: -180, maxLat: 90, maxLon: 180 };
  }

  const span = Math.max(0.0002, 120 / 2 ** (level - 1));
  return {
    minLat: clamp(center.lat - span, -90, 90),
    minLon: normalizeLon(center.lon - span),
    maxLat: clamp(center.lat + span, -90, 90),
    maxLon: normalizeLon(center.lon + span),
  };
}

function meshLevelForZoom(zoom: number) {
  return clamp(Math.round(zoom * 2.5 + 1), LEVEL_ONE, MAX_MESH_LEVEL);
}

function emptyFeatureCollection() {
  return { type: "FeatureCollection" as const, features: [] };
}

function splitWrappedLineCoordinates(points: MeshCursor[]) {
  const first = points[0];
  if (!first) return [];

  const closed = [...points, first];
  const segments: [number, number][][] = [];
  let current: [number, number][] = [];
  let previousLon: number | null = null;

  for (const point of closed) {
    const lon = normalizeLon(point.lon);
    const lat = point.lat;

    if (current.length > 0 && previousLon !== null && Math.abs(lon - previousLon) > 180) {
      if (current.length > 1) segments.push(current);
      current = [[lon, lat]];
    } else {
      current.push([lon, lat]);
    }

    previousLon = lon;
  }

  if (current.length > 1) segments.push(current);
  return segments;
}

function triangleLineFeatures(triangle: TriangleInfo | CoverResult["triangles"][number], level: number, role: string) {
  const ring = sphericalRing(triangle.vertices, level);
  return splitWrappedLineCoordinates(ring).map((coordinates, index) => ({
    type: "Feature" as const,
    properties: {
      id: triangle.triangle_id,
      hash: triangle.triangle_id_hash,
      level,
      role,
      segment: index,
    },
    geometry: {
      type: "LineString" as const,
      coordinates,
    },
  }));
}

function mercatorPoint(point: [number, number]) {
  const coordinate = maplibregl.MercatorCoordinate.fromLngLat({
    lng: normalizeLon(point[0]),
    lat: clamp(point[1], -85.051129, 85.051129),
  });
  return [coordinate.x, coordinate.y] as [number, number];
}

function pushLineStrip(target: number[], ring: MeshCursor[]) {
  for (const segment of splitWrappedLineCoordinates(ring)) {
    for (let i = 0; i < segment.length - 1; i += 1) {
      const start = segment[i];
      const end = segment[i + 1];
      if (!start || !end) continue;
      const a = mercatorPoint(start);
      const b = mercatorPoint(end);
      target.push(a[0], a[1], b[0], b[1]);
    }
  }
}

class StepGlobeMeshLayer implements CustomLayerInterface {
  id = STEP_GLOBE_MESH_LAYER;
  type = "custom" as const;
  renderingMode = "2d" as const;

  private data: GlobeMeshLayerData = {
    visibleTriangles: [],
    meshLevel: LEVEL_ONE,
    activeTriangle: null,
  };

  private dataVersion = 0;
  private uploadedVersion = -1;
  private shaderMap = new Map<string, ProjectionShader>();
  private meshBuffer: WebGLBuffer | null = null;
  private activeBuffer: WebGLBuffer | null = null;
  private meshVertexCount = 0;
  private activeVertexCount = 0;

  update(data: GlobeMeshLayerData) {
    this.data = data;
    this.dataVersion += 1;
  }

  onAdd(_map: maplibregl.Map, gl: WebGLRenderingContext | WebGL2RenderingContext) {
    this.meshBuffer = gl.createBuffer();
    this.activeBuffer = gl.createBuffer();
  }

  onRemove(_map: maplibregl.Map, gl: WebGLRenderingContext | WebGL2RenderingContext) {
    if (this.meshBuffer) gl.deleteBuffer(this.meshBuffer);
    if (this.activeBuffer) gl.deleteBuffer(this.activeBuffer);
    for (const shader of this.shaderMap.values()) gl.deleteProgram(shader.program);
    this.shaderMap.clear();
  }

  private getShader(gl: WebGL2RenderingContext, shaderData: CustomRenderMethodInput["shaderData"]) {
    const cached = this.shaderMap.get(shaderData.variantName);
    if (cached) return cached;

    const vertexSource = `#version 300 es
${shaderData.vertexShaderPrelude}
${shaderData.define}
in vec2 a_pos;

void main() {
  gl_Position = projectTile(a_pos);
}`;

    const fragmentSource = `#version 300 es
precision highp float;
uniform vec4 u_color;
out vec4 fragColor;

void main() {
  fragColor = u_color;
}`;

    const vertexShader = this.compileShader(gl, gl.VERTEX_SHADER, vertexSource);
    const fragmentShader = this.compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource);
    const program = gl.createProgram();
    if (!program) throw new Error("Could not create STEP globe mesh shader program.");
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);
    gl.deleteShader(vertexShader);
    gl.deleteShader(fragmentShader);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(gl.getProgramInfoLog(program) || "Could not link STEP globe mesh shader program.");
    }

    const shader: ProjectionShader = {
      program,
      aPos: gl.getAttribLocation(program, "a_pos"),
      uColor: gl.getUniformLocation(program, "u_color"),
      uProjectionFallbackMatrix: gl.getUniformLocation(program, "u_projection_fallback_matrix"),
      uProjectionMatrix: gl.getUniformLocation(program, "u_projection_matrix"),
      uProjectionTileMercatorCoords: gl.getUniformLocation(program, "u_projection_tile_mercator_coords"),
      uProjectionClippingPlane: gl.getUniformLocation(program, "u_projection_clipping_plane"),
      uProjectionTransition: gl.getUniformLocation(program, "u_projection_transition"),
    };
    this.shaderMap.set(shaderData.variantName, shader);
    return shader;
  }

  private compileShader(gl: WebGL2RenderingContext, type: number, source: string) {
    const shader = gl.createShader(type);
    if (!shader) throw new Error("Could not create STEP globe mesh shader.");
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      throw new Error(gl.getShaderInfoLog(shader) || "Could not compile STEP globe mesh shader.");
    }
    return shader;
  }

  private upload(gl: WebGL2RenderingContext) {
    if (this.uploadedVersion === this.dataVersion) return;

    const mesh: number[] = [];
    for (const triangle of this.data.visibleTriangles) {
      pushLineStrip(mesh, sphericalRing(triangle.vertices, this.data.meshLevel));
    }

    const active: number[] = [];
    if (this.data.activeTriangle) {
      pushLineStrip(active, sphericalRing(this.data.activeTriangle.vertices, this.data.activeTriangle.level));
    }

    this.meshVertexCount = this.uploadBuffer(gl, this.meshBuffer, mesh);
    this.activeVertexCount = this.uploadBuffer(gl, this.activeBuffer, active);
    this.uploadedVersion = this.dataVersion;
  }

  private uploadBuffer(gl: WebGL2RenderingContext, buffer: WebGLBuffer | null, points: number[]) {
    if (!buffer) return 0;
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(points), gl.DYNAMIC_DRAW);
    return points.length / 2;
  }

  render(gl: WebGLRenderingContext | WebGL2RenderingContext, args: CustomRenderMethodInput) {
    if (!("createVertexArray" in gl)) return;

    const gl2 = gl as WebGL2RenderingContext;
    this.upload(gl2);

    const shader = this.getShader(gl2, args.shaderData);
    gl2.useProgram(shader.program);
    gl2.uniformMatrix4fv(shader.uProjectionFallbackMatrix, false, args.defaultProjectionData.fallbackMatrix);
    gl2.uniformMatrix4fv(shader.uProjectionMatrix, false, args.defaultProjectionData.mainMatrix);
    gl2.uniform4f(shader.uProjectionTileMercatorCoords, ...args.defaultProjectionData.tileMercatorCoords);
    gl2.uniform4f(shader.uProjectionClippingPlane, ...args.defaultProjectionData.clippingPlane);
    gl2.uniform1f(shader.uProjectionTransition, args.defaultProjectionData.projectionTransition);

    gl2.enable(gl2.BLEND);
    gl2.blendFunc(gl2.SRC_ALPHA, gl2.ONE_MINUS_SRC_ALPHA);
    gl2.disable(gl2.DEPTH_TEST);
    this.drawLines(gl2, shader, this.meshBuffer, this.meshVertexCount, [0.37, 0.92, 0.84, 0.88], 2.5);
    this.drawLines(gl2, shader, this.activeBuffer, this.activeVertexCount, [0.06, 0.73, 0.51, 1], 3.5);
  }

  private drawLines(
    gl: WebGL2RenderingContext,
    shader: ProjectionShader,
    buffer: WebGLBuffer | null,
    vertexCount: number,
    color: [number, number, number, number],
    lineWidth: number,
  ) {
    if (!buffer || vertexCount === 0) return;
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.enableVertexAttribArray(shader.aPos);
    gl.vertexAttribPointer(shader.aPos, 2, gl.FLOAT, false, 0, 0);
    gl.uniform4f(shader.uColor, ...color);
    gl.lineWidth(lineWidth);
    gl.drawArrays(gl.LINES, 0, vertexCount);
  }
}

function isFrontHemisphere(point: MeshCursor, center: MeshCursor) {
  return dot(latLonToVec(point), latLonToVec(center)) >= 0;
}

function projectedVisiblePaths(
  map: maplibregl.Map,
  ring: MeshCursor[],
  center: MeshCursor,
  width: number,
  height: number,
) {
  const first = ring[0];
  const closed = first ? [...ring, first] : [];
  const paths: string[] = [];
  let current = "";
  let previous: { x: number; y: number } | null = null;

  for (const point of closed) {
    if (!isFrontHemisphere(point, center)) {
      if (current) paths.push(current);
      current = "";
      previous = null;
      continue;
    }

    const projected = map.project([normalizeLon(point.lon), point.lat]);
    if (!Number.isFinite(projected.x) || !Number.isFinite(projected.y)) {
      if (current) paths.push(current);
      current = "";
      previous = null;
      continue;
    }

    if (
      previous &&
      Math.hypot(projected.x - previous.x, projected.y - previous.y) > Math.max(width, height) * 0.45
    ) {
      if (current) paths.push(current);
      current = "";
      previous = null;
    }

    current += current
      ? ` L ${projected.x.toFixed(2)} ${projected.y.toFixed(2)}`
      : `M ${projected.x.toFixed(2)} ${projected.y.toFixed(2)}`;
    previous = { x: projected.x, y: projected.y };
  }

  if (current) paths.push(current);
  return paths;
}

function unwrapRingForBounds(points: MeshCursor[]) {
  const first = points[0];
  if (!first) return [];

  let previousLon: number | null = null;
  return [...points, first].map((point) => {
    let lon = normalizeLon(point.lon);
    if (previousLon !== null) {
      while (lon - previousLon > 180) lon -= 360;
      while (lon - previousLon < -180) lon += 360;
    }
    previousLon = lon;
    return [lon, point.lat] as [number, number];
  });
}

function triangleBounds(triangle: TriangleInfo) {
  const ring = unwrapRingForBounds(sphericalRing(triangle.vertices, triangle.level));
  if (ring.length === 0) return null;

  let minLon = Infinity;
  let minLat = Infinity;
  let maxLon = -Infinity;
  let maxLat = -Infinity;

  for (const [lon, lat] of ring) {
    minLon = Math.min(minLon, lon);
    minLat = Math.min(minLat, lat);
    maxLon = Math.max(maxLon, lon);
    maxLat = Math.max(maxLat, lat);
  }

  if (![minLon, minLat, maxLon, maxLat].every(Number.isFinite)) return null;
  return [
    [minLon, minLat],
    [maxLon, maxLat],
  ] as [[number, number], [number, number]];
}

function focusTriangle(map: maplibregl.Map, triangle: TriangleInfo) {
  const bounds = triangleBounds(triangle);
  if (bounds) {
    map.fitBounds(bounds, {
      padding: { top: 96, right: 72, bottom: 96, left: 72 },
      maxZoom: MAX_GLOBE_ZOOM,
      duration: 900,
    });
    return;
  }

  map.flyTo({
    center: [triangle.centroid.lon, triangle.centroid.lat],
    zoom: Math.min(MAX_GLOBE_ZOOM, Math.max(1.25, triangle.level * 0.6)),
    pitch: 0,
    bearing: 0,
    duration: 900,
  });
}

function ensureLayerStack(map: maplibregl.Map) {
  if (!map.getSource(LEVEL_ONE_MESH_SOURCE)) {
    map.addSource(LEVEL_ONE_MESH_SOURCE, { type: "geojson", data: emptyFeatureCollection() });
  }
  if (!map.getSource(ACTIVE_TRIANGLE_SOURCE)) {
    map.addSource(ACTIVE_TRIANGLE_SOURCE, { type: "geojson", data: emptyFeatureCollection() });
  }
  if (!map.getSource(ACTIVE_LOCATION_SOURCE)) {
    map.addSource(ACTIVE_LOCATION_SOURCE, { type: "geojson", data: emptyFeatureCollection() });
  }

  const labelLayerId = map.getStyle().layers?.find((layer) => layer.type === "symbol")?.id;

  if (!map.getLayer("step-level-one-mesh-line")) {
    map.addLayer(
      {
        id: "step-level-one-mesh-line",
        type: "line",
        source: LEVEL_ONE_MESH_SOURCE,
        paint: {
          "line-color": "#5eead4",
          "line-width": [
            "interpolate",
            ["linear"],
            ["zoom"],
            0,
            3.2,
            1,
            2.8,
            2,
            2.3,
            4,
            1.5,
          ],
          "line-opacity": 0.98,
        },
      },
      labelLayerId,
    );
  }

  if (!map.getLayer("step-active-triangle-line")) {
    map.addLayer(
      {
        id: "step-active-triangle-line",
        type: "line",
        source: ACTIVE_TRIANGLE_SOURCE,
        paint: {
          "line-color": "#10b981",
          "line-width": [
            "interpolate",
            ["linear"],
            ["zoom"],
            0,
            5.6,
            1,
            5,
            2,
            4.4,
            4,
            2.8,
          ],
          "line-opacity": 0.95,
        },
      },
      labelLayerId,
    );
  }

  if (!map.getLayer("step-active-location-dot")) {
    map.addLayer({
      id: "step-active-location-dot",
      type: "circle",
      source: ACTIVE_LOCATION_SOURCE,
      paint: {
        "circle-radius": [
          "interpolate",
          ["linear"],
          ["zoom"],
          1,
          4,
          4,
          5,
          8,
          6.5,
          12,
          8,
        ],
        "circle-color": "#111827",
        "circle-stroke-color": "#ffffff",
        "circle-stroke-width": 2,
      },
    });
  }
}

export function MapView() {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const meshLayerRef = useRef<StepGlobeMeshLayer | null>(null);
  const mapLoadedRef = useRef(false);
  const coverRequestRef = useRef(0);
  const coverDebounceRef = useRef<number | null>(null);
  const [overlayRevision, setOverlayRevision] = useState(0);

  const [cover, setCover] = useState<CoverResult | null>(null);
  const [meshLevel, setMeshLevel] = useState(LEVEL_ONE);
  const [gpsCursor, setGpsCursor] = useState<MeshCursor | null>(null);
  const [gpsTriangle, setGpsTriangle] = useState<TriangleInfo | null>(null);
  const [gpsTriangleState, setGpsTriangleState] = useState<Partial<MeshState>>({});
  const [loading, setLoading] = useState(false);
  const [coverError, setCoverError] = useState<string | null>(null);
  const [locationStatus, setLocationStatus] = useState<string | null>(null);

  const loadVisibleCover = useCallback(async (center: MeshCursor, zoom: number) => {
    const level = meshLevelForZoom(zoom);
    const requestId = coverRequestRef.current + 1;
    coverRequestRef.current = requestId;
    setMeshLevel(level);
    setCoverError(null);
    try {
      const nextCover = await mesh.cover(coverBoundsFor(center, level), level, level === LEVEL_ONE ? 128 : 6000);
      if (coverRequestRef.current !== requestId) return;
      setCover(nextCover);
    } catch (error) {
      if (coverRequestRef.current !== requestId) return;
      setCover(null);
      setCoverError(error instanceof Error ? error.message : "mesh cover API unreachable");
    }
  }, []);

  const scheduleCoverLoad = useCallback(
    (center: MeshCursor, zoom: number) => {
      if (coverDebounceRef.current !== null) {
        window.clearTimeout(coverDebounceRef.current);
      }
      coverDebounceRef.current = window.setTimeout(
        () => {
          void loadVisibleCover(center, zoom);
        },
        zoom <= 0.5 ? 0 : 180,
      );
    },
    [loadVisibleCover],
  );

  const fetchResolvedTriangle = useCallback(async (lat: number, lon: number) => {
    let resolved: TriangleInfo;
    try {
      const frontier = await mesh.mineable(lat, lon);
      resolved = await mesh.triangle(frontier.triangle_id);
    } catch {
      resolved = await mesh.resolve(lat, lon, LEVEL_ONE);
    }

    const { states } = await mesh.states([resolved.triangle_id_hash]);
    return {
      triangle: resolved,
      state: (states[0] ?? {}) as Partial<MeshState>,
    };
  }, []);

  const syncMapData = useCallback(() => {
    const map = mapRef.current;
    if (!map || !mapLoadedRef.current) return;

    const meshSource = map.getSource(LEVEL_ONE_MESH_SOURCE) as maplibregl.GeoJSONSource | undefined;
    meshSource?.setData({
      type: "FeatureCollection",
      features: (cover?.triangles ?? []).flatMap((triangle) => triangleLineFeatures(triangle, meshLevel, "visible-mesh")),
    });

    const activeTriangleSource = map.getSource(ACTIVE_TRIANGLE_SOURCE) as maplibregl.GeoJSONSource | undefined;
    activeTriangleSource?.setData(
      gpsTriangle
        ? {
            type: "FeatureCollection",
            features: triangleLineFeatures(gpsTriangle, gpsTriangle.level, "active-triangle"),
          }
        : emptyFeatureCollection(),
    );

    const activeLocationSource = map.getSource(ACTIVE_LOCATION_SOURCE) as maplibregl.GeoJSONSource | undefined;
    activeLocationSource?.setData(
      gpsCursor
        ? {
            type: "FeatureCollection",
            features: [
              {
                type: "Feature",
                properties: { role: "active-location" },
                geometry: {
                  type: "Point",
                  coordinates: [gpsCursor.lon, gpsCursor.lat] as [number, number],
                },
              },
            ],
          }
        : emptyFeatureCollection(),
    );

    meshLayerRef.current?.update({
      visibleTriangles: cover?.triangles ?? [],
      meshLevel,
      activeTriangle: gpsTriangle,
    });
    map.triggerRepaint();
  }, [cover?.triangles, gpsCursor, gpsTriangle, meshLevel]);

  const lockAt = useCallback(
    async (lat: number, lon: number, options?: { focus?: boolean }) => {
      setLoading(true);
      setCoverError(null);
      try {
        const normalizedLon = normalizeLon(lon);
        const { triangle, state } = await fetchResolvedTriangle(lat, normalizedLon);

        setGpsCursor({ lat, lon: normalizedLon });
        setGpsTriangle(triangle);
        setGpsTriangleState(state);

        if (options?.focus && mapRef.current) {
          focusTriangle(mapRef.current, triangle);
        }
      } catch (error) {
        setCoverError(error instanceof Error ? error.message : "mesh resolve API unreachable");
      } finally {
        setLoading(false);
      }
    },
    [fetchResolvedTriangle],
  );

  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: MINING_MAP_STYLE,
      center: INITIAL_CENTER,
      zoom: INITIAL_ZOOM,
      pitch: 0,
      bearing: 0,
      renderWorldCopies: false,
      attributionControl: { compact: true },
      canvasContextAttributes: { antialias: true },
      maxZoom: MAX_GLOBE_ZOOM,
    } as unknown as maplibregl.MapOptions);

    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: false, showCompass: false }), "top-right");

    map.on("style.load", () => {
      (map as maplibregl.Map & { setProjection: (projection: { type: "globe" }) => void }).setProjection({
        type: "globe",
      });
      const labelLayerId = map.getStyle().layers?.find((layer) => layer.type === "symbol")?.id;
      const globeMeshLayer = new StepGlobeMeshLayer();
      meshLayerRef.current = globeMeshLayer;
      if (!map.getLayer(STEP_GLOBE_MESH_LAYER)) {
        map.addLayer(globeMeshLayer, labelLayerId);
      }
      ensureLayerStack(map);
      mapLoadedRef.current = true;
      syncMapData();
      const center = map.getCenter();
      scheduleCoverLoad({ lat: center.lat, lon: center.lng }, map.getZoom());
      setOverlayRevision((value) => value + 1);
    });

    map.on("zoomend", () => {
      if (map.getZoom() > MAX_GLOBE_ZOOM) {
        map.easeTo({ zoom: MAX_GLOBE_ZOOM, duration: 200 });
      }
    });

    const syncCoverFromMap = () => {
      const center = map.getCenter();
      scheduleCoverLoad({ lat: center.lat, lon: center.lng }, map.getZoom());
    };
    map.on("moveend", syncCoverFromMap);
    map.on("resize", syncCoverFromMap);

    const refreshOverlay = () => {
      setOverlayRevision((value) => value + 1);
    };
    map.on("move", refreshOverlay);
    map.on("resize", refreshOverlay);

    return () => {
      mapLoadedRef.current = false;
      if (coverDebounceRef.current !== null) {
        window.clearTimeout(coverDebounceRef.current);
        coverDebounceRef.current = null;
      }
      map.off("moveend", syncCoverFromMap);
      map.off("resize", syncCoverFromMap);
      map.off("move", refreshOverlay);
      map.remove();
      mapRef.current = null;
      meshLayerRef.current = null;
    };
  }, [scheduleCoverLoad, syncMapData]);

  useEffect(() => {
    syncMapData();
  }, [syncMapData]);

  const useMyLocation = useCallback(() => {
    if (!navigator.geolocation) {
      setLocationStatus("Geolocation is not available in this browser.");
      return;
    }

    setLocationStatus("Waiting for GPS...");
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const lat = position.coords.latitude;
        const lon = normalizeLon(position.coords.longitude);
        setLocationStatus(`Using current location, accuracy ${Math.round(position.coords.accuracy)} m.`);
        void lockAt(lat, lon, { focus: true });
      },
      (error) => {
        setLocationStatus(error.message || "Could not read location.");
      },
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 5_000 },
    );
  }, [lockAt]);

  const focusMyTriangle = useCallback(() => {
    if (!gpsTriangle || !mapRef.current) return;
    focusTriangle(mapRef.current, gpsTriangle);
  }, [gpsTriangle]);

  const showEarth = useCallback(() => {
    mapRef.current?.flyTo({
      center: INITIAL_CENTER,
      zoom: EARTH_ZOOM,
      pitch: 0,
      bearing: 0,
      duration: 900,
    });
  }, []);

  const activeSlots = useMemo(() => {
    const used = gpsTriangleState.used_slots ?? 0;
    const total = gpsTriangleState.total_slots ?? 27;
    return {
      used,
      total,
      remaining: Math.max(0, total - used),
    };
  }, [gpsTriangleState.total_slots, gpsTriangleState.used_slots]);

  const activeTriangleLabel = gpsTriangle ? `Level ${gpsTriangle.level}` : "-";
  const visibleMeshLabel = `Level ${meshLevel}`;

  const overlay = useMemo(() => {
    const map = mapRef.current;
    const container = mapContainerRef.current;
    if (!map || !container) {
      return {
        width: 0,
        height: 0,
        meshPaths: [] as string[],
        activePaths: [] as string[],
        activePoint: null as { x: number; y: number } | null,
      };
    }

    const width = container.clientWidth;
    const height = container.clientHeight;
    if (!width || !height) {
      return {
        width: 0,
        height: 0,
        meshPaths: [] as string[],
        activePaths: [] as string[],
        activePoint: null as { x: number; y: number } | null,
      };
    }

    const center = map.getCenter();
    const centerCursor = { lat: center.lat, lon: center.lng };

    const meshPaths = ((cover?.triangles ?? []) as CoverResult["triangles"]).flatMap((triangle) =>
      projectedVisiblePaths(map, sphericalRing(triangle.vertices, meshLevel), centerCursor, width, height),
    );

    const activePaths = gpsTriangle
      ? projectedVisiblePaths(map, sphericalRing(gpsTriangle.vertices, gpsTriangle.level), centerCursor, width, height)
      : [];

    const activePoint =
      gpsCursor && isFrontHemisphere(gpsCursor, centerCursor)
        ? (() => {
            const projected = map.project([gpsCursor.lon, gpsCursor.lat]);
            return Number.isFinite(projected.x) && Number.isFinite(projected.y)
              ? { x: projected.x, y: projected.y }
              : null;
          })()
        : null;

    return {
      width,
      height,
      meshPaths,
      activePaths,
      activePoint,
    };
  }, [cover?.triangles, gpsCursor, gpsTriangle, meshLevel, overlayRevision]);

  if (!meshConfigured) {
    return (
      <EmptyState
        title="Live map is coming online"
        description="The mining map needs the STEP mesh and indexer endpoints. Production should build with same-origin /api routes."
      />
    );
  }

  return (
    <Stack gap="md">
      <Group grow>
        <MetricCard
          label="Visible mesh"
          value={visibleMeshLabel}
          description={cover ? `${cover.triangles.length} live triangles on the globe` : "Loading live spherical cover"}
        />
        <MetricCard
          label="Active triangle"
          value={activeTriangleLabel}
          description={gpsTriangle ? gpsTriangle.triangle_id : "Use your location to lock mining"}
        />
        <MetricCard
          label="Active size"
          value={gpsTriangle ? formatDistance(gpsTriangle.min_side_m) : "-"}
          description={gpsTriangle ? formatArea(gpsTriangle.area_m2) : "GPS-locked spherical triangle"}
        />
        <MetricCard
          label="Active slots"
          value={gpsTriangle ? `${activeSlots.used}/${activeSlots.total}` : "-"}
          description={gpsTriangle ? `${activeSlots.remaining} left` : "availability"}
          trend={
            gpsTriangle
              ? activeSlots.remaining > 0
                ? { label: gpsTriangleState.state ?? "open", tone: "positive" }
                : { label: "desert", tone: "negative" }
              : undefined
          }
        />
        <MetricCard
          label="Selection"
          value={gpsTriangle ? "Current only" : "No GPS lock"}
          description="Rotate and zoom freely; other triangles stay discoverable but unselected."
        />
      </Group>

      <Group gap="sm">
        <Button onClick={useMyLocation} loading={loading}>
          Use my location
        </Button>
        <Button onClick={focusMyTriangle} variant="light" disabled={!gpsTriangle}>
          Focus my triangle
        </Button>
        <Button onClick={showEarth} variant="subtle">
          Show Earth
        </Button>
      </Group>

      {locationStatus && (
        <Text size="sm" c="dimmed" aria-live="polite">
          {locationStatus}
        </Text>
      )}
      {coverError && (
        <Text size="sm" c="red" aria-live="assertive">
          {coverError}
        </Text>
      )}
      {cover?.truncated && (
        <Text size="sm" c="yellow" aria-live="polite">
          Visible cover truncated at level {meshLevel}. Suggested level {cover.suggested_level}.
        </Text>
      )}

      <Paper withBorder radius="lg" p="md" style={{ overflow: "hidden" }}>
        <Group justify="space-between" align="center" mb="sm">
          <div>
            <Text fw={700}>Earth mesh</Text>
            <Text size="sm" c="dimmed">
              MapLibre globe is the single source of truth: Earth, the live spherical mesh cover, and your GPS-locked mining triangle all live on this same object.
            </Text>
          </div>
          <Text size="sm" c="dimmed">
            {gpsTriangle ? `Current triangle level ${gpsTriangle.level}` : `Discovering visible mesh level ${meshLevel}`}
          </Text>
        </Group>

        <div style={{ position: "relative", height: "min(76vh, 760px)", minHeight: 520, width: "100%" }}>
          <div
            ref={mapContainerRef}
            role="application"
            aria-label="MapLibre globe showing Earth, the STEP spherical mesh, and the current mining triangle"
            style={{ position: "absolute", inset: 0 }}
          />
          {overlay.width > 0 && overlay.height > 0 && (
            <svg
              viewBox={`0 0 ${overlay.width} ${overlay.height}`}
              width={overlay.width}
              height={overlay.height}
              aria-hidden="true"
              style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }}
            >
              {overlay.meshPaths.map((path, index) => (
                <path
                  key={`mesh-${index}`}
                  d={path}
                  fill="none"
                  stroke="#5eead4"
                  strokeWidth="2.6"
                  opacity="0.92"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              ))}
              {overlay.activePaths.map((path, index) => (
                <path
                  key={`active-${index}`}
                  d={path}
                  fill="none"
                  stroke="#10b981"
                  strokeWidth="4.8"
                  opacity="1"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              ))}
              {overlay.activePoint && (
                <g>
                  <circle cx={overlay.activePoint.x} cy={overlay.activePoint.y} r="8" fill="#111827" stroke="#ffffff" strokeWidth="2.5" />
                  <circle cx={overlay.activePoint.x} cy={overlay.activePoint.y} r="18" fill="none" stroke="#f8fafc" strokeWidth="1.5" opacity="0.65" />
                </g>
              )}
            </svg>
          )}
        </div>

        <Text mt="sm" size="sm" c="dimmed">
          {gpsTriangle
            ? "Green = your GPS-locked mining triangle. The globe is discover-only: rotate and zoom freely, but only your real current triangle stays selected. The location dot only changes when your real location changes."
            : "Rotate and zoom to discover the live mesh. Use your location to lock your real current triangle and location dot."}
        </Text>
      </Paper>
    </Stack>
  );
}
