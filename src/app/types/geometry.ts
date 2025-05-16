/**
 * Types definitions for the triangle mesh geometry system
 * Focused on 2D mapping for OpenStreetMap overlay
 */

/**
 * Types definitions for the triangle mesh geometry system
 * Focused on 2D mapping for OpenStreetMap overlay
 */

/**
 * Geographic coordinates (latitude, longitude)
 */
export interface GeoCoordinate {
  latitude: number;  // -90 to 90 degrees
  longitude: number; // -180 to 180 degrees
}

/**
 * Triangle face made up of three geographic vertices
 */
export interface TriangleFace {
  id: string;
  vertices: [number, number, number]; // Indices of the vertices in the vertices array
  level: number;                      // Subdivision level (0-19)
  clickCount: number;                 // Number of times clicked (0-10)
  color: string;                      // CSS color string
  parentFaceId?: string;              // Reference to parent face if subdivided
}

/**
 * Complete triangle mesh representation
 */
export interface TriangleMesh {
  vertices: GeoCoordinate[];        // Vertices as geographic coordinates
  faces: TriangleFace[];            // Triangle faces
}

/**
 * Triangle subdivision result
 */
export interface SubdivisionResult {
  newVertices: GeoCoordinate[];
  newFaces: TriangleFace[];
  parentFaceId: string;
}

/**
 * Statistics about the triangle mesh
 */
export interface MeshStats {
  totalVertices: number;
  totalFaces: number;
  maxLevel: number;
  totalClicks: number;
  subdivisionsByLevel: Array<{
    level: number;
    count: number;
  }>;
}

/**
 * Map projection parameters for transforming between geographic and screen coordinates
 */
export interface MapProjection {
  zoom: number;
  center: GeoCoordinate;
  width: number;
  height: number;
  rotation?: number;
}

/**
 * Screen coordinates (pixels)
 */
export interface ScreenCoordinate {
  x: number;
  y: number;
}

/**
 * Initial geographic coordinates for the triangle mesh
 * These points form a regular icosahedron projected onto the Earth's surface
 */
export const INITIAL_VERTICES: GeoCoordinate[] = [
  // North pole
  { latitude: 90, longitude: 0 },
  
  // 5 vertices at approximately 26.57° N latitude (equally spaced)
  { latitude: 26.57, longitude: 0 },
  { latitude: 26.57, longitude: 72 },
  { latitude: 26.57, longitude: 144 },
  { latitude: 26.57, longitude: -144 },
  { latitude: 26.57, longitude: -72 },
  
  // 5 vertices at approximately 26.57° S latitude (equally spaced)
  { latitude: -26.57, longitude: 36 },
  { latitude: -26.57, longitude: 108 },
  { latitude: -26.57, longitude: 180 },
  { latitude: -26.57, longitude: -108 },
  { latitude: -26.57, longitude: -36 },
  
  // South pole
  { latitude: -90, longitude: 0 },
];

/**
 * Initial triangle faces connecting the vertices
 * These form 20 triangular faces of a regular icosahedron
 */
export const INITIAL_FACES: Array<[number, number, number]> = [
  // 5 faces around north pole
  [0, 1, 2],
  [0, 2, 3],
  [0, 3, 4],
  [0, 4, 5],
  [0, 5, 1],
  
  // 10 faces around the "equator"
  [1, 6, 2],
  [2, 7, 3],
  [3, 8, 4],
  [4, 9, 5],
  [5, 10, 1],
  [6, 1, 10],
  [7, 2, 6],
  [8, 3, 7],
  [9, 4, 8],
  [10, 5, 9],
  
  // 5 faces around south pole
  [11, 6, 7],
  [11, 7, 8],
  [11, 8, 9],
  [11, 9, 10],
  [11, 10, 6],
];

/**
 * Get color for a triangle based on click count
 * White (0 clicks) -> progressively darker gray (1-10 clicks) -> red (level 19, 11 clicks)
 */
export function getColorForClickCount(clickCount: number, level: number): string {
  if (level >= 19 && clickCount >= 11) {
    return 'red';
  }
  
  if (clickCount === 0) {
    return 'white';
  }
  
  // Calculate gray percentage (10% per click)
  const grayValue = 100 - (clickCount * 10);
  return `rgb(${grayValue}%, ${grayValue}%, ${grayValue}%)`;
}

