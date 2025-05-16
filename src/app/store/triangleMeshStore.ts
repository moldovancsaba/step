import { create } from 'zustand';
import { 
  TriangleMesh, 
  TriangleFace, 
  GeoCoordinate,
  MapProjection,
  createInitialMesh,
  incrementClickCount,
  subdivideFace,
  calculateMeshStats,
  MeshStats,
  updateTriangleColor,
  OSM_CONSTANTS
} from '@/app/types/geometry';

/**
 * Triangle Mesh Store State Interface
 */
interface TriangleMeshState {
  // Core mesh data
  mesh: TriangleMesh;
  selectedFaceId: string | null;
  hoveredFaceId: string | null;
  meshStats: MeshStats | null;
  
  // Map projection for OpenStreetMap integration
  mapProjection: MapProjection;
  
  // History for undo/redo
  history: {
    past: TriangleMesh[];
    future: TriangleMesh[];
  };

  // Actions
  initializeMesh: () => void;
  selectFace: (faceId: string | null) => void;
  hoverFace: (faceId: string | null) => void;
  clickFace: (faceId: string) => void;
  subdivideFace: (faceId: string) => void;
  updateMapProjection: (projection: Partial<MapProjection>) => void;
  zoomIn: () => void;
  zoomOut: () => void;
  panMap: (deltaLat: number, deltaLng: number) => void;
  undo: () => void;
  redo: () => void;
  resetMesh: () => void;
}

/**
 * Default map projection
 */
const DEFAULT_PROJECTION: MapProjection = {
  zoom: 2,
  center: { latitude: 0, longitude: 0 },
  width: 800,
  height: 600,
  rotation: 0
};

/**
 * Create the triangle mesh store
 */
export const useTriangleMeshStore = create<TriangleMeshState>((set, get) => ({
  // Initial state
  mesh: createInitialMesh(),
  selectedFaceId: null,
  hoveredFaceId: null,
  meshStats: null,
  mapProjection: DEFAULT_PROJECTION,
  history: {
    past: [],
    future: []
  },

  /**
   * Initialize the mesh with starting data
   */
  initializeMesh: () => {
    const initialMesh = createInitialMesh();
    const meshStats = calculateMeshStats(initialMesh);
    
    set({
      mesh: initialMesh,
      meshStats,
      selectedFaceId: null,
      hoveredFaceId: null,
      history: {
        past: [],
        future: []
      }
    });
  },

  /**
   * Save the current state to history
   * @private
   */
  _saveToHistory: (state: TriangleMeshState) => {
    const { mesh, history } = state;
    return {
      ...state,
      history: {
        past: [...history.past, { ...mesh }],
        future: []
      }
    };
  },

  /**
   * Select a triangle face
   */
  selectFace: (faceId: string | null) => {
    set({ selectedFaceId: faceId });
  },

  /**
   * Hover over a triangle face
   */
  hoverFace: (faceId: string | null) => {
    set({ hoveredFaceId: faceId });
  },

  /**
   * Handle click on a triangle face
   * Increments click count and updates color
   */
  clickFace: (faceId: string) => {
    const state = get();
    const { mesh } = state;
    
    // Save current state to history
    set(state => get()._saveToHistory(state));
    
    // Find the face
    const faceIndex = mesh.faces.findIndex(face => face.id === faceId);
    if (faceIndex === -1) return;
    
    const face = mesh.faces[faceIndex];
    const updatedFace = incrementClickCount(face);
    
    // Update the mesh with the new face
    const updatedFaces = [...mesh.faces];
    updatedFaces[faceIndex] = updatedFace;
    
    const updatedMesh = {
      ...mesh,
      faces: updatedFaces
    };
    
    set({
      mesh: updatedMesh,
      selectedFaceId: faceId,
      meshStats: calculateMeshStats(updatedMesh)
    });
  },

  /**
   * Subdivide a triangle face into 4 smaller triangles
   */
  subdivideFace: (faceId: string) => {
    const state = get();
    const { mesh } = state;
    
    // Save current state to history
    set(state => get()._saveToHistory(state));
    
    // Check if face exists and can be subdivided
    const faceIndex = mesh.faces.findIndex(face => face.id === faceId);
    if (faceIndex === -1) return;
    
    const face = mesh.faces[faceIndex];
    
    // Only allow subdivision if clicked enough times
    if (face.clickCount < 10 || face.level >= OSM_CONSTANTS.MAX_ZOOM) return;
    
    // Perform subdivision
    const subdivision = subdivideFace(mesh, faceId);
    if (!subdivision) return;
    
    const { newVertices, newFaces, parentFaceId } = subdivision;
    
    // Create updated mesh with new vertices and faces
    const updatedMesh = {
      vertices: [...mesh.vertices, ...newVertices],
      faces: [
        // Remove the parent face
        ...mesh.faces.filter(f => f.id !== parentFaceId),
        // Add the new faces
        ...newFaces
      ]
    };
    
    set({
      mesh: updatedMesh,
      selectedFaceId: null,
      meshStats: calculateMeshStats(updatedMesh)
    });
  },

  /**
   * Update map projection for OpenStreetMap integration
   */
  updateMapProjection: (projection: Partial<MapProjection>) => {
    set(state => ({
      mapProjection: {
        ...state.mapProjection,
        ...projection
      }
    }));
  },

  /**
   * Zoom in on the map
   */
  zoomIn: () => {
    set(state => {
      const newZoom = Math.min(state.mapProjection.zoom + 1, OSM_CONSTANTS.MAX_ZOOM);
      return {
        mapProjection: {
          ...state.mapProjection,
          zoom: newZoom
        }
      };
    });
  },

  /**
   * Zoom out on the map
   */
  zoomOut: () => {
    set(state => {
      const newZoom = Math.max(state.mapProjection.zoom - 1, OSM_CONSTANTS.MIN_ZOOM);
      return {
        mapProjection: {
          ...state.mapProjection,
          zoom: newZoom
        }
      };
    });
  },

  /**
   * Pan the map in a direction
   */
  panMap: (deltaLat: number, deltaLng: number) => {
    set(state => {
      const { center } = state.mapProjection;
      
      // Apply constraints to avoid invalid coordinates
      const newLat = Math.max(-85, Math.min(85, center.latitude + deltaLat));
      const newLng = ((center.longitude + deltaLng + 180) % 360) - 180; // Wrap around at 180/-180
      
      return {
        mapProjection: {
          ...state.mapProjection,
          center: {
            latitude: newLat,
            longitude: newLng
          }
        }
      };
    });
  },

  /**
   * Undo the last action
   */
  undo: () => {
    const { history, mesh } = get();
    const { past, future } = history;
    
    if (past.length === 0) return;
    
    const previousMesh = past[past.length - 1];
    const newPast = past.slice(0, past.length - 1);
    
    set({
      mesh: previousMesh,
      history: {
        past: newPast,
        future: [mesh, ...future]
      },
      meshStats: calculateMeshStats(previousMesh)
    });
  },

  /**
   * Redo the last undone action
   */
  redo: () => {
    const { history, mesh } = get();
    const { past, future } = history;
    
    if (future.length === 0) return;
    
    const nextMesh = future[0];
    const newFuture = future.slice(1);
    
    set({
      mesh: nextMesh,
      history: {
        past: [...past, mesh],
        future: newFuture
      },
      meshStats: calculateMeshStats(nextMesh)
    });
  },

  /**
   * Reset the mesh to initial state
   */
  resetMesh: () => {
    set(state => get()._saveToHistory(state));
    get().initializeMesh();
  }
}));

