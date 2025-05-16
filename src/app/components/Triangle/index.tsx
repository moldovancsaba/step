'use client';

import React, { useState, useCallback, useMemo } from 'react';
import { 
  TriangleFace, 
  TriangleMesh, 
  MapProjection, 
  triangleToScreen, 
  isPointInTriangle, 
  ScreenCoordinate,
  calculateSphericalTriangleArea,
  incrementClickCount,
  getColorForClickCount,
  isTriangleVisible,
  OSM_CONSTANTS,
  geoToOsmTile
} from '@/app/types/geometry';

interface TriangleProps {
  face: TriangleFace;
  mesh: TriangleMesh;
  projection: MapProjection;
  isSelected?: boolean;
  canSubdivide?: boolean;
  onTriangleClick?: (faceId: string, event: React.MouseEvent) => void;
  onTriangleHover?: (faceId: string | null) => void;
  onSubdivide?: (faceId: string) => void;
}

/**
 * Triangle component for OpenStreetMap overlay
 * Renders a geographic triangle with interactive features
 */
const Triangle: React.FC<TriangleProps> = ({
  face,
  mesh,
  projection,
  isSelected = false,
  canSubdivide = face.clickCount >= 10,
  onTriangleClick,
  onTriangleHover,
  onSubdivide,
}) => {
  const [isHovered, setIsHovered] = useState(false);
  
  // Check if triangle is visible in current view (performance optimization)
  const isVisible = useMemo(() => {
    return isTriangleVisible(face, mesh, projection);
  }, [face, mesh, projection]);
  
  // Convert triangle vertices to screen coordinates
  const screenCoordinates = useMemo(() => {
    // Only calculate if triangle is visible
    if (!isVisible) return [{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }];
    return triangleToScreen(face, mesh, projection);
  }, [face, mesh, projection, isVisible]);
  
  // Create SVG points string from screen coordinates
  const pointsString = useMemo(() => {
    return screenCoordinates
      .map(coord => `${coord.x},${coord.y}`)
      .join(' ');
  }, [screenCoordinates]);
  
  // Calculate triangle area (in square kilometers)
  const area = useMemo(() => {
    const [a, b, c] = face.vertices;
    // Skip calculation if triangle is not visible
    if (!isVisible) return 0;
    
    const vA = mesh.vertices[a];
    const vB = mesh.vertices[b];
    const vC = mesh.vertices[c];
    
    return calculateSphericalTriangleArea([vA, vB, vC]);
  }, [face, mesh, isVisible]);
  
  // Format area for display (show in km² or m² based on size)
  const formattedArea = useMemo(() => {
    if (area < 1) {
      return `${Math.round(area * 1000000)} m²`;
    }
    return `${area.toFixed(2)} km²`;
  }, [area]);
  
  // Handle mouse events
  const handleMouseEnter = useCallback(() => {
    setIsHovered(true);
    if (onTriangleHover) {
      onTriangleHover(face.id);
    }
  }, [face.id, onTriangleHover]);
  
  const handleMouseLeave = useCallback(() => {
    setIsHovered(false);
    if (onTriangleHover) {
      onTriangleHover(null);
    }
  }, [onTriangleHover]);
  
  const handleClick = useCallback((event: React.MouseEvent) => {
    if (onTriangleClick) {
      onTriangleClick(face.id, event);
    }
  }, [face.id, onTriangleClick]);
  
  const handleSubdivide = useCallback((event: React.MouseEvent) => {
    event.stopPropagation();
    if (onSubdivide && canSubdivide) {
      onSubdivide(face.id);
    }
  }, [face.id, onSubdivide, canSubdivide]);
  
  // Function to get status text
  const getStatusText = useCallback(() => {
    if (face.level >= 19 && face.clickCount >= 11) return 'Max level reached';
    if (face.clickCount >= 10) return 'Ready to subdivide';
    if (face.clickCount === 0) return 'New';
    return `${face.clickCount * 10}% complete`;
  }, [face.level, face.clickCount]);
  
  // Check if this triangle is at max level
  const isMaxLevel = face.level >= OSM_CONSTANTS.MAX_ZOOM;
  
  // Get OSM tile information for debugging/info
  const osmTileInfo = useMemo(() => {
    if (!isVisible) return null;
    
    // Use centroid of triangle for tile calculation
    const [a, b, c] = face.vertices;
    const vA = mesh.vertices[a];
    const vB = mesh.vertices[b];
    const vC = mesh.vertices[c];
    
    // Calculate centroid coordinate
    const centroidLat = (vA.latitude + vB.latitude + vC.latitude) / 3;
    const centroidLng = (vA.longitude + vB.longitude + vC.longitude) / 3;
    
    return geoToOsmTile({ latitude: centroidLat, longitude: centroidLng }, projection.zoom);
  }, [face, mesh, projection.zoom, isVisible]);
  
  // Determine visual styles based on state
  const fillColor = face.color;
  const strokeColor = isSelected ? '#ff4500' : isHovered ? '#666' : '#333';
  const strokeWidth = isSelected ? 3 : isHovered ? 2 : 1;
  const opacity = isHovered ? 0.9 : 1;
  
  // If triangle is not visible, don't render it (performance optimization)
  if (!isVisible) return null;
  
  return (
    <g 
      className="triangle-component"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onClick={handleClick}
      style={{ cursor: 'pointer' }}
    >
      {/* Main triangle polygon */}
      <polygon
        points={pointsString}
        fill={fillColor}
        stroke={strokeColor}
        strokeWidth={strokeWidth}
        opacity={opacity}
        className="transition-all duration-300"
      />
      
      {/* Show subdivision indicator when ready */}
      {canSubdivide && !isMaxLevel && (
        <g onClick={handleSubdivide} className="cursor-pointer">
          {/* Calculate centroid for indicator placement */}
          <circle
            cx={(screenCoordinates[0].x + screenCoordinates[1].x + screenCoordinates[2].x) / 3}
            cy={(screenCoordinates[0].y + screenCoordinates[1].y + screenCoordinates[2].y) / 3}
            r={isHovered ? 8 : 6}
            fill={isHovered ? "#ff4500" : "#ff8c00"}
            className="transition-all duration-200"
          />
        </g>
      )}
      
      {/* Information popup on hover or selection */}
      {(isHovered || isSelected) && (
        <g className="triangle-info">
          {/* Calculate centroid for label placement */}
          <foreignObject
            x={(screenCoordinates[0].x + screenCoordinates[1].x + screenCoordinates[2].x) / 3 - 60}
            y={(screenCoordinates[0].y + screenCoordinates[1].y + screenCoordinates[2].y) / 3 - 40}
            width={120}
            height={80}
          >
            <div className="bg-black bg-opacity-75 text-white p-2 rounded text-xs">
              <div className="font-bold">{getStatusText()}</div>
              <div>Level: {face.level}</div>
              <div>Clicks: {face.clickCount}/10</div>
              <div>Area: {formattedArea}</div>
              {osmTileInfo && (
                <div className="mt-1 border-t border-gray-500 pt-1">
                  <div>OSM Tile: {osmTileInfo.x},{osmTileInfo.y}</div>
                  <div>Zoom: {osmTileInfo.z}</div>
                </div>
              )}
            </div>
          </foreignObject>
        </g>
      )}
    </g>
  );
};

export default Triangle;