/**
 * Calculate the midpoint between two geographic coordinates
 * This implementation uses the Haversine formula to calculate the midpoint
 * along a great circle path between two points on a sphere
 */
export function geoMidpoint(coord1: GeoCoordinate, coord2: GeoCoordinate): GeoCoordinate {
  // Convert to radians
  const lat1 = coord1.latitude * Math.PI / 180;
  const lon1 = coord1.longitude * Math.PI / 180;
  const lat2 = coord2.latitude * Math.PI / 180;
  const lon2 = coord2.longitude * Math.PI / 180;
  
  // Convert to Cartesian coordinates
  const x1 = Math.cos(lat1) * Math.cos(lon1);
  const y1 = Math.cos(lat1) * Math.sin(lon1);
  const z1 = Math.sin(lat1);
  
  const x2 = Math.cos(lat2) * Math.cos(lon2);
  const y2 = Math.cos(lat2) * Math.sin(lon2);
  const z2 = Math.sin(lat2);
  
  // Find midpoint in Cartesian space
  const x = (x1 + x2) / 2;
  const y = (y1 + y2) / 2;
  const z = (z1 + z2) / 2;
  
  // Normalize to ensure point is on the sphere
  const norm = Math.sqrt(x*x + y*y + z*z);
  const xNorm = x / norm;
  const yNorm = y / norm;
  const zNorm = z / norm;
  
  // Convert back to geographic coordinates
  const lon = Math.atan2(yNorm, xNorm);
  const lat = Math.asin(zNorm);
  
  return {
    latitude: lat * 180 / Math.PI,
    longitude: lon * 180 / Math.PI,
  };
}

/**
 * Convert geographic coordinates to Web Mercator projection coordinates
 * This is a standard projection used by OpenStreetMap and many web mapping libraries
 * 
 * @param coord Geographic coordinate (latitude, longitude)
 * @param projection Map projection parameters
 * @returns Screen coordinates (x, y) in pixels
 */
export function geoToScreen(coord: GeoCoordinate, projection: MapProjection): ScreenCoordinate {
  const { zoom, center, width, height } = projection;
  
  // Apply zoom factor (higher zoom = more detailed view)
  const zoomFactor = Math.pow(2, zoom);
  
  // Convert geographic coordinates to Web Mercator projection (0-1 range)
  // Longitude: -180 to 180 → 0 to 1
  const x = (coord.longitude + 180) / 360;
  
  // Latitude: Apply Web Mercator formula to avoid distortion at poles
  // This is the standard formula used by OpenStreetMap and Google Maps
  const latRad = (coord.latitude * Math.PI) / 180;
  const mercN = Math.log(Math.tan((Math.PI / 4) + (latRad / 2)));
  const y = (0.5 - mercN / (2 * Math.PI));
  
  // Apply center offset (pan)
  const centerX = (center.longitude + 180) / 360;
  const centerLatRad = (center.latitude * Math.PI) / 180;
  const centerY = (0.5 - Math.log(Math.tan((Math.PI / 4) + (centerLatRad / 2))) / (2 * Math.PI));
  
  // Calculate screen coordinates
  const screenX = ((x - centerX) * zoomFactor + 0.5) * width;
  const screenY = ((y - centerY) * zoomFactor + 0.5) * height;
  
  return { x: screenX, y: screenY };
}

/**
 * Convert screen coordinates to geographic coordinates
 * Inverse of the geoToScreen function
 * 
 * @param screen Screen coordinates (x, y) in pixels
 * @param projection Map projection parameters
 * @returns Geographic coordinates (latitude, longitude)
 */
