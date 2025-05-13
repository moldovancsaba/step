import { Face, Vector3 } from './icosahedron';
import { divideTriangle, TriangleDivisionResult } from './triangleDivision';
import { calculateTriangleArea } from './icosahedron';

describe('Triangle Division System', () => {
  describe('Triangle Subdivision', () => {
    it('divides a triangle into 4 equal sub-triangles', () => {
      // Create a test triangle (equilateral on unit sphere)
      const vertices: Vector3[] = [
        { x: 0, y: 0, z: 1 },          // North pole
        { x: 1, y: 0, z: 0 },          // Point on equator
        { x: 0, y: 1, z: 0 }           // Point on equator
      ];
      const face: Face = { a: 0, b: 1, c: 2 };
      
      const result = divideTriangle(vertices, face);
      
      // Should create 4 new triangles
      expect(result.newFaces).toHaveLength(4);
      expect(result.newVertices).toHaveLength(3); // 3 new vertices on edge midpoints
      
      // Verify area equality
      const areas = calculateAreasForSubTriangles(result, vertices);
      const averageArea = areas.reduce((sum, area) => sum + area, 0) / areas.length;
      
      areas.forEach(area => {
        const percentDifference = Math.abs(area - averageArea) / averageArea * 100;
        expect(percentDifference).toBeLessThanOrEqual(0.1); // Within 0.1% tolerance
      });
    });
    
    it('maintains vertex positions on unit sphere surface', () => {
      const vertices: Vector3[] = [
        { x: 0, y: 0, z: 1 },
        { x: 1, y: 0, z: 0 },
        { x: 0, y: 1, z: 0 }
      ];
      const face: Face = { a: 0, b: 1, c: 2 };
      
      const result = divideTriangle(vertices, face);
      
      // Check all new vertices are on unit sphere
      result.newVertices.forEach(vertex => {
        const magnitude = Math.sqrt(
          vertex.x * vertex.x +
          vertex.y * vertex.y +
          vertex.z * vertex.z
        );
        expect(magnitude).toBeCloseTo(1.0, 5);
      });
    });
    
    it('handles 19 levels of recursive subdivision', () => {
      const vertices: Vector3[] = [
        { x: 0, y: 0, z: 1 },
        { x: 1, y: 0, z: 0 },
        { x: 0, y: 1, z: 0 }
      ];
      const face: Face = { a: 0, b: 1, c: 2 };
      
      let currentVertices = [...vertices];
      let currentFace = face;
      let subdivisionCount = 0;
      
      // Recursively subdivide 19 times
      while (subdivisionCount < 19) {
        const result = divideTriangle(currentVertices, currentFace);
        currentVertices = [...currentVertices, ...result.newVertices];
        currentFace = result.newFaces[0]; // Continue with one of the new faces
        subdivisionCount++;
      }
      
      // Verify we can reach 19 levels
      expect(subdivisionCount).toBe(19);
      
      // Verify final vertices are still on unit sphere
      currentVertices.forEach(vertex => {
        const magnitude = Math.sqrt(
          vertex.x * vertex.x +
          vertex.y * vertex.y +
          vertex.z * vertex.z
        );
        expect(magnitude).toBeCloseTo(1.0, 5);
      });
    });
  });
});

// Helper function to calculate areas of all subtriangles
function calculateAreasForSubTriangles(
  result: TriangleDivisionResult,
  originalVertices: Vector3[]
): number[] {
  const allVertices = [...originalVertices, ...result.newVertices];
  
  return result.newFaces.map(face => {
    const v1 = allVertices[face.a];
    const v2 = allVertices[face.b];
    const v3 = allVertices[face.c];
    return calculateTriangleArea(v1, v2, v3);
  });
}

