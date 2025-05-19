'use client';

import React, { useMemo } from 'react';
import Link from 'next/link';
import { 
  TriangleFace, 
  TriangleMesh,
  createInitialMesh,
  getColorForClickCount,
  calculateMeshStats
} from '@/app/types/geometry';
import { ViewportConfig, equirectangularProjection } from '@/app/lib/projection';
import { sphericalTrianglePathData, GeoCoordinate } from '@/app/lib/sphericalMath';

/**
 * SimpleMeshView Component
 * 
 * A static visualization of a triangle mesh with:
 * - Fixed viewport dimensions (800x600)
 * - No interactive controls (pan, zoom)
 * - Great circle arc rendering for triangle edges
 * - Debug grid with orientation indicators
 * - Minimal UI with only a back button
 */
const SimpleMeshView: React.FC = () => {
  // Create a static viewport with fixed dimensions
  const viewport: ViewportConfig = useMemo(() => ({
    width: 800,
    height: 600,
    center: { latitude: 0, longitude: 0 },
    zoom: 1,
    rotation: 0
  }), []);

  // Initialize the triangle mesh using the createInitialMesh function
  const mesh: TriangleMesh = useMemo(() => {
    try {
      return createInitialMesh();
    } catch (error) {
      console.error('Failed to create initial mesh:', error);
      // Return a minimal valid mesh structure to prevent rendering errors
      return { vertices: [], faces: [] };
    }
  }, []);

  // Calculate mesh statistics for displaying vertex and face counts
  const stats = useMemo(() => {
    try {
      return calculateMeshStats(mesh);
    } catch (error) {
      console.error('Failed to calculate mesh stats:', error);
      return { totalVertices: 0, totalFaces: 0, maxLevel: 0, totalClicks: 0, subdivisionsByLevel: [] };
    }
  }, [mesh]);

  // Project geographic coordinates to screen coordinates using equirectangular projection
  const projectToScreen = (coord: GeoCoordinate) => {
    return equirectangularProjection(coord, viewport);
  };

  // Render each face in the mesh
  const renderFaces = () => {
    if (!mesh.faces || mesh.faces.length === 0) {
      return <text x="400" y="300" fill="red" textAnchor="middle">No mesh data available</text>;
    }

    return mesh.faces.map((face: TriangleFace) => {
      try {
        // Get the vertices for this face
        const vertices: [GeoCoordinate, GeoCoordinate, GeoCoordinate] = [
          mesh.vertices[face.vertices[0]],
          mesh.vertices[face.vertices[1]],
          mesh.vertices[face.vertices[2]]
        ];

        // Create SVG path for the triangle using great circle arcs
        const pathData = sphericalTrianglePathData(
          vertices,
          projectToScreen,
          10 // Number of points per edge for curved arcs
        );

        // Get color based on triangle's click count and level
        const fillColor = face.color || getColorForClickCount(face.clickCount, face.level);
        
        // Calculate a distinctive stroke color based on level
        // Higher contrast for better visibility
        const strokeColor = face.level === 0 ? '#ffffff' : '#000000';
        
        return (
          <path
            key={face.id}
            d={pathData}
            fill={fillColor}
            stroke={strokeColor}
            strokeWidth={2}
            opacity={0.9}
          />
        );
      } catch (error) {
        console.error(`Error rendering face ${face.id}:`, error);
        return null;
      }
    });
  };

  // Render debug grid with orientation indicators
  const renderDebugGrid = () => {
    return (
      <g className="debug-grid" style={{ opacity: 0.6 }}>
        {/* Horizontal grid lines */}
        {Array.from({ length: 10 }).map((_, i) => (
          <line 
            key={`h-${i}`}
            x1="0" 
            y1={viewport.height * (i / 10)} 
            x2={viewport.width} 
            y2={viewport.height * (i / 10)}
            stroke="#4c7ecf" 
            strokeWidth="1.5" 
            strokeDasharray="5,5"
          />
        ))}
        {/* Vertical grid lines */}
        {Array.from({ length: 10 }).map((_, i) => (
          <line 
            key={`v-${i}`}
            x1={viewport.width * (i / 10)} 
            y1="0" 
            x2={viewport.width * (i / 10)} 
            y2={viewport.height}
            stroke="#4c7ecf" 
            strokeWidth="1.5" 
            strokeDasharray="5,5"
          />
        ))}
        
        {/* Add coordinate system axes for better orientation */}
        <line 
          x1="0" 
          y1={viewport.height / 2} 
          x2={viewport.width} 
          y2={viewport.height / 2}
          stroke="#ff5252" 
          strokeWidth="2"
        />
        <line 
          x1={viewport.width / 2} 
          y1="0" 
          x2={viewport.width / 2} 
          y2={viewport.height}
          stroke="#ff5252" 
          strokeWidth="2"
        />
        
        {/* Center crosshair */}
        <circle
          cx={viewport.width / 2}
          cy={viewport.height / 2}
          r="20"
          fill="none"
          stroke="#ff5252"
          strokeWidth="2"
        />
        
        {/* Coordinate system indicators */}
        <line
          x1={viewport.width / 2}
          y1={viewport.height / 2}
          x2={viewport.width / 2 + 40}
          y2={viewport.height / 2}
          stroke="#52ff52"
          strokeWidth="2"
          markerEnd="url(#arrowhead)"
        />
        <line
          x1={viewport.width / 2}
          y1={viewport.height / 2}
          x2={viewport.width / 2}
          y2={viewport.height / 2 - 40}
          stroke="#ff5252"
          strokeWidth="2"
          markerEnd="url(#arrowhead)"
        />
        
        {/* SVG Definitions for markers */}
        <defs>
          <marker
            id="arrowhead"
            markerWidth="10"
            markerHeight="7"
            refX="10"
            refY="3.5"
            orient="auto"
          >
            <polygon points="0 0, 10 3.5, 0 7" fill="#fff" />
          </marker>
        </defs>
        
        {/* Label the axes */}
        <text
          x={viewport.width / 2 + 50}
          y={viewport.height / 2 - 5}
          fill="#fff"
          fontSize="12"
        >
          Longitude
        </text>
        <text
          x={viewport.width / 2 + 5}
          y={viewport.height / 2 - 45}
          fill="#fff"
          fontSize="12"
        >
          Latitude
        </text>
      </g>
    );
  };

  return (
    <div className="relative w-full h-full bg-gray-900 overflow-hidden">
      {/* Fixed size SVG container for the mesh visualization */}
      <svg 
        width={viewport.width}
        height={viewport.height}
        viewBox={`0 0 ${viewport.width} ${viewport.height}`}
        className="mx-auto border-2 border-gray-700 rounded"
        style={{ backgroundColor: '#0a192f' }} // Dark blue background for contrast
      >
        {/* Debug grid showing lat/long reference */}
        {renderDebugGrid()}
        
        {/* Triangle mesh faces */}
        <g className="triangle-mesh">
          {renderFaces()}
        </g>
      </svg>
      
      {/* Debug information */}
      <div className="absolute bottom-4 right-4 bg-black bg-opacity-70 text-white p-3 rounded text-sm">
        <div>Vertices: {stats.totalVertices}</div>
        <div>Faces: {stats.totalFaces}</div>
      </div>
      
      {/* Back button to main page */}
      <div className="absolute top-4 left-4">
        <Link
          href="/"
          className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
        >
          Back to Main Page
        </Link>
      </div>
    </div>
  );
};

