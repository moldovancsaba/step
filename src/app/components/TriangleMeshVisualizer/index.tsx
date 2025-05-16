'use client';

import React, { useEffect, useRef, useState } from 'react';
import { GeoCoordinate, TriangleFace, TriangleMesh } from '@/app/types/geometry';
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
  const mapRef = useRef<HTMLDivElement>(null);
  const [mapDimensions, setMapDimensions] = useState({ width: 0, height: 0 });
  
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
        setMapDimensions({
          width: mapRef.current.clientWidth,
          height: mapRef.current.clientHeight,
        });
      }
    };
    
    updateDimensions();
    window.addEventListener('resize', updateDimensions);
    
    return () => {
      window.removeEventListener('resize', updateDimensions);
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
  
  // Project geographic coordinates to screen coordinates
  const projectToScreen = (coord: GeoCoordinate): { x: number, y: number } => {
    // Simple Web Mercator-like projection
    // For a real implementation, use a proper mapping library's projection
    
    // Adjust for zoom and center
    const zoomFactor = Math.pow(2, mapControl.zoom);
    
    // Convert to 0-1 range (longitude: -180 to 180, latitude: 90 to -90)
    const x = (coord.longitude + 180) / 360;
    // Adjust latitude projection to avoid distortion at poles
    const latRad = (coord.latitude * Math.PI) / 180;
    const y = (1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2;
    
    // Apply zoom and center offset
    const centerX = (mapControl.center.longitude + 180) / 360;
    const centerLatRad = (mapControl.center.latitude * Math.PI) / 180;
    const centerY = (1 - Math.log(Math.tan(centerLatRad) + 1 / Math.cos(centerLatRad)) / Math.PI) / 2;
    
    // Calculate final screen coordinates
    const screenX = ((x - centerX) * zoomFactor + 0.5) * mapDimensions.width;
    const screenY = ((y - centerY) * zoomFactor + 0.5) * mapDimensions.height;
    
    return { x: screenX, y: screenY };
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
        
        <div className="ml-auto">
          <span className="text-sm">
            Showing {displayedFaces.length} of {mesh.faces.length} triangles
          </span>
        </div>
      </div>
      
      {/* Map visualization */}
      <div 
        ref={mapRef} 
        className="relative border rounded-lg overflow-hidden bg-blue-50 h-[600px] w-full"
        onClick={handleMapClick}
      >
        {/* Mock map background */}
        <div className="absolute inset-0 grid"
          style={{
            backgroundImage: "url('https://a.tile.openstreetmap.org/2/2/1.png')",
            backgroundSize: 'cover',
            backgroundPosition: 'center',
            opacity: 0.7
          }}
        >
          {/* This would be replaced by an actual OpenStreetMap implementation */}
          <div className="text-center text-gray-400 self-center">
            (OpenStreetMap would display here)
          </div>
        </div>
        
        {/* Triangle overlay */}
        <div className="absolute inset-0 pointer-events-none">
          {displayedFaces.map(face => (
            <div 
              key={face.id}
              className="absolute pointer-events-auto"
              style={{
                // Position is handled by absolute positioning with transformed coordinates
                left: 0,
                top: 0,
                width: '100px',
                height: '100px',
                transform: 'translate(-50px, -50px)',
              }}
            >
              <Triangle
                face={face}
                mesh={mesh}
                projection={{
                  zoom: mapControl.zoom,
                  center: mapControl.center,
                  width: mapDimensions.width,
                  height: mapDimensions.height,
                  rotation: mapControl.bearing
                }}
                isSelected={face.id === selectedFaceId}
                canSubdivide={face.clickCount >= 10 && face.level < 19}
                onTriangleClick={onFaceClick}
                onTriangleHover={onFaceHover}
                onSubdivide={onFaceSubdivide}
              />
            </div>
          ))}
        </div>
        
        {/* Map attribution */}
        <div className="absolute bottom-0 right-0 text-xs bg-white bg-opacity-70 p-1">
          © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors
        </div>
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

