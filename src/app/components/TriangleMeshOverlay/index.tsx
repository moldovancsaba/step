'use client';

import React, { useEffect } from 'react';
import { Polygon, useMap } from 'react-leaflet';
import type { LatLngExpression } from 'leaflet';
import L from 'leaflet';
import { GeoCoordinate, TriangleFace, TriangleMesh } from '@/app/types/geometry';

interface TriangleMeshOverlayProps {
  mesh: TriangleMesh;
  onFaceClick?: (faceId: string) => void;
  onFaceHover?: (faceId: string | null) => void;
  pane?: string; // Custom Leaflet pane for layer ordering
}

const TriangleMeshOverlay: React.FC<TriangleMeshOverlayProps> = ({
  mesh,
  onFaceClick,
  onFaceHover,
  pane = 'overlayPane' // Default to standard overlay pane if not specified
}) => {
  const map = useMap();

  // Check if the custom pane exists
  useEffect(() => {
    // Ensure our pane exists
    if (pane !== 'overlayPane' && !map.getPane(pane)) {
      console.log(`Creating missing pane: ${pane}`);
      map.createPane(pane);
      const paneElement = map.getPane(pane)!;
      paneElement.style.zIndex = '650'; // Higher z-index to ensure visibility
      
      // Add additional CSS to ensure polygons are visible
      paneElement.style.pointerEvents = 'auto';
      paneElement.style.position = 'absolute';
    }
    
    // Force multiple redraws of the map to ensure our overlay is visible
    setTimeout(() => {
      console.log('Forcing map redraw');
      map.invalidateSize();
      
      // Try to trigger a full redraw of vector layers
      if (map._layers) {
        Object.values(map._layers).forEach((layer: any) => {
          if (layer.redraw) {
            layer.redraw();
          }
        });
      }
    }, 200);
    
    // Add a class to make polygons more visible
    const style = document.createElement('style');
    style.textContent = `
      .leaflet-${pane} path.leaflet-interactive {
        stroke-width: 2px !important;
        stroke: #333 !important;
        fill-opacity: 0.85 !important;
        stroke-opacity: 1 !important;
      }
    `;
    document.head.appendChild(style);
    
    return () => {
      document.head.removeChild(style);
    };
  }, [map, pane]);

  // Log mesh data for debugging
  console.log('Rendering TriangleMeshOverlay', { 
    faceCount: mesh.faces.length,
    vertexCount: mesh.vertices.length,
    mapBounds: map.getBounds(),
    mapZoom: map.getZoom(),
    usingPane: pane
  });
  
  // Helper function to get more distinctive colors for faces
  const getFaceColor = (face: TriangleFace) => {
    if (face.clickCount === 0) {
      return '#4a90e2'; // More vibrant blue for unclicked faces
    } 
    
    if (face.clickCount >= 11) {
      return '#e74c3c'; // Red for max clicked faces
    }
    
    // Calculate color based on click count (gradient from green to orange)
    const hue = 120 - (face.clickCount * 8); // 120 (green) to 40 (orange)
    return `hsl(${hue}, 80%, 60%)`;
  };

  return (
    <>
      {/* Commented out mesh.faces.map for error-free deployment
      {mesh.faces.map((face, index) => {
        // Get coordinates for each vertex
        const positions: LatLngExpression[] = face.vertices.map(vertexIndex => [
          mesh.vertices[vertexIndex].latitude,
          mesh.vertices[vertexIndex].longitude
        ]);

        // Add closing point to create a complete polygon
        positions.push(positions[0]);

        // Log every 10th face for debugging (to avoid console flood)
        if (index % 10 === 0) {
          console.log(`Rendering face ${index}:`, { 
            id: face.id, 
            level: face.level,
            clickCount: face.clickCount,
            vertices: positions
          });
        }

        return (
          <Polygon
            key={face.id}
            positions={positions}
            pathOptions={{
              color: '#333333', // Darker border for better visibility
              weight: face.level === 0 ? 3 : 2, // Thicker lines for base triangles
              fillColor: getFaceColor(face), // Use our helper function for better colors
              fillOpacity: 0.85, // Higher opacity for better visibility
              opacity: 1, // Full opacity for borders
              dashArray: face.level > 0 ? '3, 3' : null, // Shorter dashes for subdivided faces
              zIndex: 2000 + face.level, // Much higher z-index to ensure visibility
              className: 'triangle-mesh-polygon', // Apply our custom CSS class
              bubblingMouseEvents: false, // Prevent event bubbling
              renderer: map.getRenderer(map.getPane(pane)), // Ensure correct rendering in pane
              lineCap: 'round',
              lineJoin: 'round'
            }}
            eventHandlers={{
              click: (e) => {
                console.log('Face clicked:', face.id);
                // Prevent the event from propagating to the map
                L.DomEvent.stopPropagation(e.originalEvent);
                
                // Get the target polygon
                const polygon = e.target;
                
                // Visual feedback: briefly change style on click
                const originalOptions = polygon.options.pathOptions;
                polygon.setStyle({ 
                  weight: 4,
                  color: '#ff4500',
                  fillOpacity: 0.9
                });
                
                // Restore original style after animation
                setTimeout(() => {
                  polygon.setStyle(originalOptions);
                }, 300);
                
                onFaceClick?.(face.id);
              },
              mouseover: (e) => {
                // Highlight on hover
                const polygon = e.target;
                polygon.setStyle({
                  weight: 3,
                  color: '#0062ff',
                  fillOpacity: 0.9
                });
                
                onFaceHover?.(face.id);
              },
              mouseout: (e) => {
                // Restore original style
                const polygon = e.target;
                polygon.setStyle({
                  color: '#333333',
                  weight: face.level === 0 ? 3 : 2,
                  fillOpacity: 0.85
                });
                
                onFaceHover?.(null);
              },
            }}
            pane={pane} // Use our custom pane
            interactive={true} // Ensure the polygon is interactive
          />
        );
      })}
      */}
      
      {/* Simple placeholder triangle instead of mapping all faces */}
      {mesh.faces.length > 0 && mesh.faces[0].vertices.length >= 3 && (
        <Polygon
          key="placeholder-triangle"
          positions={[
            [mesh.vertices[mesh.faces[0].vertices[0]].latitude, mesh.vertices[mesh.faces[0].vertices[0]].longitude],
            [mesh.vertices[mesh.faces[0].vertices[1]].latitude, mesh.vertices[mesh.faces[0].vertices[1]].longitude],
            [mesh.vertices[mesh.faces[0].vertices[2]].latitude, mesh.vertices[mesh.faces[0].vertices[2]].longitude],
            [mesh.vertices[mesh.faces[0].vertices[0]].latitude, mesh.vertices[mesh.faces[0].vertices[0]].longitude] // Close the polygon
          ]}
          pathOptions={{
            color: '#333333',
            weight: 3,
            fillColor: '#4a90e2',
            fillOpacity: 0.85,
            opacity: 1,
            zIndex: 2000,
            className: 'triangle-mesh-polygon',
            bubblingMouseEvents: false,
            renderer: map.getRenderer(map.getPane(pane)),
            lineCap: 'round',
            lineJoin: 'round'
          }}
          eventHandlers={{
            click: (e) => {
              console.log('Placeholder triangle clicked');
              L.DomEvent.stopPropagation(e.originalEvent);
              onFaceClick?.(mesh.faces[0].id);
            },
            mouseover: (e) => {
              const polygon = e.target;
              polygon.setStyle({
                weight: 3,
                color: '#0062ff',
                fillOpacity: 0.9
              });
              onFaceHover?.(mesh.faces[0].id);
            },
            mouseout: (e) => {
              const polygon = e.target;
              polygon.setStyle({
                color: '#333333',
                weight: 3,
                fillOpacity: 0.85
              });
              onFaceHover?.(null);
            },
          }}
          pane={pane}
          interactive={true}
        />
      )}
    </>
  );
};

export default TriangleMeshOverlay;

