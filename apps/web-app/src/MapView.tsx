/**
 * Oasis/desert map (#17) on GDS MapPanel. Fetches the viewport triangle cover
 * (#15) and their mining-depletion states (#16), then renders an SVG overlay
 * coloured green (oasis, mineable) → red (desert, mined out) at ~30% opacity.
 * Truncated viewports surface the engine's coarser suggested level.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { MapPanel, MetricCard } from "@doneisbetter/gds";
import { Button, Group, NumberInput, Stack, Text } from "@mantine/core";
import { mesh, type CoverTriangle, type MeshState } from "./api.js";

interface ViewState {
  centerLat: number;
  centerLon: number;
  level: number;
  span: number; // degrees half-extent
}

const GREEN: readonly [number, number, number] = [34, 170, 51];
const RED: readonly [number, number, number] = [220, 40, 40];

function depletionColor(d: number): string {
  const r = Math.round(GREEN[0] + (RED[0] - GREEN[0]) * d);
  const g = Math.round(GREEN[1] + (RED[1] - GREEN[1]) * d);
  const b = Math.round(GREEN[2] + (RED[2] - GREEN[2]) * d);
  return `rgba(${r}, ${g}, ${b}, 0.32)`; // ~30% opacity overlay
}

export function MapView() {
  const [view, setView] = useState<ViewState>({
    centerLat: 47.4979,
    centerLon: 19.0402,
    level: 10,
    span: 0.05,
  });
  const [triangles, setTriangles] = useState<CoverTriangle[]>([]);
  const [states, setStates] = useState<Map<string, MeshState>>(new Map());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [truncatedTo, setTruncatedTo] = useState<number | null>(null);

  const bbox = useMemo(
    () => ({
      minLat: view.centerLat - view.span,
      minLon: view.centerLon - view.span,
      maxLat: view.centerLat + view.span,
      maxLon: view.centerLon + view.span,
    }),
    [view],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setTruncatedTo(null);
    try {
      const cover = await mesh.cover(bbox, view.level, 2000);
      if (cover.truncated) {
        setTruncatedTo(cover.suggested_level);
        setTriangles([]);
        setStates(new Map());
        return;
      }
      setTriangles(cover.triangles);
      const { states: ms } = await mesh.states(cover.triangles.map((t) => t.triangle_id_hash));
      setStates(new Map(ms.map((s) => [s.triangle_id_hash.toLowerCase(), s])));
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed to load map");
    } finally {
      setLoading(false);
    }
  }, [bbox, view.level]);

  useEffect(() => {
    void load();
  }, [load]);

  const counts = useMemo(() => {
    let oasis = 0,
      filling = 0,
      desert = 0;
    for (const s of states.values()) {
      if (s.state === "oasis") oasis++;
      else if (s.state === "filling") filling++;
      else desert++;
    }
    return { oasis, filling, desert };
  }, [states]);

  // Project lat/lon to the 0..1000 SVG box (lat inverted so north is up).
  const project = useCallback(
    (lat: number, lon: number): [number, number] => {
      const x = ((lon - bbox.minLon) / (bbox.maxLon - bbox.minLon)) * 1000;
      const y = (1 - (lat - bbox.minLat) / (bbox.maxLat - bbox.minLat)) * 1000;
      return [x, y];
    },
    [bbox],
  );

  const renderMap = useCallback(
    () => (
      <svg viewBox="0 0 1000 1000" role="img" aria-label="Mesh oasis and desert overlay" style={{ width: "100%", height: "100%", background: "var(--mantine-color-dark-8, #0b1014)" }}>
        {triangles.map((t) => {
          const st = states.get(t.triangle_id_hash.toLowerCase());
          const d = st ? st.depletion : 0;
          const pts = t.vertices.map((v) => project(v.lat, v.lon).join(",")).join(" ");
          return (
            <polygon
              key={t.triangle_id}
              points={pts}
              fill={depletionColor(d)}
              stroke="rgba(255,255,255,0.18)"
              strokeWidth={0.6}
            >
              <title>
                {t.triangle_id} — {st ? `${st.used_slots}/${st.total_slots} slots (${st.state})` : "oasis"}
              </title>
            </polygon>
          );
        })}
      </svg>
    ),
    [triangles, states, project],
  );

  return (
    <Stack gap="md">
      <Group grow>
        <MetricCard label="Oasis" value={counts.oasis} description="mineable" trend={{ label: "open", tone: "positive" }} />
        <MetricCard label="Filling" value={counts.filling} description="partly mined" />
        <MetricCard label="Desert" value={counts.desert} description="mined out" trend={{ label: "closed", tone: "negative" }} />
      </Group>

      <Group align="flex-end" gap="sm">
        <NumberInput
          label="Center latitude"
          value={view.centerLat}
          onChange={(v) => setView((s) => ({ ...s, centerLat: Number(v) || 0 }))}
          decimalScale={4}
          step={0.01}
          w={140}
        />
        <NumberInput
          label="Center longitude"
          value={view.centerLon}
          onChange={(v) => setView((s) => ({ ...s, centerLon: Number(v) || 0 }))}
          decimalScale={4}
          step={0.01}
          w={140}
        />
        <NumberInput
          label="Level"
          value={view.level}
          onChange={(v) => setView((s) => ({ ...s, level: Math.max(1, Math.min(21, Number(v) || 1)) }))}
          min={1}
          max={21}
          w={90}
        />
        <Button onClick={() => void load()} loading={loading}>
          Refresh
        </Button>
      </Group>

      <MapPanel
        title="Triangle oasis & desert"
        description="Green = open to mine, red = mined out. Click and hold a triangle for detail."
        loading={loading}
        error={error ?? undefined}
        renderMap={renderMap}
        minHeight={420}
        empty={
          truncatedTo != null ? (
            <Text>Too many triangles at this zoom. Try level {truncatedTo} or a smaller area.</Text>
          ) : (
            <Text>No triangles in view.</Text>
          )
        }
      />
    </Stack>
  );
}
