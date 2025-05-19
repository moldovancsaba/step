'use client';

import React, { useState, useCallback, useMemo } from 'react';
import { 
  TriangleFace, 
  TriangleMesh,
  calculateSphericalTriangleArea,
  incrementClickCount,
  getColorForClickCount,
} from '@/app/types/geometry';
import { 
  ScreenCoordinate, 
  ViewportConfig, 
  equirectangularProjection,
  isGeoCoordinateVisible
} from '@/app/lib/projection';
import { 
  greatCircleArcPathData, 
  sphericalTrianglePathData,
  GeoCoordinate
} from '@/app/lib/sphericalMath';

interface TriangleProps {
  face: TriangleFace;
  mesh: TriangleMesh;
  viewport: ViewportConfig;
  isSelected?: boolean;
  canSubdivide?: boolean;
  onTriangleClick?: (faceId: string, event?: React.MouseEvent) => void;
  onTriangleHover?: (faceId: string | null) => void;
  onSubdivide?: (faceId: string) => void;
  arcDetail?: number; // Number of points per edge for curved arcs
  projectToScreen?: (coord: GeoCoordinate) => { x: number, y: number }; // Function to project geo coordinates to screen coordinates
}

/**
 * Triangle component for spherical triangle visualization
 * Renders a geographic triangle with curved edges using SVG paths
 */