/**
 * Custom hook to access selected face data
 */
export function useSelectedFace() {
  return useTriangleMeshStore(state => {
    const { mesh, selectedFaceId } = state;
    if (!selectedFaceId) return null;
    
    return mesh.faces.find(face => face.id === selectedFaceId) || null;
  });
}

/**
 * Custom hook to access hovered face data
 */
export function useHoveredFace() {
  return useTriangleMeshStore(state => {
    const { mesh, hoveredFaceId } = state;
    if (!hoveredFaceId) return null;
    
    return mesh.faces.find(face => face.id === hoveredFaceId) || null;
  });
}

/**
 * Custom hook to check if a face can be subdivided
 */
export function useCanSubdivide(faceId: string | null) {
  return useTriangleMeshStore(state => {
    if (!faceId) return false;
    
    const face = state.mesh.faces.find(f => f.id === faceId);
    if (!face) return false;
    
    return face.clickCount >= 10 && face.level < OSM_CONSTANTS.MAX_ZOOM;
  });
}

'use client';

import { create } from 'zustand';
import { 
  GeoCoordinate, 
  INITIAL_FACES, 
  INITIAL_VERTICES, 
  TriangleFace, 
  TriangleMesh, 
  geoMidpoint,
  getColorForClickCount
} from '../types/geometry';

interface TriangleMeshState {
  // State
  mesh: TriangleMesh | null;
  loading: boolean;
  error: string | null;
  selectedFaceId: string | null;
  
  // Actions
  initializeMesh: () => Promise<void>;
  clickTriangle: (faceId: string) => void;
  selectFace: (faceId: string | null) => void;
  resetMesh: () => void;
}

/**
 * Creates the initial triangle mesh
 */
function createInitialMesh(): TriangleMesh {
  // Create the initial faces with level 0 and 0 clicks
  const faces: TriangleFace[] = INITIAL_FACES.map((vertexIndices, index) => ({
    id: `face-${index}`,
    vertices: vertexIndices as [number, number, number],
    level: 0,
    clickCount: 0,
    color: 'white', // Initial color is white
  }));
  
  return {
    vertices: [...INITIAL_VERTICES],
    faces,
  };
}

/**
 * Subdivides a triangle face into four smaller triangles
 */
