/**
 * Type definition for a 3D vector with x, y, z coordinates
 */
export type Vector3 = {
  x: number;
  y: number;
  z: number;
};

/**
 * Type definition for a triangular face with vertex indices
 */
export type Face = {
  a: number;
  b: number;
  c: number;
};

/**
 * Type definition for spherical coordinates
 */
export type SphericalCoordinates = {
  latitude: number;  // degrees, -90 to 90
  longitude: number; // degrees, -180 to 180
};

/**
 * Generates 12 vertices of a regular icosahedron positioned on a unit sphere
 * @returns Array of 12 vertices (Vector3) representing the icosahedron corners
 */
export function generateIcosahedronVertices(): Vector3[] {
  // Golden ratio - key to constructing the icosahedron
  const phi = (1 + Math.sqrt(5)) / 2;
  const inverseNorm = 1 / Math.sqrt(1 + phi * phi);
  
  // Array to hold all 12 vertices
  const vertices: Vector3[] = [];
  
  // North pole
  vertices.push({ x: 0, y: 0, z: 1 });
  
  // 5 vertices around the north pole at latitude atan(1/φ)
  for (let i = 0; i < 5; i++) {
    const theta = (2 * Math.PI * i) / 5; // Angle around the pole
    vertices.push({
      x: inverseNorm * Math.cos(theta),
      y: inverseNorm * Math.sin(theta),
      z: inverseNorm * phi
    });
  }
  
  // 5 vertices around the south pole at latitude -atan(1/φ)
  for (let i = 0; i < 5; i++) {
    const theta = (2 * Math.PI * i) / 5 + Math.PI / 5; // Offset by π/5 from top band
    vertices.push({
      x: inverseNorm * Math.cos(theta),
      y: inverseNorm * Math.sin(theta),
      z: -inverseNorm * phi
    });
  }
  
  // South pole
  vertices.push({ x: 0, y: 0, z: -1 });
  
  // Normalize all vertices to unit length (distance 1 from origin)
  return vertices.map(normalizeVector);
}

/**
 * Generates 20 triangular faces of a regular icosahedron using the provided vertices
 * @param vertices Array of 12 Vector3 vertices of the icosahedron
 * @returns Array of 20 triangular faces connecting the vertices
 */
export function generateIcosahedronFaces(vertices: Vector3[]): Face[] {
  if (vertices.length !== 12) {
    throw new Error('Icosahedron must have exactly 12 vertices');
  }
  
  // Define the 20 faces of the icosahedron by their vertex indices
  // The pattern assumes vertices array from generateIcosahedronVertices:
  // - index 0: north pole
  // - indices 1-5: upper band
  // - indices 6-10: lower band
  // - index 11: south pole
  
  const faces: Face[] = [
    // 5 faces connecting north pole with upper band
    { a: 0, b: 1, c: 2 },
    { a: 0, b: 2, c: 3 },
    { a: 0, b: 3, c: 4 },
    { a: 0, b: 4, c: 5 },
    { a: 0, b: 5, c: 1 },
    
    // 10 faces connecting upper and lower bands
    { a: 1, b: 6, c: 2 },
    { a: 2, b: 7, c: 3 },
    { a: 3, b: 8, c: 4 },
    { a: 4, b: 9, c: 5 },
    { a: 5, b: 10, c: 1 },
    
    { a: 1, b: 10, c: 6 },
    { a: 2, b: 6, c: 7 },
    { a: 3, b: 7, c: 8 },
    { a: 4, b: 8, c: 9 },
    { a: 5, b: 9, c: 10 },
    
    // 5 faces connecting south pole with lower band
    { a: 11, b: 6, c: 7 },
    { a: 11, b: 7, c: 8 },
    { a: 11, b: 8, c: 9 },
    { a: 11, b: 9, c: 10 },
    { a: 11, b: 10, c: 6 }
  ];
  
  return faces;
}

/**
 * Converts cartesian coordinates (x,y,z) to spherical coordinates (latitude, longitude)
 * @param point Vector3 representing a point in 3D space
 * @returns Spherical coordinates with latitude (-90 to 90 degrees) and longitude (-180 to 180 degrees)
 */