export default SimpleMeshView;

'use client';

import React, { useEffect, useRef } from 'react';
import { useTriangleMesh } from '@/app/hooks/useTriangleMesh';
import TriangleMeshVisualizer from '../TriangleMeshVisualizer';
import Link from 'next/link';

/**
 * SimpleMeshView component
 * 
 * A minimal, non-interactive triangle mesh visualization with just the mesh display
 * and a back button to return to the main page.
 * 
 * This component:
 * - Initializes and displays the mesh
 * - Does not support interactions (selection, hover, clicks)
 * - Does not display debug information
 * - Only handles viewport resize
 */
const SimpleMeshView: React.FC = () => {
  // Container ref for calculating viewport dimensions
  const containerRef = useRef<HTMLDivElement>(null);

  // Use triangle mesh hook for state management
  const {
    mesh,
    initializeMesh,
    updateMapSize,
  } = useTriangleMesh();

  // Initialize mesh on component mount
  useEffect(() => {
    initializeMesh();
  }, [initializeMesh]);

  // Update viewport dimensions on resize
  useEffect(() => {
    const updateDimensions = () => {
      if (containerRef.current) {
        const { width, height } = containerRef.current.getBoundingClientRect();
        
        // Make sure we have non-zero dimensions
        if (width > 0 && height > 0) {
          updateMapSize(width, height);
        } else {
          // Retry after a short delay if dimensions are zero
          setTimeout(updateDimensions, 100);
        }
      }
    };
    
    // Initial update
    updateDimensions();
    
    // Add resize listener
    window.addEventListener('resize', updateDimensions);
    return () => window.removeEventListener('resize', updateDimensions);
  }, [updateMapSize]);

  /**
   * No-operation handler function
   * Used as a placeholder for required event handlers when no action is needed
   * 
   * @param faceId - The ID of the triangle face (unused in this component)
   * @returns void
   */
  const noopHandler = (_faceId: string) => {
    // No operation - used to satisfy the TriangleMeshVisualizer props
    // This prevents any interaction with the mesh
  };

  return (
    <div className="flex flex-col h-full w-full bg-gray-900">
      {/* Simple header with back button */}
      <div className="p-2 bg-slate-800 text-white sticky top-0 z-10">
        <Link 
          href="/"
          className="px-3 py-1 rounded bg-blue-600 hover:bg-blue-700 inline-block"
        >
          Back to Main Page
        </Link>
      </div>
      
      {/* Main visualization container */}
      <div 
        ref={containerRef} 
        className="flex-1 relative overflow-hidden bg-gray-800 w-full h-full min-h-[500px]"
      >
        {mesh ? (
          <TriangleMeshVisualizer
            mesh={mesh}
            selectedFaceId={null}
            onFaceClick={noopHandler}
            onFaceSelect={noopHandler}
            onFaceHover={noopHandler}
            onFaceSubdivide={noopHandler}
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="text-white text-center p-8 bg-black bg-opacity-50 rounded-lg">
              <h2 className="text-xl font-bold mb-4">Loading Triangle Mesh...</h2>
              <p>Initializing spherical geometry visualization</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default SimpleMeshView;

