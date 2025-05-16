import { create } from 'zustand';
import { 
  TriangleMesh, 
  createInitialMesh, 
  incrementClickCount, 
  subdivideFace,
  calculateMeshStats,
  MeshStats 
} from '../types/geometry';

interface MeshState {
  mesh: TriangleMesh | null;
  stats: MeshStats | null;
  selectedFaceId: string | null;
  hoveredFaceId: string | null;
  
  // Actions
  initializeMesh: () => void;
  clickFace: (faceId: string) => void;
  selectFace: (faceId: string | null) => void;
  hoverFace: (faceId: string | null) => void;
  subdivide: (faceId: string) => void;
}

export const useMeshStore = create<MeshState>((set, get) => ({
  mesh: null,
  stats: null,
  selectedFaceId: null,
  hoveredFaceId: null,

  initializeMesh: () => {
    const mesh = createInitialMesh();
    const stats = calculateMeshStats(mesh);
    set({ mesh, stats });
  },

  clickFace: (faceId: string) => {
    const { mesh } = get();
    if (!mesh) return;

    const faceIndex = mesh.faces.findIndex(f => f.id === faceId);
    if (faceIndex === -1) return;

    const face = mesh.faces[faceIndex];
    const updatedFace = incrementClickCount(face);

    const newFaces = [...mesh.faces];
    newFaces[faceIndex] = updatedFace;

    const updatedMesh = {
      ...mesh,
      faces: newFaces
    };

    set({
      mesh: updatedMesh,
      stats: calculateMeshStats(updatedMesh),
      selectedFaceId: faceId
    });

    // Auto-subdivide on 11th click
    if (updatedFace.clickCount >= 11) {
      get().subdivide(faceId);
    }
  },

  selectFace: (faceId: string | null) => {
    set({ selectedFaceId: faceId });
  },

  hoverFace: (faceId: string | null) => {
    set({ hoveredFaceId: faceId });
  },

  subdivide: (faceId: string) => {
    const { mesh } = get();
    if (!mesh) return;

    const result = subdivideFace(mesh, faceId);
    if (!result) return;

    const { newVertices, newFaces, parentFaceId } = result;

    const updatedMesh = {
      vertices: [...mesh.vertices, ...newVertices],
      faces: [
        ...mesh.faces.filter(f => f.id !== parentFaceId),
        ...newFaces
      ]
    };

    set({
      mesh: updatedMesh,
      stats: calculateMeshStats(updatedMesh),
      selectedFaceId: null
    });
  }
}));