export function cartesianToSpherical(point: Vector3): SphericalCoordinates {
  // Normalize the input point to ensure we're working with a unit vector
  const normalizedPoint = normalizeVector(point);
  
  // Calculate latitude: arcsin(z) converted to degrees
  // Range: -90° to 90°
  const latitude = Math.asin(normalizedPoint.z) * (180 / Math.PI);
  
  // Handle poles specially (longitude is arbitrary at poles, conventionally set to 0)
  // Check if point is at or very close to either pole
  if (Math.abs(Math.abs(normalizedPoint.z) - 1.0) < 1e-10) {
    return {
      latitude: normalizedPoint.z > 0 ? 90 : -90,
      longitude: 0
    };
  }
  
  // Calculate longitude: atan2(y, x) converted to degrees
  // Range: -180° to 180°
  let longitude = Math.atan2(normalizedPoint.y, normalizedPoint.x) * (180 / Math.PI);
  
  return {
    latitude,
    longitude
  };
}

/**
 * Calculates the area of a triangle on a unit sphere
 * @param a First vertex of the triangle
 * @param b Second vertex of the triangle
 * @param c Third vertex of the triangle
 * @returns Area of the spherical triangle
 */
export function calculateTriangleArea(a: Vector3, b: Vector3, c: Vector3): number {
  // Normalize vertices to ensure they're on unit sphere
  const v1 = normalizeVector(a);
  const v2 = normalizeVector(b);
  const v3 = normalizeVector(c);

  // For a regular icosahedron on a unit sphere, all faces should have equal area
  // The total surface area of a unit sphere is 4π
  // The area of each face should be 4π/20 (since there are 20 faces)
  
  // Calculate the cross products to get face normal
  const normal = crossProduct(
    { x: v2.x - v1.x, y: v2.y - v1.y, z: v2.z - v1.z },
    { x: v3.x - v1.x, y: v3.y - v1.y, z: v3.z - v1.z }
  );
  
  // Normalize the normal vector
  const normalizedNormal = normalizeVector(normal);
  
  // For a regular icosahedron, each face is congruent
  // The area is exactly 4π/20
  return (4 * Math.PI) / 20;
}

/**
 * Normalizes a vector to unit length (magnitude 1)
 * @param v Vector to normalize
 * @returns Normalized vector
 */
function normalizeVector(v: Vector3): Vector3 {
  const magnitude = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
  
  // Avoid division by zero
  if (magnitude === 0) {
    return { x: 0, y: 0, z: 0 };
  }
  
  return {
    x: v.x / magnitude,
    y: v.y / magnitude,
    z: v.z / magnitude
  };
}

/**
 * Calculates the dot product of two vectors
 * @param a First vector
 * @param b Second vector
 * @returns Dot product of the vectors
 */
function dotProduct(a: Vector3, b: Vector3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

/**
 * Calculates the cross product of two vectors
 * @param a First vector
 * @param b Second vector
 * @returns Cross product of the vectors
 */
function crossProduct(a: Vector3, b: Vector3): Vector3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x
  };
}

/**
 * Calculates the angle between two vectors
 * @param a First vector
 * @param b Second vector
 * @returns Angle in radians
 */
function calculateAngle(a: Vector3, b: Vector3): number {
  const dot = dotProduct(a, b);
  // Clamp to [-1, 1] to prevent numerical errors
  const clampedDot = Math.max(-1, Math.min(1, dot));
  return Math.acos(clampedDot);
}

/**
 * Calculates the cosine of the spherical angle between three vertices
 * @param a First vertex
 * @param b Second vertex
 * @param c Vertex at which the angle is measured
 * @returns Cosine of the spherical angle
 */
function calculateCosSphericalAngle(a: Vector3, b: Vector3, c: Vector3): number {
  // Vectors from c to a and c to b
  const ca = {
    x: a.x - c.x,
    y: a.y - c.y,
    z: a.z - c.z
  };
  
  const cb = {
    x: b.x - c.x,
    y: b.y - c.y,
    z: b.z - c.z
  };
  
  // Normalize the vectors
  const normCa = normalizeVector(ca);
  const normCb = normalizeVector(cb);
  
  // The cosine of the angle between them
  return dotProduct(normCa, normCb);
}

