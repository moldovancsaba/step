# STEP Mesh Globe Visual SSOT

**Status:** implemented on web, embedded by iOS map tab  
**Canonical surface:** `https://step.moldovancsaba.workers.dev/?surface=ios-map`

## Definition

The STEP mining map has one visual source of truth: a MapLibre GL JS v5 globe that renders Earth, the full level-1 spherical icosahedron mesh, the GPS-locked mining triangle, and any inspected triangle on the same globe object.

This replaces flat-map-only visualizations as the canonical user-facing mesh view. Flat maps may still be used as fallback or operational context, but they are not the primary proof/mining map.

## Implementation Contract

- Renderer: `maplibre-gl` v5.24.0 or newer.
- Projection: MapLibre `globe`.
- Mesh layer: custom MapLibre WebGL layer `step-globe-mesh-custom`.
- Shader path: MapLibre-provided `projectTile(a_pos)` via `shaderData.vertexShaderPrelude` and `shaderData.define`.
- Geometry: spherical triangle vertices from the mesh API, densified as great-circle arcs before upload.
- Root cover: all 20 level-1 icosahedron faces loaded through `/api/gateway/v1/mesh/cover`.
- Active mining triangle: GPS-locked; it changes only when real device location resolves into another mineable triangle.
- Inspection triangle: user can tap/explore the globe without moving the mining triangle.

## Runtime Flow

1. Load the level-1 global cover from the gateway mesh API.
2. Initialise MapLibre with `projection: globe` and a low Earth zoom so the sphere remains visually clear.
3. Add `step-globe-mesh-custom` before label layers.
4. Convert triangle edge samples to Mercator tile coordinates.
5. Let MapLibre's globe shader project them onto the same Earth object as the basemap.
6. On GPS lock, resolve the current mineable triangle and highlight it separately from any inspected triangle.

## Accessibility

- The globe remains an interactive map surface with an application-level label.
- Colour is not the only state channel; metric cards and labels expose active level, triangle id, size, slot count, and inspected triangle.
- The location dot is not draggable and is not used as a UI affordance for changing the mining triangle.

## iOS Contract

The iOS Map tab embeds the same canonical globe through `WKWebView` when `WebAppURL` is configured. MapLibre Native is not a production dependency; unavailable WebKit/non-iOS contexts fall back to a non-interactive unavailable state instead of a second map implementation.

`Info.plist` configuration:

```text
StepConfig.WebAppURL = $(STEP_WEB_APP_URL)
```

Default:

```text
https://step.moldovancsaba.workers.dev/?surface=ios-map
```

## Verification

The deployed web bundle must contain:

- `step-globe-mesh-custom`
- `projectTile(a_pos)`
- MapLibre GL JS v5 assets

The live mesh cover must return 20 level-1 triangles before the map is accepted for release.
