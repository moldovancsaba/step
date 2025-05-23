import { TriangleMesh } from '../types/mesh';

export const loadTriangleMesh = async (filePath: string): Promise<TriangleMesh[]> => {
  try {
    const response = await fetch(filePath);
    const data = await response.json();
    return data;
  } catch (error) {
    console.error('Error loading triangle mesh:', error);
    return [];
  }
};

// Convert array coordinates to mesh vertices and faces
export const createMeshGeometry = (meshes: TriangleMesh[]): {
  vertices: Float32Array;
  indices: Uint32Array;
} => {
  const vertices: number[] = [];
  const indices: number[] = [];
  let vertexIndex = 0;

  meshes.forEach(mesh => {
    // Add vertices
    mesh.coordinates.forEach(coord => {
      vertices.push(coord[0], coord[1], 0); // Using 0 for z-coordinate
    });

    // Add face indices
    indices.push(
      vertexIndex,
      vertexIndex + 1,
      vertexIndex + 2
    );
    vertexIndex += 3;
  });

  return {
    vertices: new Float32Array(vertices),
    indices: new Uint32Array(indices)
  };
};

// Calculate mesh bounds
export const calculateMeshBounds = (meshes: TriangleMesh[]): {
  min: [number, number];
  max: [number, number];
} => {
  let minLon = Infinity;
  let maxLon = -Infinity;
  let minLat = Infinity;
  let maxLat = -Infinity;

  meshes.forEach(mesh => {
    mesh.coordinates.forEach(coord => {
      minLon = Math.min(minLon, coord[0]);
      maxLon = Math.max(maxLon, coord[0]);
      minLat = Math.min(minLat, coord[1]);
      maxLat = Math.max(maxLat, coord[1]);
    });
  });

  return {
    min: [minLon, minLat],
    max: [maxLon, maxLat]
  };
};

// Get mesh center point
export const calculateMeshCenter = (meshes: TriangleMesh[]): [number, number] => {
  const bounds = calculateMeshBounds(meshes);
  return [
    (bounds.min[0] + bounds.max[0]) / 2,
    (bounds.min[1] + bounds.max[1]) / 2
  ];
};
