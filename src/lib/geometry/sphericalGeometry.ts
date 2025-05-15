/**
 * Spherical Geometry utility functions for STEP project
 * Handles coordinate conversions, triangle calculations and subdivisions
 */

// Vector types
export type Vector3D = [number, number, number];
export type LatLng = [number, number]; // [latitude, longitude] in degrees
export type Triangle = [LatLng, LatLng, LatLng]; // Three vertices defining a triangle

/**
 * Converts latitude/longitude coordinates to 3D Cartesian coordinates
 * @param lat Latitude in degrees
 * @param lng Longitude in degrees
 * @returns 3D vector [x, y, z] on unit sphere
 */
export function latLngToCartesian(lat: number, lng: number): Vector3D {
  // Convert degrees to radians
  const latRad = (lat * Math.PI) / 180;
  const lngRad = (lng * Math.PI) / 180;
  
  // Convert to Cartesian coordinates
  const x = Math.cos(latRad) * Math.cos(lngRad);
  const y = Math.cos(latRad) * Math.sin(lngRad);
  const z = Math.sin(latRad);
  
  return [x, y, z];
}

/**
 * Converts 3D Cartesian coordinates to latitude/longitude
 * @param vec 3D vector [x, y, z] on unit sphere
 * @returns [latitude, longitude] in degrees
 */
export function cartesianToLatLng(vec: Vector3D): LatLng {
  const [x, y, z] = vec;
  
  // Normalize the vector to ensure it's on the unit sphere
  const magnitude = Math.sqrt(x * x + y * y + z * z);
  const nx = x / magnitude;
  const ny = y / magnitude;
  const nz = z / magnitude;
  
  // Convert to latitude/longitude
  const lat = Math.asin(nz) * 180 / Math.PI;
  const lng = Math.atan2(ny, nx) * 180 / Math.PI;
  
  return [lat, lng];
}

/**
 * Calculates the midpoint between two points on the sphere (not the simple average)
 * @param p1 First point [lat, lng] in degrees
 * @param p2 Second point [lat, lng] in degrees
 * @returns Midpoint [lat, lng] in degrees
 */
export function sphericalMidpoint(p1: LatLng, p2: LatLng): LatLng {
  // Convert to Cartesian
  const v1 = latLngToCartesian(p1[0], p1[1]);
  const v2 = latLngToCartesian(p2[0], p2[1]);
  
  // Calculate midpoint in Cartesian space
  const midX = v1[0] + v2[0];
  const midY = v1[1] + v2[1];
  const midZ = v1[2] + v2[2];
  
  // Normalize to ensure it's on the sphere
  const magnitude = Math.sqrt(midX * midX + midY * midY + midZ * midZ);
  
  // Convert back to lat/lng
  return cartesianToLatLng([midX/magnitude, midY/magnitude, midZ/magnitude]);
}

/**
 * Calculate the distance between two points on the sphere (in kilometers)
 * @param p1 First point [lat, lng] in degrees
 * @param p2 Second point [lat, lng] in degrees
 * @returns Great circle distance in kilometers
 */
