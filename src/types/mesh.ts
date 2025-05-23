export interface TriangleMesh {
  id: string;
  coordinates: [number, number][]; // [longitude, latitude][]
}

export interface RenderConfig {
  wireframe: boolean;
  opacity: number;
  color: string;
  visible: boolean;
  highlightColor: string;
}

export interface MeshState {
  selectedVertices: number[];
  hoveredVertex: number | null;
  selectedFaces: string[];
  hoveredFace: string | null;
}

export interface MeshTransform {
  position: [number, number, number]; // [x, y, z]
  rotation: [number, number, number]; // [rx, ry, rz]
  scale: number;
}

// Three.js specific mesh data
export interface MeshGeometryData {
  vertices: Float32Array;
  indices: Uint32Array;
  normals?: Float32Array;
  colors?: Float32Array;
}

export type MeshOperation = 
  | { type: 'SELECT_VERTEX'; index: number }
  | { type: 'SELECT_FACE'; id: string }
  | { type: 'MOVE_VERTEX'; index: number; position: [number, number] }
  | { type: 'SUBDIVIDE_FACE'; id: string }
  | { type: 'DELETE_FACE'; id: string }
  | { type: 'MERGE_FACES'; ids: string[] };
