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
/**
 * Validation status for a triangle face
 */
export interface TriangleValidation {
  isValid: boolean;        // Whether the face geometry is valid
  errorMessage?: string;   // Error message if invalid
}

export interface TriangleFace {
  id: string;
  vertices: [number, number, number]; // Indices of the vertices in the vertices array
  level: number;                      // Subdivision level (0-19)
  clickCount: number;                 // Number of times clicked (0-10)
  color: string;                      // CSS color string
  parentFaceId?: string;              // Reference to parent face if subdivided
  isVisible?: boolean;                // Visibility flag for rendering optimization
  validation?: TriangleValidation;    // Validation status for error detection
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
 * Geographic bounds of a map area
 */
export interface GeoBounds {
  north: number;   // northernmost latitude
  south: number;   // southernmost latitude
  east: number;    // easternmost longitude
  west: number;    // westernmost longitude
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
  bounds?: GeoBounds;    // Visible map bounds for optimized culling
}

/**
 * Screen coordinates (pixels)
 */
export interface ScreenCoordinate {
  x: number;
  y: number;
}

/**
 * Triangle rendering quality settings
 */
export type RenderingQuality = 'low' | 'medium' | 'high';

/**
 * Performance debug information
 */
export interface RenderStats {
  visibleFaces: number;
  totalFaces: number;
  renderTime: number;
  frameRate: number;
  memoryUsage?: number;
}

/**
 * Visibility calculation options for performance tuning
 */
export interface VisibilityOptions {
  maxVisibleFaces: number;      // Maximum faces to render for performance
  levelOfDetailFactor: number;  // Higher value = more detail at lower zoom levels
  enableFrustumCulling: boolean; // Whether to perform culling using map bounds
  prioritizeByClick: boolean;    // Whether to prioritize most-clicked faces
}

/**
 * Initial geographic coordinates for the triangle mesh
 * These points define vertices at the Equator, Arctic Circle (+66.5°) and Antarctic Circle (-66.5°)
 */
export const INITIAL_VERTICES: GeoCoordinate[] = [
  // 5 vertices at the Equator (0°) - evenly spaced
  { latitude: 0, longitude: 0 },
  { latitude: 0, longitude: 72 },
  { latitude: 0, longitude: 144 },
  { latitude: 0, longitude: -144 },
  { latitude: 0, longitude: -72 },
  
  // 5 vertices at the Arctic Circle (+66.5°) - evenly spaced
  { latitude: 66.5, longitude: 0 },
  { latitude: 66.5, longitude: 72 },
  { latitude: 66.5, longitude: 144 },
  { latitude: 66.5, longitude: -144 },
  { latitude: 66.5, longitude: -72 },
  
  // 5 vertices at the Antarctic Circle (-66.5°) - evenly spaced
  { latitude: -66.5, longitude: 0 },
  { latitude: -66.5, longitude: 72 },
  { latitude: -66.5, longitude: 144 },
  { latitude: -66.5, longitude: -144 },
  { latitude: -66.5, longitude: -72 },
];

/**
 * Initial triangle faces connecting the vertices
 * These form 20 isosceles triangles between the Equator, Arctic Circle, and Antarctic Circle
 */
export const INITIAL_FACES: Array<[number, number, number]> = [
  // Group A: 10 triangles (5 pointing north from Equator to Arctic Circle, 5 pointing south to Antarctic Circle)
  
  // 5 triangles pointing north from Equator to Arctic Circle
  [0, 1, 5],   // Equator 0° to Arctic 0°-72°
  [1, 2, 6],   // Equator 72° to Arctic 72°-144°
  [2, 3, 7],   // Equator 144° to Arctic 144°-(-144°)
  [3, 4, 8],   // Equator -144° to Arctic -144°-(-72°)
  [4, 0, 9],   // Equator -72° to Arctic -72°-0°
  
  // 5 triangles pointing south from Equator to Antarctic Circle
  [0, 4, 10],  // Equator 0° to Antarctic 0°-(-72°)
  [1, 0, 14],  // Equator 72° to Antarctic 72°-0°
  [2, 1, 11],  // Equator 144° to Antarctic 144°-72°
  [3, 2, 12],  // Equator -144° to Antarctic -144°-144°
  [4, 3, 13],  // Equator -72° to Antarctic -72°-(-144°)
  
  // Group B: 10 triangles (5 pointing from Arctic Circle to Equator, 5 from Antarctic Circle to Equator)
  
  // 5 triangles pointing from Arctic Circle to Equator
  [5, 6, 0],   // Arctic 0°-72° to Equator 0°
  [6, 7, 1],   // Arctic 72°-144° to Equator 72° 
  [7, 8, 2],   // Arctic 144°-(-144°) to Equator 144°
  [8, 9, 3],   // Arctic -144°-(-72°) to Equator -144°
  [9, 5, 4],   // Arctic -72°-0° to Equator -72°
  
  // 5 triangles pointing from Antarctic Circle to Equator
  [10, 11, 0], // Antarctic 0°-72° to Equator 0°
  [11, 12, 1], // Antarctic 72°-144° to Equator 72°
  [12, 13, 2], // Antarctic 144°-(-144°) to Equator 144°
  [13, 14, 3], // Antarctic -144°-(-72°) to Equator -144°
  [14, 10, 4], // Antarctic -72°-0° to Equator -72°
];

/**
 * Get color for a triangle based on click count
 * Using vibrant, high-contrast colors for better visibility
 */
export function getColorForClickCount(clickCount: number, level: number): string {
  // Maximum level with maximum clicks - use bright red
  if (level >= 19 && clickCount >= 11) {
    return '#ff0000'; // Pure bright red
  }
  
  // Unclicked triangles - use extremely bright, visible colors based on level
  if (clickCount === 0) {
    // Base triangles (level 0) get bright purple with higher contrast
    if (level === 0) {
      return '#ff00ff'; // Bright magenta - extremely visible
    }
    
    // Super bright colors for different levels for maximum visibility
    // Using more saturated and contrasting colors
    const hues = [
      '#ff00ff', // Magenta
      '#00ffff', // Cyan
      '#ffff00', // Yellow
      '#ff8000', // Orange
      '#00ff00'  // Lime
    ]; 
    return hues[level % hues.length];
  }
  
  // For clicked triangles, use vibrant HSL colors with increased brightness and saturation
  // Start at green (120°) and shift towards red as click count increases
  const hue = 130 - (clickCount * 12); // Starts green, shifts to yellow, orange, then red
  const saturation = 100; // Full saturation for all clicked states
  const lightness = 65 - (clickCount * 3); // Start brighter, get slightly darker with clicks
  
  return `hsl(${hue}, ${saturation}%, ${Math.max(45, lightness)}%)`;
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
 * 
 * Enhanced for high visibility and proper initial state
 */
export function createInitialMesh(): TriangleMesh {
  const faces: TriangleFace[] = INITIAL_FACES.map((vertices, index) => ({
    id: `initial-face-${index}`,
    vertices: vertices as [number, number, number],
    level: 0,
    clickCount: 0,
    color: getColorForClickCount(0, 0),
    isVisible: true, // Explicitly set visibility for all faces
    validation: { isValid: true } // Ensure all faces start with valid state
  }));

  // Log the creation of the mesh for debugging
  console.log(`Created initial mesh with ${faces.length} faces and ${INITIAL_VERTICES.length} vertices`);
  
  return {
    vertices: [...INITIAL_VERTICES],
    faces,
  };
}

/**
 * Subdivide a triangle face into 3 smaller triangles from a click point
 * 
 * @param mesh The current triangle mesh
 * @param faceId The ID of the face to subdivide
 * @param clickPoint Optional geographic coordinate of the click point; uses face center if not provided
 * @returns A subdivision result with new vertices and faces
 */
export function subdivideFace(
  mesh: TriangleMesh, 
  faceId: string, 
  clickPoint?: GeoCoordinate
): SubdivisionResult | null {
  // Find the face to subdivide
  const faceIndex = mesh.faces.findIndex(face => face.id === faceId);
  if (faceIndex === -1) return null;
  
  const face = mesh.faces[faceIndex];
  const [a, b, c] = face.vertices;
  
  // Get the vertex coordinates
  const vA = mesh.vertices[a];
  const vB = mesh.vertices[b];
  const vC = mesh.vertices[c];
  
  // Convert to 3D vectors for better interpolation
  const vACart = geoToVector3(vA);
  const vBCart = geoToVector3(vB);
  const vCCart = geoToVector3(vC);
  
  // Determine subdivision point (center or clicked point)
  let subdivisionPoint: GeoCoordinate;
  
  if (clickPoint) {
    // Use the provided click point if it's inside the triangle
    // Verify the click point is inside the triangle using spherical geometry
    const isInside = isPointInGeoTriangle(clickPoint, vA, vB, vC);
    if (isInside) {
      subdivisionPoint = clickPoint;
    } else {
      // If point is outside, use the triangle center
      // Average the cartesian coordinates and normalize to find true center
      const centerCart = {
        x: (vACart.x + vBCart.x + vCCart.x) / 3,
        y: (vACart.y + vBCart.y + vCCart.y) / 3,
        z: (vACart.z + vBCart.z + vCCart.z) / 3
      };
      // Normalize to ensure the point is on the sphere
      const norm = Math.sqrt(centerCart.x**2 + centerCart.y**2 + centerCart.z**2);
      centerCart.x /= norm;
      centerCart.y /= norm;
      centerCart.z /= norm;
      
      subdivisionPoint = vector3ToGeo(centerCart);
    }
  } else {
    // Use the spherical centroid of the triangle if no click point is provided
    // Average the cartesian coordinates and normalize to find true center
    const centerCart = {
      x: (vACart.x + vBCart.x + vCCart.x) / 3,
      y: (vACart.y + vBCart.y + vCCart.y) / 3,
      z: (vACart.z + vBCart.z + vCCart.z) / 3
    };
    // Normalize to ensure the point is on the sphere
    const norm = Math.sqrt(centerCart.x**2 + centerCart.y**2 + centerCart.z**2);
    centerCart.x /= norm;
    centerCart.y /= norm;
    centerCart.z /= norm;
    
    subdivisionPoint = vector3ToGeo(centerCart);
  }
  
  // Create new vertex at the subdivision point
  const newVertex = subdivisionPoint;
  const newVertexIndex = mesh.vertices.length;
  
  // Add new vertex to array
  const newVertices = [newVertex];
  
  // Create 3 new faces by connecting the subdivision point to each vertex
  const newFaces: TriangleFace[] = [
    // Face 1: Subdivision point, A, B
    {
      id: generateTriangleId(),
      vertices: [newVertexIndex, a, b],
      level: face.level + 1,
      clickCount: 0,
      color: getColorForClickCount(0, face.level + 1),
      parentFaceId: face.id,
      isVisible: true,
      validation: { isValid: true }
    },
    // Face 2: Subdivision point, B, C
    {
      id: generateTriangleId(),
      vertices: [newVertexIndex, b, c],
      level: face.level + 1,
      clickCount: 0,
      color: getColorForClickCount(0, face.level + 1),
      parentFaceId: face.id,
      isVisible: true,
      validation: { isValid: true }
    },
    // Face 3: Subdivision point, C, A
    {
      id: generateTriangleId(),
      vertices: [newVertexIndex, c, a],
      level: face.level + 1,
      clickCount: 0,
      color: getColorForClickCount(0, face.level + 1),
      parentFaceId: face.id,
      isVisible: true,
      validation: { isValid: true }
    }
  ];
  
  // Log the subdivision outcome for debugging
  console.log(`Subdivided face ${faceId} at level ${face.level} using ${clickPoint ? 'click point' : 'center'} at [${newVertex.latitude.toFixed(2)}, ${newVertex.longitude.toFixed(2)}]`);
  
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
 * Also ensures visibility is properly set
 */
export function updateTriangleColor(face: TriangleFace): TriangleFace {
  return {
    ...face,
    color: getColorForClickCount(face.clickCount, face.level),
    isVisible: true, // Ensure visibility is always set
  };
}

/**
 * Increment the click count for a triangle face
 * Also updates color and ensures visibility
 */
export function incrementClickCount(face: TriangleFace): TriangleFace {
  const newClickCount = Math.min(face.clickCount + 1, 11);
  const newColor = getColorForClickCount(newClickCount, face.level);
  
  // Log the color change for debugging
  console.log(`Face ${face.id} click count updated: ${face.clickCount} → ${newClickCount}, color: ${newColor}`);
  
  return {
    ...face,
    clickCount: newClickCount,
    color: newColor,
    isVisible: true, // Ensure visibility is always set
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
 * 
 * @param face The triangle face to check for visibility
 * @param mesh The complete triangle mesh containing vertices
 * @param projection The current map projection parameters
 * @param options Optional visibility optimization settings
 * @returns True if the triangle is visible, false otherwise
 */
export function isTriangleVisible(
  face: TriangleFace, 
  mesh: TriangleMesh, 
  projection: MapProjection,
  options?: Partial<VisibilityOptions>
): boolean {
  try {
    // For initial development, always return true to ensure triangles are visible
    // Remove this line later when debugging is complete
    return true;
    
    // First check if we have a cached visibility result
    if (face.isVisible !== undefined && !options?.enableFrustumCulling) {
      return face.isVisible;
    }
    
    // Quick bounds check if available
    if (projection.bounds && options?.enableFrustumCulling) {
      // Get face vertices
      const [a, b, c] = face.vertices;
      const vA = mesh.vertices[a];
      const vB = mesh.vertices[b];
      const vC = mesh.vertices[c];
      
      // Calculate the bounding box in geographic coordinates
      const minLat = Math.min(vA.latitude, vB.latitude, vC.latitude);
      const maxLat = Math.max(vA.latitude, vB.latitude, vC.latitude);
      const minLng = Math.min(vA.longitude, vB.longitude, vC.longitude);
      const maxLng = Math.max(vA.longitude, vB.longitude, vC.longitude);
      
      // Check if bounding box is completely outside the map bounds
      if (projection.bounds) {
        if (
          maxLat < projection.bounds.south || 
          minLat > projection.bounds.north || 
          maxLng < projection.bounds.west || 
          minLng > projection.bounds.east
        ) {
          face.isVisible = false;
          return false;
        }
      }
    }
    
    // Convert triangle to screen coordinates
    const screenCoords = triangleToScreen(face, mesh, projection);
    
    // Check if any vertex is within the screen bounds (with margin)
    const margin = 100; // Extra margin to ensure triangles that are partially visible are included
    for (const coord of screenCoords) {
      if (
        coord.x >= -margin && coord.x <= projection.width + margin &&
        coord.y >= -margin && coord.y <= projection.height + margin
      ) {
        face.isVisible = true;
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
    const isVisible = !(
      maxX < 0 || 
      minX > projection.width || 
      maxY < 0 || 
      minY > projection.height
    );
    
    face.isVisible = isVisible;
    
    // Log visibility for debugging
    console.log(`Triangle ${face.id} visibility check: ${isVisible}`);
    
    return isVisible;
  } catch (error) {
    console.error('Error in visibility check:', error);
    // Default to visible in case of error - better to show than hide erroneously
    return true;
  }
}

/**
 * Validate a triangle face to ensure it has valid geometry
 */
export function validateTriangleFace(face: TriangleFace, mesh: TriangleMesh): TriangleValidation {
  try {
    // Check if vertices exist in the mesh
    const { vertices } = face;
    for (const vertexIndex of vertices) {
      if (vertexIndex < 0 || vertexIndex >= mesh.vertices.length) {
        return {
          isValid: false,
          errorMessage: `Vertex index ${vertexIndex} out of bounds. Mesh only has ${mesh.vertices.length} vertices.`
        };
      }
    }

    // Check if vertices form a valid triangle (not degenerate)
    const [aIndex, bIndex, cIndex] = vertices;
    const a = mesh.vertices[aIndex];
    const b = mesh.vertices[bIndex];
    const c = mesh.vertices[cIndex];
    
    // Check for degenerate triangles (vertices too close together)
    if (
      (a.latitude === b.latitude && a.longitude === b.longitude) ||
      (a.latitude === c.latitude && a.longitude === c.longitude) ||
      (b.latitude === c.latitude && b.longitude === c.longitude)
    ) {
      return {
        isValid: false,
        errorMessage: 'Degenerate triangle: two or more vertices are identical'
      };
    }
    
    return { isValid: true };
  } catch (error) {
    return {
      isValid: false,
      errorMessage: `Validation error: ${error instanceof Error ? error.message : String(error)}`
    };
  }
}

/**
 * Filter visible faces based on projection and options
 */
export function filterVisibleFaces(
  mesh: TriangleMesh,
  projection: MapProjection,
  options: Partial<VisibilityOptions> = {}
): TriangleFace[] {
  const {
    maxVisibleFaces = 1000,
    levelOfDetailFactor = 1,
    enableFrustumCulling = true,
    prioritizeByClick = true
  } = options;
  
  // Adjust level of detail based on zoom
  const zoomLevel = projection.zoom;
  let maxLevel = 19;
  
  // At lower zoom levels, show fewer subdivisions
  if (zoomLevel < 5) {
    maxLevel = Math.max(3, Math.floor(zoomLevel * levelOfDetailFactor));
  } else if (zoomLevel < 10) {
    maxLevel = Math.max(5, Math.floor((zoomLevel - 5) * levelOfDetailFactor) + 5);
  }
  
  // Filter faces by level and visibility
  let visibleFaces = mesh.faces
    .filter(face => face.level <= maxLevel)
    .filter(face => isTriangleVisible(face, mesh, projection, { enableFrustumCulling }));
  
  // Sort faces if prioritization is enabled
  if (prioritizeByClick) {
    visibleFaces.sort((a, b) => {
      // First priority: clicked faces
      if (a.clickCount !== b.clickCount) {
        return b.clickCount - a.clickCount;
      }
      
      // Second priority: smaller (more detailed) triangles at higher zoom levels
      if (zoomLevel > 10) {
        return b.level - a.level; // Higher level = more subdivided = show first
      } else {
        return a.level - b.level; // Lower level = less subdivided = show first
      }
    });
  }
  
  // Limit number of faces for performance
  return visibleFaces.slice(0, maxVisibleFaces);
}
/**
 * Debug drawing utilities for visibility troubleshooting
 */
export interface DebugRenderingOptions {
  showBoundingBoxes: boolean;
  showVisibilityRadius: boolean;
  highlightInvalidFaces: boolean;
  showStatistics: boolean;
  logLevel: 'none' | 'error' | 'warning' | 'info' | 'debug';
}

/**
 * Error handling types for mesh operations
 */
export interface MeshOperationResult<T> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: any;
  };
}

/**
 * Safe wrapper for mesh operations with error handling
 */
export function safeExecuteMeshOperation<T>(
  operation: () => T,
  errorCode: string = 'MESH_OPERATION_ERROR'
): MeshOperationResult<T> {
  try {
    const result = operation();
    return {
      success: true,
      data: result
    };
  } catch (error) {
    return {
      success: false,
      error: {
        code: errorCode,
        message: error instanceof Error ? error.message : String(error),
        details: error
      }
    };
  }
}
