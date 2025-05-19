'use client';

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
import { geoToVector3, vector3ToGeo } from '@/app/lib/sphericalMath';

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
  
  // Private actions (internal use only)
  _saveToHistory: (state: TriangleMeshState) => TriangleMeshState;
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
  _saveToHistory: (state: TriangleMeshState): TriangleMeshState => {
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
   * Subdivide a triangle face into 3 smaller triangles from a click point
   */
  subdivideFace: (faceId: string, clickCoordinate?: GeoCoordinate) => {
    const state = get();
    const { mesh } = state;
    
    // Save current state to history
    set(state => get()._saveToHistory(state));
    
    // Check if face exists and can be subdivided
    const faceIndex = mesh.faces.findIndex(face => face.id === faceId);
    if (faceIndex === -1) return;
    
    const face = mesh.faces[faceIndex];
    
    // Only check level (removing click count requirement)
    if (face.level >= OSM_CONSTANTS.MAX_ZOOM) return;
    
    // Perform subdivision with optional click coordinate
    const subdivision = subdivideFace(mesh, faceId, clickCoordinate);
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

