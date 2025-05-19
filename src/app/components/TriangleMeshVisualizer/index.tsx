'use client';

import React, { useEffect, useRef, useState } from 'react';
import { GeoCoordinate, TriangleFace, TriangleMesh } from '@/app/types/geometry';
import { ViewportConfig, equirectangularProjection, ScreenCoordinate } from '@/app/lib/projection';
import Triangle from '../Triangle';

interface TriangleMeshVisualizerProps {
  mesh: TriangleMesh;
  selectedFaceId: string | null;
  onFaceClick: (faceId: string) => void;
  onFaceSelect: (faceId: string | null) => void;
  onFaceHover?: (faceId: string | null) => void;
  onFaceSubdivide?: (faceId: string) => void;
}

// Mock map control - for actual implementation, use a map library like Leaflet or Mapbox
interface MapControl {
  zoom: number;
  center: GeoCoordinate;
  bearing: number;
}

/**
 * TriangleMeshVisualizer component - Displays the triangle mesh overlay on a map
 * This is a simplified 2D visualization - for production, use an actual map library like Leaflet
 */
const TriangleMeshVisualizer: React.FC<TriangleMeshVisualizerProps> = ({
  mesh,
  selectedFaceId,
  onFaceClick,
  onFaceSelect,
  onFaceHover,
  onFaceSubdivide,
}) => {
  const [filterLevel, setFilterLevel] = useState<number | null>(null);
  const [viewMode, setViewMode] = useState<'all' | 'level' | 'selected'>('all');
  const [showDebugGrid, setShowDebugGrid] = useState(true); // Debug grid toggle
  const mapRef = useRef<HTMLDivElement>(null);
  // Initialize with reasonable default dimensions to avoid 0-width/height issues
  const [mapDimensions, setMapDimensions] = useState({ width: 800, height: 600 });
  
  // Map control state
  const [mapControl, setMapControl] = useState<MapControl>({
    zoom: 2,
    center: { latitude: 0, longitude: 0 },
    bearing: 0,
  });
  
  // Get map dimensions on mount and resize
  useEffect(() => {
    const updateDimensions = () => {
      if (mapRef.current) {
        const newWidth = mapRef.current.clientWidth;
        const newHeight = mapRef.current.clientHeight;
        
        setMapDimensions({
          width: newWidth,
          height: newHeight,
        });
        
        // Debug log when dimensions change
        console.log('Map dimensions updated:', { width: newWidth, height: newHeight });
      }
    };
    
    // Run immediately to set dimensions on mount
    updateDimensions();
    
    // Add resize observer for more reliable dimension tracking
    let resizeObserver: ResizeObserver;
    if (mapRef.current && typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(updateDimensions);
      resizeObserver.observe(mapRef.current);
    }
    
    // Also keep traditional resize event as fallback
    window.addEventListener('resize', updateDimensions);
    
    // Force an update after a short delay to ensure container has rendered
    const timerId = setTimeout(updateDimensions, 100);
    
    return () => {
      window.removeEventListener('resize', updateDimensions);
      if (resizeObserver) {
        resizeObserver.disconnect();
      }
      clearTimeout(timerId);
    };
  }, []);
  
  // Get unique levels in the mesh
  const levels = React.useMemo(() => {
    if (!mesh) return [];
    const levelSet = new Set(mesh.faces.map(face => face.level));
    return Array.from(levelSet).sort((a, b) => a - b);
  }, [mesh]);
  
  // Get faces to display based on filter
  const displayedFaces = React.useMemo(() => {
    if (!mesh) return [];
    
    if (viewMode === 'level' && filterLevel !== null) {
      // Filter by level
      return mesh.faces.filter(face => face.level === filterLevel);
    } else if (viewMode === 'selected' && selectedFaceId) {
      // Show selected face and its siblings (faces with same parent)
      const selectedFace = mesh.faces.find(f => f.id === selectedFaceId);
      if (!selectedFace) return []; 
      
      return mesh.faces.filter(face => 
        face.id === selectedFaceId || 
        face.parentFaceId === selectedFace.parentFaceId
      );
    } else {
      // Show all faces by default
      // For performance with large meshes, we could limit this to faces visible in the current view
      return mesh.faces;
    }
  }, [mesh, viewMode, filterLevel, selectedFaceId]);
  
  // Create a viewport configuration for the projection system
  const getViewportConfig = (): ViewportConfig => {
    return {
      width: mapDimensions.width,
      height: mapDimensions.height,
      center: mapControl.center,
      zoom: mapControl.zoom,
      rotation: mapControl.bearing
    };
  };
  
  // Project geographic coordinates to screen coordinates using the consolidated equirectangular projection
  const projectToScreen = (coord: GeoCoordinate): ScreenCoordinate => {
    // Create the viewport configuration
    const viewport = getViewportConfig();
    
    // Use the imported equirectangularProjection function
    const projectedCoords = equirectangularProjection(coord, viewport);
    
    // Add more comprehensive debugging for triangles
    // Log more frequently to help diagnose visibility issues
    if (Math.random() < 0.05) { // Log 5% of coordinates for better debugging
      console.log('Projected coordinate (TriangleMeshVisualizer):', { 
        geo: { lat: coord.latitude, lng: coord.longitude },
        screen: projectedCoords,
        viewport: { 
          width: viewport.width, 
          height: viewport.height,
          zoom: viewport.zoom,
          center: viewport.center
        }
      });
    }
    
    return projectedCoords;
  };
  
  // Handle map zoom change
  const handleZoomChange = (delta: number) => {
    setMapControl(prev => ({
      ...prev,
      zoom: Math.max(1, Math.min(20, prev.zoom + delta)),
    }));
  };
  
  // Handle map pan
  const handlePan = (deltaLat: number, deltaLng: number) => {
    setMapControl(prev => ({
      ...prev,
      center: {
        latitude: prev.center.latitude + deltaLat,
        longitude: prev.center.longitude + deltaLng,
      },
    }));
  };
  
  // Handle map click (for deselecting)
  const handleMapClick = (e: React.MouseEvent) => {
    // Only deselect if clicking directly on the map, not on a triangle
    if (e.currentTarget === e.target) {
      onFaceSelect(null);
    }
  };
  
  return (
    <div className="flex flex-col space-y-4">
      {/* Map controls */}
      <div className="flex flex-wrap gap-4 items-center bg-gray-100 p-2 rounded">
        <div>
          <label className="block text-sm mb-1">View Mode:</label>
          <select 
            className="border rounded px-2 py-1 text-sm"
            value={viewMode}
            onChange={(e) => setViewMode(e.target.value as any)}
          >
            <option value="all">All Triangles</option>
            <option value="level">By Level</option>
            <option value="selected">Selected & Siblings</option>
          </select>
        </div>
        
        {viewMode === 'level' && (
          <div>
            <label className="block text-sm mb-1">Level:</label>
            <select 
              className="border rounded px-2 py-1 text-sm"
              value={filterLevel === null ? '' : filterLevel}
              onChange={(e) => setFilterLevel(e.target.value ? Number(e.target.value) : null)}
            >
              <option value="">All Levels</option>
              {levels.map(level => (
                <option key={level} value={level}>Level {level}</option>
              ))}
            </select>
          </div>
        )}
        
        <div className="flex items-center gap-2">
          <button 
            className="px-2 py-1 bg-blue-500 text-white rounded text-sm"
            onClick={() => handleZoomChange(1)}
          >
            Zoom +
          </button>
          <button 
            className="px-2 py-1 bg-blue-500 text-white rounded text-sm"
            onClick={() => handleZoomChange(-1)}
          >
            Zoom -
          </button>
          <span className="text-sm">Zoom: {mapControl.zoom}</span>
        </div>
        
        <div className="grid grid-cols-3 gap-1">
          <button 
            className="p-1 bg-blue-500 text-white rounded text-sm"
            onClick={() => handlePan(5, 0)}
          >
            ↑
          </button>
          <button 
            className="p-1 bg-blue-500 text-white rounded text-sm"
            onClick={() => handlePan(0, 5)}
          >
            →
          </button>
          <button 
            className="p-1 bg-blue-500 text-white rounded text-sm"
            onClick={() => handlePan(-5, 0)}
          >
            ↓
          </button>
          <button 
            className="p-1 bg-blue-500 text-white rounded text-sm"
            onClick={() => handlePan(0, -5)}
          >
            ←
          </button>
        </div>
        
        <div className="ml-auto flex items-center gap-4">
          <div>
            <button 
              className={`px-2 py-1 text-sm rounded ${showDebugGrid ? 'bg-green-500 text-white' : 'bg-gray-200'}`}
              onClick={() => setShowDebugGrid(!showDebugGrid)}
            >
              {showDebugGrid ? 'Debug Grid: ON' : 'Debug Grid: OFF'}
            </button>
          </div>
          <span className="text-sm">
            Showing {displayedFaces.length} of {mesh.faces.length} triangles
          </span>
        </div>
      </div>
      
      {/* Map visualization */}
      <div 
        ref={mapRef} 
        className="relative border rounded-lg overflow-hidden bg-gray-900 h-[600px] w-full"
        onClick={handleMapClick}
      >
        
        {/* Triangle overlay - SVG container for triangle mesh visualization */}
        <svg 
          className="absolute inset-0 w-full h-full"
          viewBox={`0 0 ${mapDimensions.width || 800} ${mapDimensions.height || 600}`}
          preserveAspectRatio="xMidYMid meet"
          style={{
            zIndex: 10,
            overflow: 'visible', // Allow triangles to render beyond the SVG boundaries
            backgroundColor: 'transparent',
            width: '100%',
            height: '100%'
          }}
          data-testid="triangle-mesh-svg"
        >
          {/* Debug grid to verify positioning */}
          {showDebugGrid && mapDimensions.width > 0 && mapDimensions.height > 0 && (
            <g className="debug-grid" style={{ opacity: 0.6 }}>
              {/* Horizontal grid lines */}
              {Array.from({ length: 10 }).map((_, i) => (
                <line 
                  key={`h-${i}`}
                  x1="0" 
                  y1={mapDimensions.height * (i / 10)} 
                  x2={mapDimensions.width} 
                  y2={mapDimensions.height * (i / 10)}
                  stroke="#4c7ecf" 
                  strokeWidth="1.5" 
                  strokeDasharray="5,5"
                />
              ))}
              {/* Vertical grid lines */}
              {Array.from({ length: 10 }).map((_, i) => (
                <line 
                  key={`v-${i}`}
                  x1={mapDimensions.width * (i / 10)} 
                  y1="0" 
                  x2={mapDimensions.width * (i / 10)} 
                  y2={mapDimensions.height}
                  stroke="#4c7ecf" 
                  strokeWidth="1.5" 
                  strokeDasharray="5,5"
                />
              ))}
              
              {/* Add coordinate system axes for better orientation */}
              <line 
                x1="0" 
                y1={mapDimensions.height / 2} 
                x2={mapDimensions.width} 
                y2={mapDimensions.height / 2}
                stroke="#ff5252" 
                strokeWidth="2"
              />
              <line 
                x1={mapDimensions.width / 2} 
                y1="0" 
                x2={mapDimensions.width / 2} 
                y2={mapDimensions.height}
                stroke="#ff5252" 
                strokeWidth="2"
              />
              {/* Center crosshair */}
              <circle
                cx={mapDimensions.width / 2}
                cy={mapDimensions.height / 2}
                r="20"
                fill="none"
                stroke="#ff5252"
                strokeWidth="2"
              />
              {/* Coordinate system indicators */}
              <line
                x1={mapDimensions.width / 2}
                y1={mapDimensions.height / 2}
                x2={mapDimensions.width / 2 + 40}
                y2={mapDimensions.height / 2}
                stroke="#52ff52"
                strokeWidth="2"
                markerEnd="url(#arrowhead)"
              />
              <line
                x1={mapDimensions.width / 2}
                y1={mapDimensions.height / 2}
                x2={mapDimensions.width / 2}
                y2={mapDimensions.height / 2 - 40}
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
              <text
                x={mapDimensions.width / 2 + 50}
                y={mapDimensions.height / 2 - 5}
                fill="#fff"
                fontSize="12"
              >
                Longitude
              </text>
              <text
                x={mapDimensions.width / 2 + 5}
                y={mapDimensions.height / 2 - 45}
                fill="#fff"
                fontSize="12"
              >
                Latitude
              </text>
            </g>
          )}
          
          {/* Render all triangles in the displayedFaces array */}
          {displayedFaces.map((face) => (
            <Triangle
              key={face.id}
              face={face}
              mesh={mesh}
              viewport={getViewportConfig()}
              isSelected={face.id === selectedFaceId}
              canSubdivide={face.clickCount >= 10 && face.level < 19}
              onTriangleClick={onFaceClick}
              onTriangleHover={onFaceHover}
              onSubdivide={onFaceSubdivide}
              projectToScreen={projectToScreen}
            />
          ))}
        </svg>
        
        {/* Debug information */}
        {showDebugGrid && (
          <div className="absolute bottom-0 right-0 text-xs bg-black bg-opacity-70 text-white p-2 rounded-tl">
            <div>Displayed Triangles: {displayedFaces.length} of {mesh.faces.length}</div>
            <div>Viewport: {mapDimensions.width} x {mapDimensions.height}</div>
            <div>Center: {mapControl.center.latitude.toFixed(2)}°, {mapControl.center.longitude.toFixed(2)}°</div>
            <div>Zoom: {mapControl.zoom}</div>
          </div>
        )}
      </div>
      
      {/* Selected triangle info */}
      {selectedFaceId && (
        <div className="bg-blue-50 p-4 rounded">
          <h3 className="font-bold mb-2">Selected Triangle</h3>
          {(() => {
            const face = mesh.faces.find(f => f.id === selectedFaceId);
            if (!face) return <p>Triangle not found</p>;
            
            return (
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div>ID:</div>
                <div>{face.id}</div>
                <div>Level:</div>
                <div>{face.level}</div>
                <div>Click Count:</div>
                <div>{face.clickCount}/10</div>
                <div>Parent:</div>
                <div>{face.parentFaceId || 'None (Root Level)'}</div>
                <div>Vertices:</div>
                <div>{face.vertices.join(', ')}</div>
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
};

export default TriangleMeshVisualizer;

