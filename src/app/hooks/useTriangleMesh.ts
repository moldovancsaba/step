'use client';

import { useEffect, useMemo, useCallback } from 'react';
import { 
  useTriangleMeshStore, 
  useSelectedFace, 
  useHoveredFace, 
  useCanSubdivide 
} from '@/app/store/triangleMeshStore';
import { 
  TriangleFace, 
  TriangleMesh, 
  MapProjection,
  MeshStats,
  GeoCoordinate,
  ScreenCoordinate,
  screenToGeo,
  OSM_CONSTANTS
} from '@/app/types/geometry';
import { isPointInGeoTriangle } from '@/app/lib/sphericalMath';

/**
 * Statistics for the triangle mesh visualization
 */
export interface MeshVisualizationStats extends MeshStats {
  // Additional stats
  averageClicksPerFace: number;
  subdivisionRate: number; // % of faces at max clicks divided by total faces
  maxPossibleFaces: number; // Theoretical maximum at current level
  faceDistributionByLevel: {
    level: number;
    count: number;
    percentage: number;
  }[];
}

/**
 * Hook for managing triangle mesh visualization
 * Provides a simplified API for interacting with the triangle mesh
 */
export function useTriangleMesh() {
  // Get store state and actions
  const { 
    mesh,
    selectedFaceId,
    hoveredFaceId,
    meshStats,
    mapProjection,
    history,
    
    initializeMesh,
    selectFace,
    hoverFace,
    clickFace,
    subdivideFace: storeSplitFace,
    updateMapProjection,
    zoomIn,
    zoomOut,
    panMap,
    undo,
    redo,
    resetMesh
  } = useTriangleMeshStore();
  
  // Get selected and hovered faces
  const selectedFace = useSelectedFace();
  const hoveredFace = useHoveredFace();
  
  // Initialize mesh on first render
  useEffect(() => {
    if (!mesh || !meshStats) {
      initializeMesh();
    }
  }, [mesh, meshStats, initializeMesh]);
  
  /**
   * Calculate enhanced statistics for the mesh
   */
  const enhancedStats: MeshVisualizationStats | null = useMemo(() => {
    if (!meshStats) return null;
    
    const { 
      totalVertices, 
      totalFaces, 
      maxLevel, 
      totalClicks, 
      subdivisionsByLevel 
    } = meshStats;
    
    // Calculate additional statistics
    const averageClicksPerFace = totalClicks / totalFaces;
    
    // Count faces at max clicks
    const facesReadyForSubdivision = mesh.faces.filter(face => 
      face.clickCount >= 10 && face.level < OSM_CONSTANTS.MAX_ZOOM
    ).length;
    const subdivisionRate = facesReadyForSubdivision / totalFaces;
    
    // Calculate theoretical maximum faces at current level
    // For an icosahedron, each subdivision creates 4 new triangles
    // So max faces at level N = 20 × 4^N
    const maxPossibleFaces = 20 * Math.pow(4, maxLevel);
    
    // Calculate distribution by level with percentages
    const faceDistributionByLevel = subdivisionsByLevel.map(level => ({
      level: level.level,
      count: level.count,
      percentage: (level.count / totalFaces) * 100
    }));
    
    return {
      totalVertices,
      totalFaces,
      maxLevel,
      totalClicks,
      subdivisionsByLevel,
      averageClicksPerFace,
      subdivisionRate,
      maxPossibleFaces,
      faceDistributionByLevel,
    };
  }, [mesh, meshStats]);
  
  /**
   * Handle click on a face
   */
  const handleFaceClick = useCallback((faceId: string, event?: React.MouseEvent) => {
    // If shift is pressed, subdivide immediately if possible
    if (event?.shiftKey) {
      const face = mesh.faces.find(f => f.id === faceId);
      if (face && face.clickCount >= 10 && face.level < OSM_CONSTANTS.MAX_ZOOM) {
        storeSplitFace(faceId);
        return;
      }
    }
    
    // Otherwise increment click count
    clickFace(faceId);
  }, [mesh, clickFace, storeSplitFace]);
  
  /**
   * Subdivide a face without additional checks
   */
  const subdivideFace = useCallback((faceId: string) => {
    storeSplitFace(faceId);
  }, [storeSplitFace]);
  
  /**
   * Check if a face can be subdivided
   */
  const canSubdivideFace = useCallback((faceId: string): boolean => {
    const face = mesh.faces.find(f => f.id === faceId);
    return !!(face && face.clickCount >= 10 && face.level < OSM_CONSTANTS.MAX_ZOOM);
  }, [mesh]);
  
  /**
   * Find face at a specific geographic coordinate using spherical geometry
   * 
   * @param coordinate The geographic coordinate to test (latitude/longitude)
   * @returns The triangle face containing the coordinate, or null if not found
   */
  const findFaceAtCoordinate = useCallback((coordinate: GeoCoordinate): TriangleFace | null => {
    // For production apps, a spatial index would improve performance
    
    for (const face of mesh.faces) {
      const [a, b, c] = face.vertices;
      const vA = mesh.vertices[a];
      const vB = mesh.vertices[b];
      const vC = mesh.vertices[c];
      
      // Check if point is inside this triangle using proper spherical geometry
      // The isPointInGeoTriangle function handles the conversion to 3D vectors
      // and performs spherical barycentric coordinate calculations
      const isInside = isPointInGeoTriangle(coordinate, vA, vB, vC);
      if (isInside) {
        return face;
      }
    }
    
    return null;
  }, [mesh]);
  
  /**
   * Find face at a screen coordinate by converting to geographic coordinates first
   * 
   * @param screenCoord The screen coordinate to test (x/y pixels)
   * @returns The triangle face containing the coordinate, or null if not found
   */
  const findFaceAtScreenCoordinate = useCallback((screenCoord: ScreenCoordinate): TriangleFace | null => {
    // Convert screen coordinate to geographic coordinate using the current projection
    const geoCoord = screenToGeo(screenCoord, mapProjection);
    return findFaceAtCoordinate(geoCoord);
  }, [findFaceAtCoordinate, mapProjection]);
  
  /**
   * Get faces at a specific level
   */
  const getFacesByLevel = useCallback((level: number): TriangleFace[] => {
    return mesh.faces.filter(face => face.level === level);
  }, [mesh]);
  
  /**
   * Update map size (e.g., on window resize)
   */
  const updateMapSize = useCallback((width: number, height: number) => {
    updateMapProjection({ width, height });
  }, [updateMapProjection]);
  
  /**
   * Set map center to a specific coordinate
   */
  const centerMapOn = useCallback((coordinate: GeoCoordinate) => {
    updateMapProjection({ center: coordinate });
  }, [updateMapProjection]);
  
  /**
   * Set zoom level directly
   */
  const setZoom = useCallback((zoom: number) => {
    const newZoom = Math.max(
      OSM_CONSTANTS.MIN_ZOOM, 
      Math.min(OSM_CONSTANTS.MAX_ZOOM, zoom)
    );
    updateMapProjection({ zoom: newZoom });
  }, [updateMapProjection]);
  
  /**
   * Get history status
   */
  const historyStatus = useMemo(() => ({
    canUndo: history.past.length > 0,
    canRedo: history.future.length > 0,
    historyLength: history.past.length,
    futureLength: history.future.length,
  }), [history]);
  
  return {
    // State
    mesh,
    meshStats: enhancedStats,
    selectedFace,
    selectedFaceId,
    hoveredFace,
    hoveredFaceId,
    mapProjection,
    
    // History
    historyStatus,
    
    // Core actions
    initializeMesh,
    resetMesh,
    selectFace,
    hoverFace,
    clickFace: handleFaceClick,
    subdivideFace,
    canSubdivideFace,
    
    // Map controls
    updateMapProjection,
    zoomIn,
    zoomOut,
    panMap,
    updateMapSize,
    centerMapOn,
    setZoom,
    
    // History actions
    undo,
    redo,
    
    // Utility functions
    findFaceAtCoordinate,
    findFaceAtScreenCoordinate,
    getFacesByLevel,
  };
}
