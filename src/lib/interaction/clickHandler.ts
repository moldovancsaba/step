import { Face, Vector3 } from '../geometry/icosahedron';
import { divideTriangle, TriangleDivisionResult } from '../geometry/triangleDivision';

/**
 * Represents the state of a triangle in the visualization
 */
export type TriangleState = {
  face: Face;
  vertices: Vector3[];
  clickCount: number;
  level: number;
  color: string;
};

/**
 * Result of a triangle click interaction
 */
export type ClickResult = {
  clickCount: number;
  color: string;
  subdivided: boolean;
  newTriangles?: TriangleState[];
};

/**
 * Handles a click on a triangle, updating its state
 * @param triangle Current state of the clicked triangle
 * @returns Updated state after the click
 */
export function handleTriangleClick(triangle: TriangleState): ClickResult {
  const newClickCount = triangle.clickCount + 1;
  
  // Handle 11th click specially
  if (newClickCount === 11) {
    // At level 19, turn red instead of subdividing
    if (triangle.level === 19) {
      return {
        clickCount: newClickCount,
        color: '#ff0000',
        subdivided: false
      };
    }
    
    // Otherwise, subdivide the triangle
    const divisionResult = divideTriangle(triangle.vertices, triangle.face);
    
    // Create new triangle states for the subdivided triangles
    const newTriangles = divisionResult.newFaces.map((face, index) => {
      // Calculate vertices for this new face
      const faceVertices = [
        divisionResult.newVertices[face.a - triangle.vertices.length] || triangle.vertices[face.a],
        divisionResult.newVertices[face.b - triangle.vertices.length] || triangle.vertices[face.b],
        divisionResult.newVertices[face.c - triangle.vertices.length] || triangle.vertices[face.c]
      ];
      
      return {
        face,
        vertices: faceVertices,
        clickCount: 0,
        level: triangle.level + 1,
        color: '#ffffff'
      };
    });
    
    return {
      clickCount: newClickCount,
      color: triangle.color,
      subdivided: true,
      newTriangles
    };
  }
  
  // For clicks 1-10, increment gray level
  const grayLevel = newClickCount * 10;
  const colorValue = Math.round(255 - (grayLevel * 2.55));
  const newColor = rgbToHex(colorValue);
  
  return {
    clickCount: newClickCount,
    color: newColor,
    subdivided: false
  };
}

/**
 * Converts an RGB value to a hex color string
 * @param value RGB value (0-255)
 * @returns Hex color string (e.g., '#ffffff')
 */
function rgbToHex(value: number): string {
  const hex = Math.round(value).toString(16).padStart(2, '0');
  return `#${hex}${hex}${hex}`;
}