const Triangle: React.FC<TriangleProps> = ({
  face,
  mesh,
  viewport,
  isSelected = false,
  canSubdivide = face.clickCount >= 10,
  onTriangleClick,
  onTriangleHover,
  onSubdivide,
  arcDetail = 10, // Default number of points per curved edge
  projectToScreen  // Function to project geo coordinates to screen coordinates
}) => {
  const [isHovered, setIsHovered] = useState(false);
  
  // Create a projection function using the provided viewport
  const projectionFn = useCallback(
    (geo: { latitude: number; longitude: number }) => {
      // Use provided projectToScreen function if available, otherwise fall back to equirectangular projection
      return projectToScreen ? projectToScreen(geo) : equirectangularProjection(geo, viewport);
    },
    [viewport, projectToScreen]
  );
  
  // Check if triangle is visible in current view (performance optimization)
  const isVisible = useMemo(() => {
    try {
      console.group(`Triangle Visibility Check - Face ID: ${face.id}`);
      
      // Safely get vertices and check if any are valid and visible
      const vertices = face.vertices.map(index => {
        if (index >= 0 && index < mesh.vertices.length) {
          return mesh.vertices[index];
        }
        return null;
      }).filter((vertex): vertex is GeoCoordinate => vertex !== null);
      
      // Check if we have any valid vertices to work with
      if (vertices.length === 0) {
        console.error(`No valid vertices found for face ${face.id}`);
        console.groupEnd();
        return false;
      }

      // Check if we have all three vertices for a proper triangle
      if (vertices.length !== 3) {
        console.error(`Invalid number of vertices (${vertices.length}) for face ${face.id}`);
        console.groupEnd();
        return false;
      }
      
      // Normalize coordinates for safer visibility checks
      const normalizedVertices = vertices.map(vertex => ({
        latitude: vertex.latitude,
        // Ensure longitude is in the range -180 to 180
        longitude: ((vertex.longitude + 540) % 360) - 180
      }));
      
      // Ensure viewport bounds are available
      const viewportWithBounds = viewport.minLatitude !== undefined 
        ? viewport 
        : { 
            ...viewport, 
            minLatitude: viewport.center.latitude - 90 / Math.pow(2, viewport.zoom),
            maxLatitude: viewport.center.latitude + 90 / Math.pow(2, viewport.zoom),
            minLongitude: viewport.center.longitude - 180 / Math.pow(2, viewport.zoom),
            maxLongitude: viewport.center.longitude + 180 / Math.pow(2, viewport.zoom)
          };
      
      // Log detailed information about each vertex
      normalizedVertices.forEach((vertex, idx) => {
        const isVertexVisible = isGeoCoordinateVisible(vertex, viewportWithBounds);
        console.log(
          `Vertex ${idx}: (lat: ${vertex.latitude.toFixed(6)}, lng: ${vertex.longitude.toFixed(6)}) - ` +
          `Visible: ${isVertexVisible}, ` +
          `ViewportBounds: lat [${viewportWithBounds.minLatitude!.toFixed(2)},${viewportWithBounds.maxLatitude!.toFixed(2)}], ` +
          `lng [${viewportWithBounds.minLongitude!.toFixed(2)},${viewportWithBounds.maxLongitude!.toFixed(2)}]`
        );
      });
      
      // Check edge case: triangle might cross the date line (longitude ±180°)
      const lngs = normalizedVertices.map(v => v.longitude);
      const crossesDateLine = Math.max(...lngs) - Math.min(...lngs) > 180;
      
      if (crossesDateLine) {
        console.log(`Triangle crosses the date line - forcing visibility to true for proper rendering`);
        console.groupEnd();
        return true;
      }
      
      // Check if any vertex is visible directly
      const anyVertexVisible = normalizedVertices.some(vertex => 
        isGeoCoordinateVisible(vertex, viewportWithBounds)
      );
      
      // Check if triangle might be partially visible even when all vertices are outside viewport
      // This happens when a large triangle spans across the viewport
      const potentiallyVisible = (() => {
        // Check if the latitude range of the triangle overlaps the viewport's latitude range
        const minLat = Math.min(...normalizedVertices.map(v => v.latitude));
        const maxLat = Math.max(...normalizedVertices.map(v => v.latitude));
        const latOverlap = !(maxLat < viewportWithBounds.minLatitude! || minLat > viewportWithBounds.maxLatitude!);
        
        // Check if the longitude range of the triangle overlaps the viewport's longitude range
        const minLng = Math.min(...normalizedVertices.map(v => v.longitude));
        const maxLng = Math.max(...normalizedVertices.map(v => v.longitude));
        
        // Special handling when the viewport crosses the date line
        const viewportCrossesDateLine = viewportWithBounds.minLongitude! > viewportWithBounds.maxLongitude!;
        
        let lngOverlap = false;
        if (viewportCrossesDateLine) {
          // When viewport crosses date line, check if longitude range is either:
          // - Greater than minLongitude (east of date line)
          // - Less than maxLongitude (west of date line)
          lngOverlap = (minLng >= viewportWithBounds.minLongitude! || maxLng <= viewportWithBounds.maxLongitude!);
        } else {
          // Normal case: check if longitude ranges overlap
          lngOverlap = !(maxLng < viewportWithBounds.minLongitude! || minLng > viewportWithBounds.maxLongitude!);
        }
        
        // Triangle potentially visible if there's overlap in both dimensions
        return latOverlap && lngOverlap;
      })();
      
      // Check if great circle paths between vertices are visible
      // This handles cases where the triangle curves through the viewport
      const edgesVisible = (() => {
        // Only do this check if the triangle is large enough to warrant it
        // and if the triangle is not already determined to be visible
        if (anyVertexVisible || potentiallyVisible) return false;
        
        // Calculate a few sample points along each edge to check if any are visible
        const [a, b, c] = normalizedVertices;
        const samplePoints = [
          { latitude: (a.latitude + b.latitude) / 2, longitude: (a.longitude + b.longitude) / 2 },
          { latitude: (b.latitude + c.latitude) / 2, longitude: (b.longitude + c.longitude) / 2 },
          { latitude: (c.latitude + a.latitude) / 2, longitude: (c.longitude + a.longitude) / 2 },
        ];
        
        return samplePoints.some(point => isGeoCoordinateVisible(point, viewportWithBounds));
      })();
      
      const isTriangleVisible = anyVertexVisible || potentiallyVisible || edgesVisible;
      
      console.log(
        `Triangle visibility result: ${isTriangleVisible}, ` +
        `Any vertex visible: ${anyVertexVisible}, ` +
        `Potentially visible (spans viewport): ${potentiallyVisible}, ` +
        `Edges visible: ${edgesVisible}`
      );
      
      console.groupEnd();
      return isTriangleVisible;
    } catch (error) {
      console.error(`Error determining visibility for face ${face.id}:`, error);
      console.groupEnd();
      return true; // Default to visible in case of error
    }
  }, [face, mesh, viewport]);
  
  // Get the geographic coordinates for the triangle vertices
  const geoCoordinates = useMemo(() => {
    // Make sure all vertex indices are valid
    return face.vertices.map(index => {
      if (index < 0 || index >= mesh.vertices.length) {
        console.error(`Invalid vertex index ${index} for face ${face.id}`);
        // Return a default coordinate to prevent runtime errors
        return { latitude: 0, longitude: 0 };
      }
      return mesh.vertices[index];
    });
  }, [face, mesh]);
  
  // Convert to screen coordinates
  const screenCoordinates = useMemo(() => {
    if (!isVisible) return [{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }];
    
    // Make sure all coordinates are valid before projection
    return geoCoordinates.map(geo => {
      if (!geo || typeof geo.latitude !== 'number' || typeof geo.longitude !== 'number') {
        console.error('Invalid geographic coordinate:', geo);
        return { x: 0, y: 0 };
      }
      return projectionFn(geo);
    });
  }, [geoCoordinates, projectionFn, isVisible]);
  
  // Generate SVG path data for the triangle with curved edges
  const pathData = useMemo(() => {
    if (!isVisible) return '';
    
    // Validate that we have exactly 3 coordinates before proceeding
    if (geoCoordinates.length !== 3 || !geoCoordinates[0] || !geoCoordinates[1] || !geoCoordinates[2]) {
      console.error('Invalid triangle vertices:', geoCoordinates);
      return '';
    }
    
    // Create a properly typed tuple of GeoCoordinates
    const vertices: [GeoCoordinate, GeoCoordinate, GeoCoordinate] = [
      geoCoordinates[0],
      geoCoordinates[1],
      geoCoordinates[2]
    ];
    
    try {
      // Check for date line crossing
      const lngValues = vertices.map(v => v.longitude);
      const crossesDateLine = Math.max(...lngValues) - Math.min(...lngValues) > 180;
      
      // Use sphericalTrianglePathData for curved edges with proper handling of date line crossing
      return sphericalTrianglePathData(
        vertices,
        projectionFn,
        arcDetail, // Use the provided arcDetail parameter for edge smoothness
        crossesDateLine // Pass date line crossing information
      );
    } catch (error) {
      console.error('Error generating triangle path data:', error);
      
      // Fallback to simple straight line path in case of error
      return `M ${screenCoordinates[0].x},${screenCoordinates[0].y} L ${screenCoordinates[1].x},${screenCoordinates[1].y} L ${screenCoordinates[2].x},${screenCoordinates[2].y} Z`;
    }
  }, [geoCoordinates, screenCoordinates, projectionFn, isVisible, arcDetail]);
  
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
      // Always pass both faceId and event
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
  const isMaxLevel = face.level >= 19; // Maximum allowed subdivision level
  
  // Calculate the centroid of the triangle
  const centroid = useMemo(() => {
    if (!isVisible) return { latitude: 0, longitude: 0 };
    
    // Calculate centroid of the triangle
    const [a, b, c] = face.vertices;
    const vA = mesh.vertices[a];
    const vB = mesh.vertices[b];
    const vC = mesh.vertices[c];
    
    return {
      latitude: (vA.latitude + vB.latitude + vC.latitude) / 3,
      longitude: (vA.longitude + vB.longitude + vC.longitude) / 3
    };
  }, [face, mesh, isVisible]);
  
  // Calculate the centroid screen coordinates
  const centroidScreen = useMemo(() => {
    if (!isVisible) return { x: 0, y: 0 };
    return projectionFn(centroid);
  }, [centroid, projectionFn, isVisible]);
  
  // Determine visual styles based on state
  const fillColor = face.color;
  // Enhanced visibility with adaptive colors based on level and interaction state
  const strokeColor = isSelected ? '#ff0000' : isHovered ? '#ffffff' : 
                     (face.level < 2 ? '#000000' : '#101010');
  
  // Adjust stroke width based on level (thicker for base triangles, thinner for subdivided ones)
  const baseStrokeWidth = Math.max(3, 6 - face.level * 0.5);
  const strokeWidth = isSelected ? baseStrokeWidth + 4 : 
                     isHovered ? baseStrokeWidth + 2 : 
                     baseStrokeWidth;
                     
  // Always full opacity for maximum visibility
  const opacity = 1;
  
  // Z-index strategy: 
  // - Base layer from 1000
  // - Each level adds 20 to ensure proper separation
  // - Selected faces get +100 to appear above others at same level
  // - Hover state adds +50
  const baseZIndex = 1000 + (face.level * 20);
  const selectionBoost = isSelected ? 100 : 0;
  const hoverBoost = isHovered ? 50 : 0;
  const layerZIndex = baseZIndex + selectionBoost + hoverBoost;
  
  // If triangle is not visible, don't render it (performance optimization)
  if (!isVisible) return null;
  
  return (
    <g 
      className="triangle-component"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onClick={handleClick}
      style={{ 
        cursor: 'pointer',
        zIndex: layerZIndex,
        position: 'relative',
        pointerEvents: 'auto',
        isolation: 'isolate', // Create stacking context for proper layering
        transformStyle: 'preserve-3d', // Help with 3D appearance
        willChange: 'transform' // Optimize rendering performance
      }}
    >
      {/* Main triangle with curved edges */}
      {/* Double-stroke effect for better contrast - first create wider black outline */}
      <path
        d={pathData}
        fill="none"
        stroke="#000000"
        strokeWidth={strokeWidth + 4}
        opacity={opacity}
        style={{
          zIndex: layerZIndex - 2,
          pointerEvents: 'none'
        }}
      />
      
      {/* White middle layer for bright outline effect */}
      <path
        d={pathData}
        fill="none"
        stroke="#ffffff"
        strokeWidth={strokeWidth + 2}
        opacity={opacity}
        style={{
          zIndex: layerZIndex - 1,
          pointerEvents: 'none'
        }}
      />
      
      {/* Main colored triangle */}
      <path
        d={pathData}
        fill={fillColor}
        stroke={strokeColor}
        strokeWidth={strokeWidth}
        opacity={opacity}
        className="transition-all duration-200"
        style={{
          zIndex: layerZIndex,
          filter: 'drop-shadow(0px 0px 3px rgba(0,0,0,0.5))',
          strokeLinejoin: 'round', // Smoother corners
          strokeLinecap: 'round', // Smoother line endings
          vectorEffect: 'non-scaling-stroke' // Maintain stroke width when scaling
        }}
      />
      
      {/* Show subdivision indicator when ready */}
      {canSubdivide && !isMaxLevel && (
        <g onClick={handleSubdivide} className="cursor-pointer">
          {/* Calculate centroid for indicator placement */}
          {/* Enhanced subdivision indicator with outline for visibility */}
          <circle
            cx={centroidScreen.x}
            cy={centroidScreen.y}
            r={isHovered ? 12 : 10}
            fill={isHovered ? "#ff0000" : "#ff8c00"}
            stroke="#ffffff"
            strokeWidth={3}
            strokeDasharray={isHovered ? "" : "1,1"}
            className="transition-all duration-200"
            style={{
              zIndex: layerZIndex + 10,
              filter: 'drop-shadow(0px 0px 5px rgba(0,0,0,0.7))'
            }}
          />
        </g>
      )}
      
      {/* Information popup on hover or selection */}
      {(isHovered || isSelected) && (
        <g className="triangle-info">
          {/* Calculate centroid for label placement */}
          <foreignObject
            x={centroidScreen.x - 60}
            y={centroidScreen.y - 40}
            width={120}
            height={80}
          >
            <div className="bg-black bg-opacity-90 text-white p-2 rounded text-xs font-bold" style={{ 
              zIndex: layerZIndex + 200, // Much higher z-index to ensure visibility
              border: `2px solid ${isSelected ? '#ff0000' : 'white'}`,
              boxShadow: `0 0 10px ${isSelected ? 'rgba(255,0,0,0.8)' : 'rgba(0,0,0,0.8)'}`,
              pointerEvents: 'none' // Prevent the info box from blocking interactions
            }}>
              <div className="font-bold">{getStatusText()}</div>
              <div>Level: {face.level}</div>
              <div>Clicks: {face.clickCount}/10</div>
              <div>Area: {formattedArea}</div>
            </div>
          </foreignObject>
        </g>
      )}
    </g>
  );
};

export default Triangle;