export function greatCircleDistance(p1: LatLng, p2: LatLng): number {
  const EARTH_RADIUS_KM = 6371; // Earth radius in kilometers
  
  // Convert to radians
  const lat1 = (p1[0] * Math.PI) / 180;
  const lng1 = (p1[1] * Math.PI) / 180;
  const lat2 = (p2[0] * Math.PI) / 180;
  const lng2 = (p2[1] * Math.PI) / 180;
  
  // Haversine formula
  const dLat = lat2 - lat1;
  const dLng = lng2 - lng1;
  const a = 
    Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(lat1) * Math.cos(lat2) * 
    Math.sin(dLng/2) * Math.sin(dLng/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  
  return EARTH_RADIUS_KM * c;
}

/**
 * Subdivide a triangle into 4 equal subtriangles
 * @param triangle Array of 3 [lat, lng] points defining the triangle
 * @returns Array of 4 triangles (each with 3 vertices)
 */
export function subdivideTriangle(triangle: Triangle): Triangle[] {
  const [p1, p2, p3] = triangle;
  
  // Calculate midpoints on the great circle
  const mid12 = sphericalMidpoint(p1, p2);
  const mid23 = sphericalMidpoint(p2, p3);
  const mid31 = sphericalMidpoint(p3, p1);
  
  // Create 4 new triangles
  const t1: Triangle = [p1, mid12, mid31];
  const t2: Triangle = [p2, mid23, mid12];
  const t3: Triangle = [p3, mid31, mid23];
  const t4: Triangle = [mid12, mid23, mid31];
  
  return [t1, t2, t3, t4];
}

/**
 * Calculate the approximate area of a spherical triangle (in square kilometers)
 * @param triangle Array of 3 [lat, lng] points defining the triangle
 * @returns Area in square kilometers
 */
export function sphericalTriangleArea(triangle: Triangle): number {
  const EARTH_RADIUS_KM = 6371; // Earth radius in kilometers
  const [a, b, c] = triangle;
  
  // Convert vertices to Cartesian coordinates
  const vA = latLngToCartesian(a[0], a[1]);
  const vB = latLngToCartesian(b[0], b[1]);
  const vC = latLngToCartesian(c[0], c[1]);
  
  // Calculate the angles between vectors
  const dotAB = vA[0]*vB[0] + vA[1]*vB[1] + vA[2]*vB[2];
  const dotBC = vB[0]*vC[0] + vB[1]*vC[1] + vB[2]*vC[2];
  const dotCA = vC[0]*vA[0] + vC[1]*vA[1] + vC[2]*vA[2];
  
  // Calculate magnitudes
  const magA = Math.sqrt(vA[0]**2 + vA[1]**2 + vA[2]**2);
  const magB = Math.sqrt(vB[0]**2 + vB[1]**2 + vB[2]**2);
  const magC = Math.sqrt(vC[0]**2 + vC[1]**2 + vC[2]**2);
  
  // Calculate angles
  const angleA = Math.acos(dotBC / (magB * magC));
  const angleB = Math.acos(dotCA / (magC * magA));
  const angleC = Math.acos(dotAB / (magA * magB));
  
  // Calculate excess angle (in radians)
  const excess = angleA + angleB + angleC - Math.PI;
  
  // Area using the spherical excess formula
  return excess * EARTH_RADIUS_KM * EARTH_RADIUS_KM;
}

/**
 * Generate the 12 vertices of a regular icosahedron mapped to a sphere
 * @returns Array of 12 [lat, lng] coordinates
 */
export function generateIcosahedronVertices(): LatLng[] {
  // Phi is the golden ratio, key to creating a regular icosahedron
  const phi = (1 + Math.sqrt(5)) / 2;
  const norm = Math.sqrt(1 + phi * phi);
  
  // Normalized coordinates
  const a = 1 / norm;
  const b = phi / norm;
  
  // Cartesian coordinates of vertices (before mapping to sphere)
  const vertices: Vector3D[] = [
    [0, a, b], [0, a, -b], [0, -a, b], [0, -a, -b],
    [a, b, 0], [a, -b, 0], [-a, b, 0], [-a, -b, 0],
    [b, 0, a], [b, 0, -a], [-b, 0, a], [-b, 0, -a]
  ];
  
  // Convert to latitude/longitude
  return vertices.map(v => cartesianToLatLng(v));
}

/**
 * Generate the 20 faces (triangles) of an icosahedron
 * @param vertices Array of 12 vertex coordinates
 * @returns Array of 20 triangles, each defined by 3 vertex indices
 */
export function generateIcosahedronFaces(): number[][] {
  // Face indices (each face connects 3 vertices from the vertex list)
  return [
    // 5 faces around vertex 0
    [0, 8, 4], [0, 5, 8], [0, 10, 5], [0, 2, 10], [0, 4, 2],
    // 5 adjacent faces
    [3, 1, 11], [3, 7, 1], [3, 9, 7], [3, 6, 9], [3, 11, 6],
    // 5 faces around vertex 1
    [1, 4, 8], [1, 8, 9], [1, 9, 6], [1, 6, 11], [1, 7, 4],
    // 5 adjacent faces
    [2, 5, 10], [2, 4, 5], [2, 7, 4], [2, 10, 7], [2, 10, 7]
  ];
}

/**
 * Converts Web Mercator coordinates to latitude/longitude
 * Useful for working with map providers like OpenStreetMap
 * @param x X coordinate in Web Mercator (0-1)
 * @param y Y coordinate in Web Mercator (0-1)
 * @returns [latitude, longitude] in degrees
 */
export function mercatorToLatLng(x: number, y: number): LatLng {
  const lng = (x - 0.5) * 360;
  const latRad = Math.atan(Math.sinh(Math.PI * (1 - 2 * y)));
  const lat = latRad * 180 / Math.PI;
  return [lat, lng];
}

/**
 * Convert latitude/longitude to Web Mercator coordinates
 * @param lat Latitude in degrees
 * @param lng Longitude in degrees
 * @returns [x, y] in Web Mercator (0-1 range)
 */
export function latLngToMercator(lat: number, lng: number): [number, number] {
  // Constrain latitude to avoid singularities at poles
  const clampedLat = Math.max(Math.min(lat, 89.99), -89.99);
  
  // Convert to radians
  const latRad = clampedLat * Math.PI / 180;
  
  // Calculate x (longitude is straightforward)
  const x = (lng + 180) / 360;
  
  // Calculate y using Mercator projection formula
  const sinLat = Math.sin(latRad);
  const y = 0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI);
  
  return [x, y];
}

/**
 * Check if a point is inside a triangle on the sphere
 * @param point [lat, lng] coordinates of the point to check
 * @param triangle Triangle vertices as [lat, lng] coordinates
 * @returns True if the point is inside the triangle
 */
export function isPointInSphericalTriangle(point: LatLng, triangle: Triangle): boolean {
  // This is an approximation for small triangles
  // Convert everything to 3D vectors
  const p = latLngToCartesian(point[0], point[1]);
  const vertices = triangle.map(v => latLngToCartesian(v[0], v[1]));
  
  // For each edge of the triangle, check if the point is on the same side
  // This is done by checking the sign of triple products
  const signs: number[] = [];
  
  for (let i = 0; i < 3; i++) {
    const v1 = vertices[i];
    const v2 = vertices[(i + 1) % 3];
    
    // Calculate normal to great circle plane
    const normal: Vector3D = [
      v1[1] * v2[2] - v1[2]