export function screenToGeo(screen: ScreenCoordinate, projection: MapProjection): GeoCoordinate {
  const { zoom, center, width, height } = projection;
  const zoomFactor = Math.pow(2, zoom);
  
  // Normalize screen coordinates to 0-1 range with center offset
  const centerX = (center.longitude + 180) / 360;
  const centerLatRad = (center.latitude * Math.PI) / 180;
  const centerY = (0.5 - Math.log(Math.tan((Math.PI / 4) + (centerLatRad / 2))) / (2 * Math.PI));
  
  // Convert to Web Mercator coordinates (0-1 range)
  const x = ((screen.x / width) - 0.5) / zoomFactor + centerX;
  const y = ((screen.y / height) - 0.5) / zoomFactor + centerY;
  
  // Convert to longitude
  const longitude = (x * 360) - 180;
  
  // Convert to latitude (inverse Web Mercator formula)
  const mercN = (0.5 - y) * (2 * Math.PI);
  const latRad = 2 * Math.atan(Math.exp(mercN)) - (Math.PI / 2);
  const latitude = latRad * 180 / Math.PI;
  
  return { latitude, longitude };
}

/**
 * Check if a point is inside a triangle
 * Uses barycentric coordinates
 * 
 * @param point The point to check
 * @param triangle Three vertices of the triangle
 * @returns True if the point is inside the triangle, false otherwise
 */
export function isPointInTriangle(
  point: ScreenCoordinate,
  triangle: [ScreenCoordinate, ScreenCoordinate, ScreenCoordinate]
): boolean {
  const [a, b, c] = triangle;
  
  // Calculate barycentric coordinates
  const area = 0.5 * Math.abs(
    (a.x * (b.y - c.y)) +
    (b.x * (c.y - a.y)) +
    (c.x * (a.y - b.y))
  );
  
  const alpha = Math.abs(
    (point.x * (b.y - c.y)) +
    (b.x * (c.y - point.y)) +
    (c.x * (point.y - b.y))
  ) / (2 * area);
  
  const beta = Math.abs(
    (a.x * (point.y - c.y)) +
    (point.x * (c.y - a.y)) +
    (c.x * (a.y - point.y))
  ) / (2 * area);
  
  const gamma = 1 - alpha - beta;
  
  // Point is inside the triangle if all barycentric coordinates are between 0 and 1
  return alpha >= 0 && beta >= 0 && gamma >= 0 && alpha <= 1 && beta <= 1 && gamma <= 1;
}

/**
 * Calculate the area of a triangle on a sphere (in square kilometers)
 * Uses the spherical excess formula
 * 
 * @param triangle Three vertices of the triangle as geographic coordinates
 * @returns Area in square kilometers
 */
export function calculateSphericalTriangleArea(
  triangle: [GeoCoordinate, GeoCoordinate, GeoCoordinate]
): number {
  const [a, b, c] = triangle;
  const earthRadius = 6371; // Earth radius in kilometers
  
  // Convert to radians
  const aLat = a.latitude * Math.PI / 180;
  const aLon = a.longitude * Math.PI / 180;
  const bLat = b.latitude * Math.PI / 180;
  const bLon = b.longitude * Math.PI / 180;
  const cLat = c.latitude * Math.PI / 180;
  const cLon = c.longitude * Math.PI / 180;
  
  // Convert to Cartesian coordinates
  const aX = Math.cos(aLat) * Math.cos(aLon);
  const aY = Math.cos(aLat) * Math.sin(aLon);
  const aZ = Math.sin(aLat);
  
  const bX = Math.cos(bLat) * Math.cos(bLon);
  const bY = Math.cos(bLat) * Math.sin(bLon);
  const bZ = Math.sin(bLat);
  
  const cX = Math.cos(cLat) * Math.cos(cLon);
  const cY = Math.cos(cLat) * Math.sin(cLon);
  const cZ = Math.sin(cLat);
  
  // Calculate the angles between the vertices
  const angleA = Math.acos(
    (bX * cX + bY * cY + bZ * cZ) /
    (Math.sqrt(bX * bX + bY * bY + bZ * bZ) * Math.sqrt(cX * cX + cY * cY + cZ * cZ))
  );
  
  const angleB = Math.acos(
    (aX * cX + aY * cY + aZ * cZ) /
    (Math.sqrt(aX * aX + aY * aY + aZ * aZ) * Math.sqrt(cX * cX + cY * cY + cZ * cZ))
  );

  const angleC = Math.acos(
    (aX * bX + aY * bY + aZ * bZ) /
    (Math.sqrt(aX * aX + aY * aY + aZ * aZ) * Math.sqrt(bX * bX + bY * bY + bZ * bZ))
  );

  // Calculate the spherical excess (sum of angles minus pi)
  const sphericalExcess = angleA + angleB + angleC - Math.PI;
  
  // Calculate the area using the spherical excess formula
  // Area = excess * R^2 where R is the radius of the Earth
  const area = sphericalExcess * earthRadius * earthRadius;
  
  return area;
}

