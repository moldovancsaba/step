'use client';

import React, { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { Polygon, useMap } from 'react-leaflet';
import type { LatLngExpression, PathOptions } from 'leaflet';
import L from 'leaflet';
import { 
  GeoCoordinate, 
  TriangleFace, 
  TriangleMesh, 
  isTriangleVisible, 
  MapProjection,
  calculateMeshStats
} from '@/app/types/geometry';

interface TriangleMeshOverlayProps {
  mesh: TriangleMesh;
  onFaceClick?: (faceId: string) => void;
  onFaceHover?: (faceId: string | null) => void;
  pane?: string; // Custom Leaflet pane for layer ordering
  maxVisibleFaces?: number; // Maximum faces to render for performance
  renderingQuality?: 'low' | 'medium' | 'high'; // Performance quality setting
  debugMode?: boolean; // Enable additional console logs
}

// Extreme visibility styling with maximum contrast and thickness
const getPathOptions = (face: TriangleFace, renderingQuality: 'low' | 'medium' | 'high'): PathOptions => {
  // Much thicker lines for all triangles - increase based on level for better visibility
  const lineWeight = face.level === 0 ? 8 : (face.level <= 3 ? 6 : 4 + (face.level * 0.5));
  
  // Apply different styling based on rendering quality
  if (renderingQuality === 'low') {
    return {
      color: '#000000', // Black outline with high contrast inner red
      weight: lineWeight,
      fillColor: face.color,
      fillOpacity: 1.0, // Full opacity for maximum visibility
      opacity: 1.0, // Full opacity for borders
      interactive: true,
      className: 'triangle-mesh-polygon triangle-top-layer', // Added special class
      // Set absolute z-index extremely high
      zIndex: 9000 + face.level
    };
  }
  
  return {
    color: '#000000', // Black outline with high contrast inner red
    weight: lineWeight,
    fillColor: face.color,
    fillOpacity: 1.0, // Full opacity
    opacity: 1.0, // Full opacity for borders
    dashArray: undefined, // Solid lines only
    className: 'triangle-mesh-polygon triangle-top-layer', // Added special class
    bubblingMouseEvents: false,
    interactive: true,
    lineCap: 'round',
    lineJoin: 'round',
    // Set absolute z-index extremely high
    zIndex: 9000 + face.level
  };
}

// Memoized polygon component to drastically improve rendering performance
const MemoizedPolygon = React.memo(
  Polygon, 
  (prevProps, nextProps) => {
    // Only re-render if these specific props change
    return (
      prevProps.positions === nextProps.positions &&
      prevProps.pathOptions.fillColor === nextProps.pathOptions.fillColor &&
      prevProps.pathOptions.weight === nextProps.pathOptions.weight
    );
  }
);

const TriangleMeshOverlay: React.FC<TriangleMeshOverlayProps> = ({
  mesh,
  onFaceClick,
  onFaceHover,
  pane = 'triangleMeshPane', // Custom pane for better z-index control
  maxVisibleFaces = 1000,    // Reasonable default for most devices
  renderingQuality = 'medium', // Default quality setting
  debugMode = false          // Default to no extra logging
}) => {
  const map = useMap();
  const renderCount = useRef(0);
  
  // Track visible faces to optimize rendering
  const [visibleFaces, setVisibleFaces] = useState<TriangleFace[]>([]);
  const [renderError, setRenderError] = useState<string | null>(null);
  
  // Performance measurement
  const [renderTimes, setRenderTimes] = useState<number[]>([]);

  // Setup custom pane with proper z-index management
  useEffect(() => {
    try {
      // Create our custom pane if it doesn't exist
      if (!map.getPane(pane)) {
        if (debugMode) console.log(`Creating custom pane: ${pane}`);
        map.createPane(pane);
        const paneElement = map.getPane(pane)!;
        
        // Use EXTREMELY HIGH z-index to ensure triangles are always on top
        // 1000 is far above all standard Leaflet layers
        paneElement.style.zIndex = '9999';
        
        // Ensure pane can capture pointer events
        paneElement.style.pointerEvents = 'auto';
        
        // Force top positioning
        paneElement.style.position = 'relative';
        
        // Add specialized CSS for maximum visibility
        const style = document.createElement('style');
        style.textContent = `
          .leaflet-${pane}-pane .triangle-mesh-polygon {
            transition: all 0.1s ease-in-out;
            stroke-width: 5px !important;
            stroke: #000000 !important;
            fill-opacity: 1 !important;
            stroke-opacity: 1 !important;
            z-index: 9999 !important;
            pointer-events: auto !important;
          }
          
          .triangle-top-layer {
            position: relative !important;
            z-index: 9999 !important;
          }
          
          /* Ensure the pane is always on top */
          .leaflet-${pane}-pane {
            z-index: 9999 !important;
            position: relative !important;
            pointer-events: visible !important;
          }
        `;
        document.head.appendChild(style);
        
        return () => {
          document.head.removeChild(style);
        };
      }
      
      // Trigger a single redraw after pane creation
      const timeout = setTimeout(() => {
        map.invalidateSize();
      }, 100);
      
      return () => {
        clearTimeout(timeout);
      };
    } catch (error) {
      console.error('Error setting up custom pane:', error);
      setRenderError(`Pane setup error: ${error instanceof Error ? error.message : String(error)}`);
    }
  }, [map, pane, debugMode]);
  // Filter visible faces when the map viewport changes with performance optimizations
  const updateVisibleFaces = useCallback(() => {
    try {
      if (!map || !mesh.faces.length) return;
      
      const startTime = performance.now();
      
      // Create projection object for visibility checks
      const projection: MapProjection = {
        zoom: map.getZoom(),
        center: {
          latitude: map.getCenter().lat,
          longitude: map.getCenter().lng
        },
        width: map.getSize().x,
        height: map.getSize().y,
        bounds: {
          north: map.getBounds().getNorth(),
          south: map.getBounds().getSouth(),
          east: map.getBounds().getEast(),
          west: map.getBounds().getWest()
        }
      };
      
      // Optimize filtering with level-based selection for performance
      // Lower zoom levels prioritize higher-level (less-subdivided) triangles
      const zoomLevel = map.getZoom();
      let newVisibleFaces: TriangleFace[];
      
      if (zoomLevel < 5) {
        // At low zoom, only show level 0-3 triangles
        newVisibleFaces = mesh.faces
          .filter(face => face.level <= 3)
          .filter(face => isTriangleVisible(face, mesh, projection));
      } else if (zoomLevel < 10) {
        // At medium zoom, filter by level then visibility
        newVisibleFaces = mesh.faces
          .filter(face => face.level <= 5 + zoomLevel - 5)
          .filter(face => isTriangleVisible(face, mesh, projection));
      } else {
        // At high zoom, use full visibility check
        newVisibleFaces = mesh.faces.filter(face => 
          isTriangleVisible(face, mesh, projection)
        );
      }
      
      // Further optimize by prioritizing most clicked faces
      if (newVisibleFaces.length > maxVisibleFaces) {
        newVisibleFaces.sort((a, b) => b.clickCount - a.clickCount);
      }
      
      // Limit number of faces for performance
      setVisibleFaces(newVisibleFaces.slice(0, maxVisibleFaces));
      
      const endTime = performance.now();
      setRenderTimes(prev => [...prev.slice(-4), endTime - startTime]);
      
      if (debugMode) {
        console.log(
          `Filtered to ${newVisibleFaces.length} visible faces, showing ${Math.min(newVisibleFaces.length, maxVisibleFaces)}`,
          `(took ${(endTime - startTime).toFixed(1)}ms)`
        );
      }
    } catch (error) {
      console.error('Error filtering visible faces:', error);
      setRenderError(`Face filtering error: ${error instanceof Error ? error.message : String(error)}`);
    }
  }, [map, mesh, maxVisibleFaces, debugMode]);
  // Update visible faces when map moves or zooms with debounce
  useEffect(() => {
    try {
      updateVisibleFaces();
      
      // Debounce map movement events for better performance
      let moveTimeout: NodeJS.Timeout;
      
      const handleMapMove = () => {
        clearTimeout(moveTimeout);
        moveTimeout = setTimeout(() => {
          updateVisibleFaces();
        }, 100); // 100ms debounce
      };
      
      // Add event listeners for map movements
      map.on('moveend', handleMapMove);
      map.on('zoomend', updateVisibleFaces); // Zoom events update immediately
      
      return () => {
        // Clean up event listeners
        clearTimeout(moveTimeout);
        map.off('moveend', handleMapMove);
        map.off('zoomend', updateVisibleFaces);
      };
    } catch (error) {
      console.error('Error setting up map event listeners:', error);
      setRenderError(`Event listener error: ${error instanceof Error ? error.message : String(error)}`);
    }
  }, [map, updateVisibleFaces]);

  // Log mesh and visibility statistics for debugging
  useEffect(() => {
    renderCount.current += 1;
    
    if (debugMode) {
      const avgRenderTime = renderTimes.length > 0 
        ? renderTimes.reduce((a, b) => a + b, 0) / renderTimes.length 
        : 0;
      
      console.log('Triangle Mesh Statistics', { 
        totalFaces: mesh.faces.length,
        visibleFaces: visibleFaces.length,
        vertexCount: mesh.vertices.length,
        renderCount: renderCount.current,
        avgRenderTime: `${avgRenderTime.toFixed(1)}ms`,
        mapZoom: map.getZoom(),
        usingPane: pane
      });
    }
  }, [mesh, visibleFaces, map, pane, debugMode, renderTimes]);
  
  // Helper function to get more distinctive colors for faces with higher contrast
  const getFaceColor = useCallback((face: TriangleFace) => {
    if (face.clickCount === 0) {
      return '#0047ff'; // Very bright blue for unclicked faces - increased vibrancy
    } 
    
    if (face.clickCount >= 11) {
      return '#ff0000'; // Pure bright red for max clicked faces - maximum contrast
    }
    
    // Calculate color based on click count (gradient from green to orange)
    // Using more saturated colors for better visibility
    const hue = 120 - (face.clickCount * 10); // Faster transition to red
    return `hsl(${hue}, 100%, 50%)`; // Maximum saturation for extreme visibility
  }, []);
  
  // Memoize event handlers to prevent re-renders
  const handleFaceClick = useCallback((face: TriangleFace, e: L.LeafletMouseEvent) => {
    console.log('Face clicked:', face.id);
    // Prevent the event from propagating to the map
    L.DomEvent.stopPropagation(e.originalEvent);
    
    // Visual feedback but maintain high visibility
    const polygon = e.target;
    const originalOptions = polygon.options.pathOptions;
    polygon.setStyle({ 
      weight: 6,
      color: '#ff4500',
      fillOpacity: 1.0
    });
    
    // Restore original style after animation
    setTimeout(() => {
      polygon.setStyle(originalOptions);
    }, 300);
    
    onFaceClick?.(face.id);
  }, [onFaceClick]);
  
  const handleFaceHover = useCallback((face: TriangleFace, e: L.LeafletMouseEvent) => {
    const polygon = e.target;
    polygon.setStyle({
      weight: 5,
      color: '#0062ff',
      fillOpacity: 1.0
    });
    
    onFaceHover?.(face.id);
  }, [onFaceHover]);
  
  const handleFaceMouseOut = useCallback((face: TriangleFace, e: L.LeafletMouseEvent) => {
    const polygon = e.target;
    const pathOptions = getPathOptions(face, renderingQuality);
    polygon.setStyle(pathOptions);
    
    onFaceHover?.(null);
  }, [onFaceHover]);
  
  return (
    <>
      {/* Full mesh face rendering with visibility optimization */}
      {visibleFaces.length > 0 ? (
        visibleFaces.map((face) => {
          try {
            // Get coordinates for each vertex
            const positions: LatLngExpression[] = face.vertices.map(vertexIndex => {
              const vertex = mesh.vertices[vertexIndex];
              return [vertex.latitude, vertex.longitude];
            });
            
            // Close the polygon by adding the first vertex again
            if (positions.length > 0 && positions[0] !== positions[positions.length - 1]) {
              positions.push(positions[0]);
            }
            
            // Skip invalid polygons
            if (positions.length < 4) { // 3 points + closing point
              if (debugMode) {
                console.warn(`Skipping invalid face ${face.id} with ${positions.length} vertices`);
              }
              return null;
            }
            
            // Calculate color based on face properties
            face.color = getFaceColor(face);
            
            // Create path options based on rendering quality
            const pathOptions = getPathOptions(face, renderingQuality);
            
            return (
              <MemoizedPolygon
                key={face.id}
                positions={positions}
                pathOptions={pathOptions}
                eventHandlers={{
                  click: (e) => handleFaceClick(face, e),
                  mouseover: (e) => handleFaceHover(face, e),
                  mouseout: (e) => handleFaceMouseOut(face, e)
                }}
                pane={pane}
              />
            );
          } catch (error) {
            if (debugMode) {
              console.error(`Error rendering face ${face.id}:`, error);
            }
            return null;
          }
        })
      ) : (
        // Fallback to placeholder triangle if no visible faces
        mesh.faces.length > 0 && mesh.faces[0].vertices.length >= 3 && (
          <Polygon
            key="placeholder-triangle"
            positions={[
              [mesh.vertices[mesh.faces[0].vertices[0]].latitude, mesh.vertices[mesh.faces[0].vertices[0]].longitude],
              [mesh.vertices[mesh.faces[0].vertices[1]].latitude, mesh.vertices[mesh.faces[0].vertices[1]].longitude],
              [mesh.vertices[mesh.faces[0].vertices[2]].latitude, mesh.vertices[mesh.faces[0].vertices[2]].longitude],
              [mesh.vertices[mesh.faces[0].vertices[0]].latitude, mesh.vertices[mesh.faces[0].vertices[0]].longitude] // Close the polygon
            ]}
            pathOptions={{
              color: '#000000', // Black outline for maximum visibility
              weight: 8, // Extra thick border
              fillColor: '#ff0000', // Bright red fill
              fillOpacity: 1.0, // Full fill opacity
              opacity: 1.0,
              className: 'triangle-mesh-polygon triangle-top-layer',
              bubblingMouseEvents: false,
              zIndex: 10000 // Extremely high z-index
            }}
            eventHandlers={{
              click: (e) => {
                console.log('Placeholder triangle clicked');
                L.DomEvent.stopPropagation(e.originalEvent);
                onFaceClick?.(mesh.faces[0].id);
              }
            }}
            pane={pane}
            interactive={true}
          />
        )
      )}
      
      {/* Render error UI if something fails */}
      {renderError && (
        <div 
          style={{ 
            position: 'absolute', 
            bottom: '10px', 
            left: '10px', 
            backgroundColor: 'rgba(255,0,0,0.7)', 
            color: 'white', 
            padding: '5px', 
            zIndex: 1000, 
            borderRadius: '3px',
            fontSize: '12px'
          }}
        >
          Error: {renderError}
        </div>
      )}
      
      {/* Performance debug info */}
      {debugMode && renderTimes.length > 0 && (
        <div 
          style={{ 
            position: 'absolute', 
            bottom: '10px', 
            right: '10px', 
            backgroundColor: 'rgba(0,0,0,0.7)', 
            color: 'white', 
            padding: '5px', 
            zIndex: 1000, 
            borderRadius: '3px',
            fontSize: '12px'
          }}
        >
          <div>Faces: {visibleFaces.length}/{mesh.faces.length}</div>
          <div>Render time: {renderTimes[renderTimes.length - 1].toFixed(1)}ms</div>
        </div>
      )}
    </>
  );
};

export default TriangleMeshOverlay;

