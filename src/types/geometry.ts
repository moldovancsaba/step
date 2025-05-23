export interface CustomProperties {
  name?: string;
  description?: string;
  tags?: string[];
  [key: string]: string | string[] | number | boolean | undefined;
}

export interface Coordinate {
  latitude: number;
  longitude: number;
  altitude?: number;
  timestamp: number;
}

export interface MeshVertex {
  position: [number, number, number]; // x, y, z coordinates
  normal?: [number, number, number];
  uv?: [number, number];
}

export interface MeshFace {
  vertices: [number, number, number]; // indices of vertices
}

export interface GeometryMesh {
  id: string;
  vertices: MeshVertex[];
  faces: MeshFace[];
  createdAt: Date;
  updatedAt: Date;
  creator: string; // wallet address
  location: {
    center: Coordinate;
    bounds: {
      northeast: Coordinate;
      southwest: Coordinate;
    };
  };
  properties: CustomProperties;
}

export interface GeometryUpdate {
  meshId: string;
  updateType: 'ADD_VERTEX' | 'REMOVE_VERTEX' | 'MODIFY_VERTEX' | 'ADD_FACE' | 'REMOVE_FACE';
  data: Partial<GeometryMesh>;
  timestamp: number;
  userLocation: Coordinate;
}

export interface MapViewport {
  center: [number, number];
  zoom: number;
  bearing: number;
  pitch: number;
}

export type UpdateOperation = {
  type: 'ADD_VERTEX' | 'REMOVE_VERTEX' | 'MODIFY_VERTEX' | 'ADD_FACE' | 'REMOVE_FACE';
  payload: {
    vertex?: MeshVertex;
    face?: MeshFace;
    index?: number;
    data?: Partial<MeshVertex | MeshFace>;
  };
};

export interface MeshVisualization {
  wireframe: boolean;
  opacity: number;
  color: string;
  visible: boolean;
}

export interface MeshInteractionState {
  isDrawing: boolean;
  selectedVertices: number[];
  hoveredVertex: number | null;
  mode: 'VIEW' | 'EDIT' | 'CREATE';
}
