import { Vector3, Face } from './icosahedron';

/**
 * Result of triangle division operation
 */
export type TriangleDivisionResult = {
  newVertices: Vector3[];  // New vertices created at edge midpoints
  newFaces: Face[];       // New faces created by subdivision
};

/**
 * Divides a triangle into 4 equal sub-triangles
 * @param vertices Array of vertices containing the triangle's corner points
 * @param face Face to be divided
 * @returns New vertices and faces created by the division
 */
export function divideTriangle(vertices: Vector3[], face: Face): TriangleDivisionResult {
  // Get the three vertices of the triangle
  const v1 = vertices[face.a];
  const v2 = vertices[face.b];
  const v3 = vertices[face.c];
  
  // Calculate midpoints on the great circle arcs
  const m1 = calculateMidpoint(v1, v2); // Between v1 and v2
  const m2 = calculateMidpoint(v2, v3); // Between v2 and v3
  const m3 = calculateMidpoint(v3, v1); // Between v3 and v1
  
  // New vertices array (midpoints)
  const newVertices = [m1, m2, m3];
  
  // Calculate indices for new vertices
  const baseIndex = vertices.length;
  const m1Index = baseIndex;      // First midpoint
  const m2Index = baseIndex + 1;  // Second midpoint
  const m3Index = baseIndex + 2;  // Third midpoint
  
  // Create four new faces using original vertices and midpoints
  const newFaces: Face[] = [
    // Center triangle using all midpoints
    { a: m1Index, b: m2Index, c: m3Index },
    // Corner triangle at v1
    { a: face.a, b: m1Index, c: m3Index },
    // Corner triangle at v2
    { a: face.b, b: m2Index, c: m1Index },
    // Corner triangle at v3
    { a: face.c, b: m3Index, c: m2Index }
  ];
  
  return {
    newVertices,
    newFaces
  };
}

/**
 * Calculates the midpoint between two vertices on the surface of a unit sphere
 * @param v1 First vertex
 * @param v2 Second vertex
 * @returns Midpoint vertex (normalized to unit sphere)
 */
function calculateMidpoint(v1: Vector3, v2: Vector3): Vector3 {
  // Calculate midpoint in 3D space
  const midpoint: Vector3 = {
    x: (v1.x + v2.x) / 2,
    y: (v1.y + v2.y) / 2,
    z: (v1.z + v2.z) / 2
  };
  
  // Normalize to unit sphere surface
  const magnitude = Math.sqrt(
    midpoint.x * midpoint.x +
    midpoint.y * midpoint.y +
    midpoint.z * midpoint.z
  );
  
  return {
    x: midpoint.x / magnitude,
    y: midpoint.y / magnitude,
    z: midpoint.z / magnitude
  };
}