/**
 * Generate a unique ID for a triangle face
 */
export function generateTriangleId(): string {
  return `triangle-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Create initial triangle mesh with icosahedron faces
 */
export function createInitialMesh(): TriangleMesh {
  const faces: TriangleFace[] = INITIAL_FACES.map((vertices, index) => ({
    id: `initial-face-${index}`,
    vertices: vertices as [number, number, number],
    level: 0,
    clickCount: 0,
    color: getColorForClickCount(0, 0),
  }));

  return {
    vertices: [...INITIAL_VERTICES],
    faces,
  };
}

/**
 * Subdivide a triangle face into 4 smaller triangles
 * 
 * @param mesh The current triangle mesh
 * @param faceId The ID of the face to subdivide
 * @returns A subdivision result with new vertices and faces
 */
export function subdivideFace(mesh: TriangleMesh, faceId: string): SubdivisionResult | null {
  // Find the face to subdivide
  const faceIndex = mesh.faces.findIndex(face => face.id === faceId);
  if (faceIndex === -1) return null;
  
  const face = mesh.faces[faceIndex];
  const [a, b, c] = face.vertices;
  
  // Get the vertex coordinates
  const vA = mesh.vertices[a];
  const vB = mesh.vertices[b];
  const vC = mesh.vertices[c];
  
  // Create midpoints
  const mAB = geoMidpoint(vA, vB);
  const mBC = geoMidpoint(vB, vC);
  const mCA = geoMidpoint(vC, vA);
  
  // Add new vertices to array
  const newVertices = [mAB, mBC, mCA];
  const newVertexIndices = [
    mesh.vertices.length,
    mesh.vertices.length + 1,
    mesh.vertices.length + 2,
  ];
  
  // Create 4 new faces
  const newFaces: TriangleFace[] = [
    // Face 1: A, mAB, mCA
    {
      id: generateTriangleId(),
      vertices: [a, newVertexIndices[0], newVertexIndices[2]],
      level: face.level + 1,
      clickCount: 0,
      color: getColorForClickCount(0, face.level + 1),
      parentFaceId: face.id,
    },
    // Face 2: mAB, B, mBC
    {
      id: generateTriangleId(),
      vertices: [newVertexIndices[0], b, newVertexIndices[1]],
      level: face.level + 1,
      clickCount: 0,
      color: getColorForClickCount(0, face.level + 1),
      parentFaceId: face.id,
    },
    // Face 3: mCA, mBC, C
    {
      id: generateTriangleId(),
      vertices: [newVertexIndices[2], newVertexIndices[1], c],
      level: face.level + 1,
      clickCount: 0,
      color: getColorForClickCount(0, face.level + 1),
      parentFaceId: face.id,
    },
    // Face 4: mAB, mBC, mCA
    {
      id: generateTriangleId(),
      vertices: [newVertexIndices[0], newVertexIndices[1], newVertexIndices[2]],
      level: face.level + 1,
      clickCount: 0,
      color: getColorForClickCount(0, face.level + 1),
      parentFaceId: face.id,
    },
  ];
  
  return {
    newVertices,
    newFaces,
    parentFaceId: face.id,
  };
}

/**
 * Calculate mesh statistics
 */
export function calculateMeshStats(mesh: TriangleMesh): MeshStats {
  const totalVertices = mesh.vertices.length;
  const totalFaces = mesh.faces.length;
  
  let maxLevel = 0;
  let totalClicks = 0;
  
  // Count faces per level
  const levelCounts = new Map<number, number>();
  
  for (const face of mesh.faces) {
    maxLevel = Math.max(maxLevel, face.level);
    totalClicks += face.clickCount;
    
    const count = levelCounts.get(face.level) || 0;
    levelCounts.set(face.level, count + 1);
  }
  
  const subdivisionsByLevel = Array.from(levelCounts.entries())
    .map(([level, count]) => ({ level, count }))
    .sort((a, b) => a.level - b.level);
  
  return {
    totalVertices,
    totalFaces,
    maxLevel,
    totalClicks,
    subdivisionsByLevel,
  };
}

/**
 * Convert triangle face to screen coordinates
 */
export function triangleToScreen(
  face: TriangleFace, 
  mesh: TriangleMesh, 
  projection: MapProjection
): [ScreenCoordinate, ScreenCoordinate, ScreenCoordinate] {
  const [a, b, c] = face.vertices;
  const vA = mesh.vertices[a];
  const vB = mesh.vertices[b];
  const vC = mesh.vertices[c];
  
  return [
    geoToScreen(vA, projection),
    geoToScreen(vB, projection),
    geoToScreen(vC, projection),
  ];
}

/**
 * Update triangle face color based on click count
 */
export function updateTriangleColor(face: TriangleFace): TriangleFace {
  return {
    ...face,
    color: getColorForClickCount(face.clickCount, face.level),
  };
}

/**
 * Increment the click count for a triangle face
 */
export function incrementClickCount(face: TriangleFace): TriangleFace {
  const newClickCount = Math.min(face.clickCount + 1, 11);
  return {
    ...face,
    clickCount: newClickCount,
    color: getColorForClickCount(newClickCount, face.level),
  };
}

/**
 * Constants for OpenStreetMap integration
 */
export const OSM_CONSTANTS = {
  MIN_ZOOM: 0,
  MAX_ZOOM: 19,
  TILE_SIZE: 256,
  EARTH_RADIUS_METERS: 6378137, // In meters (WGS84)
};

/**
 * OpenStreetMap tile coordinates
 */
export interface OsmTileCoordinates {
  x: number;
  y: number;
  z: number; // zoom level
}

/**
 * Convert geographic coordinates to OpenStreetMap tile coordinates
 * This allows for integration with standard OSM tile layers
 */
export function geoToOsmTile(
  coord: GeoCoordinate, 
  zoom: number
): OsmTileCoordinates {
  const latRad = (coord.latitude * Math.PI) / 180;
  const n = Math.pow(2, zoom);
  
  const x = Math.floor((coord.longitude + 180) / 360 * n);
  const y = Math.floor((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * n);
  
  return { x, y, z: zoom };
}

/**
 * Convert OpenStreetMap tile coordinates to geographic coordinates
 */
export function osmTileToGeo(tile: OsmTileCoordinates): GeoCoordinate {
  const n = Math.pow(2, tile.z);
  const longitude = tile.x / n * 360 - 180;
  
  const latRad = Math.atan(Math.sinh(Math.PI * (1 - 2 * tile.y / n)));
  const latitude = latRad * 180 / Math.PI;
  
  return { latitude, longitude };
}

/**
 * Check if a triangle is visible within the current map view
 * This improves rendering performance by skipping triangles outside the view
 */
export function isTriangleVisible(
  face: TriangleFace, 
  mesh: TriangleMesh, 
  projection: MapProjection
): boolean {
  // Convert triangle to screen coordinates
  const screenCoords = triangleToScreen(face, mesh, projection);
  
  // Check if any vertex is within the screen bounds
  for (const coord of screenCoords) {
    if (
      coord.x >= -100 && coord.x <= projection.width + 100 &&
      coord.y >= -100 && coord.y <= projection.height + 100
    ) {
      return true;
    }
  }
  
  // Additional check for triangles that cross the screen without having vertices inside
  // This is a simplification; a more robust approach would check line intersections
  const [a, b, c] = screenCoords;
  
  // Calculate the bounding box of the triangle
  const minX = Math.min(a.x, b.x, c.x);
  const maxX = Math.max(a.x, b.x, c.x);
  const minY = Math.min(a.y, b.y, c.y);
  const maxY = Math.max(a.y, b.y, c.y);
  
  // Check if the bounding box overlaps with the screen
  return !(
    maxX < 0 || 
    minX > projection.width || 
    maxY < 0 || 
    minY > projection.height
  );
}
