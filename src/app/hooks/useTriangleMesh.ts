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
   * Find face at a specific geographic coordinate
   */
  const findFaceAtCoordinate = useCallback((coordinate: GeoCoordinate): TriangleFace | null => {
    // This is a simplistic implementation that checks if the point is inside any triangle
    // For a production app, you'd want a spatial index for efficiency
    
    for (const face of mesh.faces) {
      const [a, b, c] = face.vertices;
      const vA = mesh.vertices[a];
      const vB = mesh.vertices[b];
      const vC = mesh.vertices[c];
      
      // Check if point is inside this triangle
      // This is a simple approximation - would need geodesic calculations for accuracy
      const isInside = isPointInGeoTriangle(coordinate, vA, vB, vC);
      if (isInside) {
        return face;
      }
    }
    
    return null;
  }, [mesh]);
  
  /**
   * Find face at a screen coordinate
   */
  const findFaceAtScreenCoordinate = useCallback((screenCoord: ScreenCoordinate): TriangleFace | null => {
    // Convert screen coordinate to geographic coordinate
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

/**
 * Simple check if a point is inside a triangle on a sphere
 * This is an approximation - for production, use proper geodesic calculations
 */
function isPointInGeoTriangle(
  point: GeoCoordinate, 
  a: GeoCoordinate, 
  b: GeoCoordinate, 
  c: GeoCoordinate
): boolean {
  // Convert to Cartesian coordinates
  const pointCart = geoToCartesian(point);
  const aCart = geoToCartesian(a);
  const bCart = geoToCartesian(b);
  const cCart = geoToCartesian(c);
  
  // Calculate barycentric coordinates
  // This is an approximation that works for small triangles
  // For accurate calculations on a sphere, use spherical barycentric coordinates
  const v0 = [bCart[0] - aCart[0], bCart[1] - aCart[1], bCart[2] - aCart[2]];
  const v1 = [cCart[0] - aCart[0], cCart[1] - aCart[1], cCart[2] - aCart[2]];
  const v2 = [pointCart[0] - aCart[0], pointCart[1] - aCart[1], pointCart[2] - aCart[2]];
  
  const dot00 = dotProduct(v0, v0);
  const dot01 = dotProduct(v0, v1);
  const dot02 = dotProduct(v0, v2);
  const dot11 = dotProduct(v1, v1);
  const dot12 = dotProduct(v1, v2);
  
  const invDenom = 1 / (dot00 * dot11 - dot01 * dot01);
  const u = (dot11 * dot02 - dot01 * dot12) * invDenom;
  const v = (dot00 * dot12 - dot01 * dot02) * invDenom;
  
  return (u >= 0) && (v >= 0) && (u + v <= 1);
}

/**
 * Convert geographic coordinate to Cartesian coordinate
 */
function geoToCartesian(coord: GeoCoordinate): [number, number, number] {
  const { latitude, longitude } = coord;
  const latRad = (latitude * Math.PI) / 180;
  const lonRad = (longitude * Math.PI) / 180;
  
  const x = Math.cos(latRad) * Math.cos(lonRad);
  const y = Math.cos(latRad) * Math.sin(lonRad);
  const z = Math.sin(latRad);
  
  return [x, y, z];
}

/**
 * Calculate dot product of two vectors
 */
function dotProduct(a: number[], b: number[]): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

'use client';

import { useEffect } from 'react';
import useTriangleMeshStore from '../store/triangleMeshStore';
import { GeoCoordinate, MeshStats, TriangleFace } from '../types/geometry';

/**
 * Custom hook for interacting with the triangle mesh
 * Wraps the store functionality and provides helper functions
 */
const useTriangleMesh = () => {
  const {
    mesh,
    loading,
    error,
    selectedFaceId,
    initializeMesh,
    clickTriangle,
    selectFace,
    resetMesh,
  } = useTriangleMeshStore();

  // Initialize the mesh when the hook is first used
  useEffect(() => {
    if (!mesh && !loading) {
      initializeMesh();
    }
  }, [mesh, loading, initializeMesh]);

  // Get the currently selected face
  const selectedFace = selectedFaceId && mesh 
    ? mesh.faces.find(face => face.id === selectedFaceId) 
    : null;

  // Get faces by level
  const getFacesByLevel = (level: number): TriangleFace[] => {
    if (!mesh) return [];
    return mesh.faces.filter(face => face.level === level);
  };

  // Get child faces of a parent face
  const getChildFaces = (parentFaceId: string): TriangleFace[] => {
    if (!mesh) return [];
    return mesh.faces.filter(face => face.parentFaceId === parentFaceId);
  };

  // Check if a face can be subdivided
  const canSubdivide = (faceId: string): boolean => {
    if (!mesh) return false;
    const face = mesh.faces.find(f => f.id === faceId);
    return face ? face.clickCount >= 10 && face.level < 19 : false;
  };

  // Get faces that are ready for subdivision
  const getSubdividableFaces = (): TriangleFace[] => {
    if (!mesh) return [];
    return mesh.faces.filter(face => face.clickCount >= 10 && face.level < 19);
  };

  // Get statistics about the mesh
  const getMeshStats = (): MeshStats | null => {
    if (!mesh) return null;
    
    // Get the maximum level in the mesh
    const levels = mesh.faces.map(face => face.level);
    const maxLevel = levels.length > 0 ? Math.max(...levels) : 0;
    
    return {
      totalVertices: mesh.vertices.length,
      totalFaces: mesh.faces.length,
      maxLevel,
      totalClicks: mesh.faces.reduce((sum, face) => sum + face.clickCount, 0),
      subdivisionsByLevel: Array.from(
        new Set(mesh.faces.map(face =>

