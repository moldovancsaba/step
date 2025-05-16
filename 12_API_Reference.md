# STEP - Triangle Mesh API Reference

## Table of Contents
- [Core Types](#core-types)
  - [Geometry Types](#geometry-types)
  - [Model Types](#model-types)
- [Utility Functions](#utility-functions)
  - [Geometry Functions](#geometry-functions)
  - [Mesh Manipulation](#mesh-manipulation)
  - [Mapping Functions](#mapping-functions)
- [Database Integration](#database-integration)
  - [Connection Management](#connection-management)
  - [Models and Schemas](#models-and-schemas)
- [State Management](#state-management)
  - [Triangle Mesh Store](#triangle-mesh-store)
  - [Store Actions](#store-actions)
- [React Hooks](#react-hooks)
  - [useTriangleMesh Hook](#usetrianglemesh-hook)
  - [Helper Hooks](#helper-hooks)
- [Usage Examples](#usage-examples)

## Core Types

### Geometry Types

#### `GeoCoordinate`
Geographic coordinates representing latitude and longitude.

```typescript
interface GeoCoordinate {
  latitude: number;  // -90 to 90 degrees
  longitude: number; // -180 to 180 degrees
}
```

#### `TriangleFace`
Represents a triangle in the mesh with metadata.

```typescript
interface TriangleFace {
  id: string;
  vertices: [number, number, number]; // Indices of the vertices in the vertices array
  level: number;                      // Subdivision level (0-19)
  clickCount: number;                 // Number of times clicked (0-10)
  color: string;                      // CSS color string
  parentFaceId?: string;              // Reference to parent face if subdivided
}
```

#### `TriangleMesh`
Complete triangle mesh representation.

```typescript
interface TriangleMesh {
  vertices: GeoCoordinate[];        // Vertices as geographic coordinates
  faces: TriangleFace[];            // Triangle faces
}
```

#### `SubdivisionResult`
Result of subdividing a triangle face.

```typescript
interface SubdivisionResult {
  newVertices: GeoCoordinate[];
  newFaces: TriangleFace[];
  parentFaceId: string;
}
```

#### `MeshStats`
Statistics about the triangle mesh.

```typescript
interface MeshStats {
  totalVertices: number;
  totalFaces: number;
  maxLevel: number;
  totalClicks: number;
  subdivisionsByLevel: Array<{
    level: number;
    count: number;
  }>;
}
```

#### `MapProjection`
Map projection parameters for transforming between geographic and screen coordinates.

```typescript
interface MapProjection {
  zoom: number;
  center: GeoCoordinate;
  width: number;
  height: number;
  rotation?: number;
}
```

#### `ScreenCoordinate`
Screen coordinates in pixels.

```typescript
interface ScreenCoordinate {
  x: number;
  y: number;
}
```

#### `OsmTileCoordinates`
OpenStreetMap tile coordinates.

```typescript
interface OsmTileCoordinates {
  x: number;
  y: number;
  z: number; // zoom level
}
```

### Model Types

#### `TriangleMeshDocument`
MongoDB model for storing triangle mesh data.

```typescript
interface TriangleMeshDocument {
  _id?: string;
  vertices: GeoCoordinate[];
  faces: TriangleFace[];
  createdAt: Date;
  updatedAt: Date;
}
```

#### `InteractionDocument`
MongoDB model for user interaction history.

```typescript
interface InteractionDocument {
  _id?: string;
  faceId: string;
  action: 'click' | 'subdivide';
  timestamp: Date;
  userId?: string; // For future user authentication
}
```

#### `SessionDocument`
MongoDB model for project session information.

```typescript
interface SessionDocument {
  _id?: string;
  startTime: Date;
  endTime?: Date;
  interactions: number;
  subdivisions: number;
  maxLevelReached: number;
}
```

## Utility Functions

### Geometry Functions

#### `geoMidpoint(coord1: GeoCoordinate, coord2: GeoCoordinate): GeoCoordinate`
Calculate the midpoint between two geographic coordinates using the Haversine formula.

```typescript
const midpoint = geoMidpoint(
  { latitude: 40.7128, longitude: -74.0060 }, // New York
  { latitude: 34.0522, longitude: -118.2437 } // Los Angeles
);
// Returns the geographic midpoint between the two cities
```

#### `calculateSphericalTriangleArea(triangle: [GeoCoordinate, GeoCoordinate, GeoCoordinate]): number`
Calculate the area of a triangle on a sphere in square kilometers using the spherical excess formula.

```typescript
const area = calculateSphericalTriangleArea([
  { latitude: 0, longitude: 0 },
  { latitude: 0, longitude: 1 },
  { latitude: 1, longitude: 0 }
]);
// Returns the area in square kilometers
```

#### `generateTriangleId(): string`
Generate a unique ID for a triangle face.

```typescript
const id = generateTriangleId();
// Returns a string like "triangle-1a2b3c4d5"
```

#### `isPointInTriangle(point: ScreenCoordinate, triangle: [ScreenCoordinate, ScreenCoordinate, ScreenCoordinate]): boolean`
Check if a point is inside a triangle using barycentric coordinates.

```typescript
const isInside = isPointInTriangle(
  { x: 100, y: 100 },
  [{ x: 50, y: 50 }, { x: 150, y: 50 }, { x: 100, y: 150 }]
);
// Returns true if the point is inside the triangle
```

### Mesh Manipulation

#### `createInitialMesh(): TriangleMesh`
Create initial triangle mesh with icosahedron faces.

```typescript
const initialMesh = createInitialMesh();
// Returns a mesh with 12 vertices and 20 triangular faces
```

#### `subdivideFace(mesh: TriangleMesh, faceId: string): SubdivisionResult | null`
Subdivide a triangle face into 4 smaller triangles.

```typescript
const result = subdivideFace(mesh, "triangle-123abc");
if (result) {
  const { newVertices, newFaces, parentFaceId } = result;
  // Use these to update the mesh
}
```

#### `getColorForClickCount(clickCount: number, level: number): string`
Get color for a triangle based on click count and level.

```typescript
const color = getColorForClickCount(5, 2);
// Returns a CSS color string like "rgb(50%, 50%, 50%)"
```

#### `incrementClickCount(face: TriangleFace): TriangleFace`
Increment the click count for a triangle face.

```typescript
const updatedFace = incrementClickCount(face);
// Returns a new face object with incremented clickCount and updated color
```

#### `updateTriangleColor(face: TriangleFace): TriangleFace`
Update triangle face color based on click count.

```typescript
const updatedFace = updateTriangleColor(face);
// Returns a new face object with updated color
```

#### `calculateMeshStats(mesh: TriangleMesh): MeshStats`
Calculate statistics about the triangle mesh.

```typescript
const stats = calculateMeshStats(mesh);
// Returns statistics like totalVertices, totalFaces, etc.
```

### Mapping Functions

#### `geoToScreen(coord: GeoCoordinate, projection: MapProjection): ScreenCoordinate`
Convert geographic coordinates to screen coordinates using Web Mercator projection.

```typescript
const screenCoord = geoToScreen(
  { latitude: 40.7128, longitude: -74.0060 },
  { zoom: 10, center: { latitude: 40, longitude: -74 }, width: 800, height: 600 }
);
// Returns { x: 400, y: 300 } (screen coordinates)
```

#### `screenToGeo(screen: ScreenCoordinate, projection: MapProjection): GeoCoordinate`
Convert screen coordinates to geographic coordinates.

```typescript
const geoCoord = screenToGeo(
  { x: 400, y: 300 },
  { zoom: 10, center: { latitude: 40, longitude: -74 }, width: 800, height: 600 }
);
// Returns geographic coordinates
```

#### `triangleToScreen(face: TriangleFace, mesh: TriangleMesh, projection: MapProjection): [ScreenCoordinate, ScreenCoordinate, ScreenCoordinate]`
Convert triangle face to screen coordinates.

```typescript
const screenCoords = triangleToScreen(face, mesh, projection);
// Returns an array of three screen coordinates
```

#### `geoToOsmTile(coord: GeoCoordinate, zoom: number): OsmTileCoordinates`
Convert geographic coordinates to OpenStreetMap tile coordinates.

```typescript
const tileCoords = geoToOsmTile({ latitude: 40.7128, longitude: -74.0060 }, 10);
// Returns { x: 300, y: 384, z: 10 } (tile coordinates)
```

#### `osmTileToGeo(tile: OsmTileCoordinates): GeoCoordinate`
Convert OpenStreetMap tile coordinates to geographic coordinates.

```typescript
const geoCoord = osmTileToGeo({ x: 300, y: 384, z: 10 });
// Returns geographic coordinates
```

#### `isTriangleVisible(face: TriangleFace, mesh: TriangleMesh, projection: MapProjection): boolean`
Check if a triangle is visible within the current map view.

```typescript
const isVisible = isTriangleVisible(face, mesh, projection);
// Returns true if the triangle is visible in the current view
```

## Database Integration

### Connection Management

#### `connectToDatabase(): Promise<Connection>`
Creates and/or returns a cached MongoDB connection.

```typescript
try {
  const conn = await connectToDatabase();
  // Connection successful, use conn for database operations
} catch (error) {
  console.error('Failed to connect to database:', error);
}
```

#### `isDatabaseConnected(): boolean`
Check if database is connected.

```typescript
if (isDatabaseConnected()) {
  // Database is connected
} else {
  // Not connected
}
```

## State Management

### Triangle Mesh Store

#### `useTriangleMeshStore`
Zustand store for managing triangle mesh state.

```typescript
import { useTriangleMeshStore } from '@/app/store/triangleMeshStore';

// Access store state and actions
const { mesh, clickFace, subdivideFace } = useTriangleMeshStore();
```

#### State Properties

```typescript
interface TriangleMeshState {
  // Core mesh data
  mesh: TriangleMesh;
  selectedFaceId: string | null;
  hoveredFaceId: string | null;
  meshStats: MeshStats | null;
  
  // Map projection for OpenStreetMap integration
  mapProjection: MapProjection;
  
  // History for undo/redo
  history: {
    past: TriangleMesh[];
    future: TriangleMesh[];
  };
  
  // Actions (see below)
  // ...
}
```

### Store Actions

#### `initializeMesh(): void`
Initialize the mesh with starting data.

```typescript
useTriangleMeshStore.getState().initializeMesh();
```

#### `selectFace(faceId: string | null): void`
Select a triangle face.

```typescript
useTriangleMeshStore.getState().selectFace("triangle-123abc");
```

#### `hoverFace(faceId: string | null): void`
Hover over a triangle face.

```typescript
useTriangleMeshStore.getState().hoverFace("triangle-123abc");
```

#### `clickFace(faceId: string): void`
Handle click on a triangle face. Increments click count and updates color.

```typescript
useTriangleMeshStore.getState().clickFace("triangle-123abc");
```

#### `subdivideFace(faceId: string): void`
Subdivide a triangle face into 4 smaller triangles.

```typescript
useTriangleMeshStore.getState().subdivideFace("triangle-123abc");
```

#### `updateMapProjection(projection: Partial<MapProjection>): void`
Update map projection for OpenStreetMap integration.

```typescript
useTriangleMeshStore.getState().updateMapProjection({
  zoom: 10,
  center: { latitude: 40, longitude: -74 }
});
```

#### `zoomIn(): void` / `zoomOut(): void`
Zoom in/out on the map.

```typescript
useTriangleMeshStore.getState().zoomIn();
useTriangleMeshStore.getState().zoomOut();
```

#### `panMap(deltaLat: number, deltaLng: number): void`
Pan the map in a direction.

```typescript
useTriangleMeshStore.getState().panMap(0.1, -0.2);
```

#### `undo(): void` / `redo(): void`
Undo/redo actions.

```typescript
useTriangleMeshStore.getState().undo();
useTriangleMeshStore.getState().redo();
```

#### `resetMesh(): void`
Reset the mesh to initial state.

```typescript
useTriangleMeshStore.getState().resetMesh();
```

## React Hooks

### useTriangleMesh Hook

Custom hook for managing triangle mesh visualization. Provides a simplified API for interacting with the triangle mesh.

```typescript
import { useTriangleMesh } from '@/app/hooks/useTriangleMesh';

function MyComponent() {
  const {
    mesh,
    meshStats,
    selectedFace,
    hoveredFace,
    mapProjection,
    
    clickFace,
    subdivideFace,
    canSubdivideFace,
    
    zoomIn,
    zoomOut,
    updateMapSize,
    
    undo,
    redo,
  } = useTriangleMesh();
  
  // Use these in your component
}
```

#### Return Value

```typescript
interface UseTriangleMeshReturn {
  // State
  mesh: TriangleMesh;
  meshStats: MeshVisualizationStats | null;
  selectedFace: TriangleFace | null;
  selectedFaceId: string | null;
  hoveredFace: TriangleFace | null;
  hoveredFaceId: string | null;
  mapProjection: MapProjection;
  
  // History
  historyStatus: {
    canUndo: boolean;
    canRedo: boolean;
    historyLength: number;
    futureLength: number;
  };
  
  // Core actions
  initializeMesh: () => void;
  resetMesh: () => void;
  selectFace: (faceId: string | null) => void;
  hoverFace: (faceId: string | null) => void;
  clickFace: (faceId: string, event?: React.MouseEvent) => void;
  subdivideFace: (faceId: string) => void;
  canSubdivideFace: (faceId: string) => boolean;
  
  // Map controls
  updateMapProjection: (projection: Partial<MapProjection>)