function subdivideTriangle(mesh: TriangleMesh, faceId: string): TriangleMesh {
  // Find the face to subdivide
  const faceIndex = mesh.faces.findIndex(face => face.id === faceId);
  if (faceIndex === -1) return mesh;
  
  const face = mesh.faces[faceIndex];
  
  // Only subdivide if the face has been clicked 10 times and is below level 19
  if (face.clickCount < 10 || face.level >= 19) return mesh;
  
  // Get the vertices of the face
  const [v1Index, v2Index, v3Index] = face.vertices;
  const v1 = mesh.vertices[v1Index];
  const v2 = mesh.vertices[v2Index];
  const v3 = mesh.vertices[v3Index];
  
  // Calculate midpoints of the sides
  const m1 = geoMidpoint(v1, v2);
  const m2 = geoMidpoint(v2, v3);
  const m3 = geoMidpoint(v3, v1);
  
  // Add new vertices to the mesh
  const newVertices = [...mesh.vertices, m1, m2, m3];
  
  // Get the indices of the new vertices
  const m1Index = mesh.vertices.length;
  const m2Index = mesh.vertices.length + 1;
  const m3Index = mesh.vertices.length + 2;
  
  // Create 4 new faces
  const newLevel = face.level + 1;
  const newFaces: TriangleFace[] = [
    // Remove the original face and add 4 new ones
    ...mesh.faces.slice(0, faceIndex),
    ...mesh.faces.slice(faceIndex + 1),
    
    // Four new triangles with white color and 0 clicks
    {
      id: `${faceId}-1`,
      vertices: [v1Index, m1Index, m3Index] as [number, number, number],
      level: newLevel,
      clickCount: 0,
      color: 'white',
      parentFaceId: faceId,
    },
    {
      id: `${faceId}-2`,
      vertices: [m1Index, v2Index, m2Index] as [number, number, number],
      level: newLevel,
      clickCount: 0,
      color: 'white',
      parentFaceId: faceId,
    },
    {
      id: `${faceId}-3`,
      vertices: [m3Index, m2Index, v3Index] as [number, number, number],
      level: newLevel,
      clickCount: 0,
      color: 'white',
      parentFaceId: faceId,
    },
    {
      id: `${faceId}-4`,
      vertices: [m1Index, m2Index, m3Index] as [number, number, number],
      level: newLevel,
      clickCount: 0,
      color: 'white',
      parentFaceId: faceId,
    },
  ];
  
  // Return updated mesh
  return {
    vertices: newVertices,
    faces: newFaces,
  };
}

/**
 * Triangle mesh store using Zustand
 */
const useTriangleMeshStore = create<TriangleMeshState>((set, get) => ({
  // Initial state
  mesh: null,
  loading: false,
  error: null,
  selectedFaceId: null,
  
  // Initialize the mesh
  initializeMesh: async () => {
    try {
      set({ loading: true, error: null });
      
      // Create initial mesh
      const initialMesh = createInitialMesh();
      
      // Simulate async loading for demonstration
      await new Promise(resolve => setTimeout(resolve, 500));
      
      set({
        mesh: initialMesh,
        loading: false,
      });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to initialize mesh',
        loading: false,
      });
    }
  },
  
  // Handle clicking on a triangle
  clickTriangle: (faceId: string) => {
    const { mesh } = get();
    if (!mesh) return;
    
    // Find the face in the mesh
    const faceIndex = mesh.faces.findIndex(face => face.id === faceId);
    if (faceIndex === -1) return;
    
    const face = mesh.faces[faceIndex];
    const newClickCount = face.clickCount + 1;
    
    // Create copy of faces array
    let newFaces = [...mesh.faces];
    let newMesh = { ...mesh };
    
    if (newClickCount <= 10) {
      // Just increment click count and update color
      const color = getColorForClickCount(newClickCount, face.level);
      
      newFaces[faceIndex] = {
        ...face,
        clickCount: newClickCount,
        color,
      };
      
      set({
        mesh: {
          ...mesh,
          faces: newFaces,
        },
        selectedFaceId: faceId,
      });
    } else if (face.level < 19) {
      // Subdivide the triangle on the 11th click
      newMesh = subdivideTriangle(mesh, faceId);
      
      set({
        mesh: newMesh,
        selectedFaceId: null, // Deselect after subdivision
      });
    } else if (face.level === 19) {
      // At max level, just turn red on 11th click
      newFaces[faceIndex] = {
        ...face,
        clickCount: newClickCount,
        color: 'red',
      };
      
      set({
        mesh: {
          ...mesh,
          faces: newFaces,
        },
        selectedFaceId: faceId,
      });
    }
  },
  
  // Select a face
  selectFace: (faceId: string | null) => {
    set({ selectedFaceId: faceId });
  },
  
  // Reset the mesh to its initial state
  resetMesh: () => {
    set({
      mesh: createInitialMesh(),
      selectedFaceId: null,
      error: null,
    });
  },
}));

export default useTriangleMeshStore;

