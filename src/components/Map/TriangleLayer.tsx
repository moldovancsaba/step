'use client';

import { useEffect } from 'react';
import { useMap } from 'react-leaflet';
import L from 'leaflet';

const TriangleLayer = () => {
  const map = useMap();

  useEffect(() => {
    // This will be replaced with actual icosahedron vertex calculation
    // For now, just place 12 points approximating an icosahedron
    const icosahedronPoints = [
      // North Pole
      [90, 0],
      // Northern Hemisphere vertices (approximated)
      [30, 0], [30, 72], [30, 144], [30, 216], [30, 288],
      // Southern Hemisphere vertices (approximated)
      [-30, 36], [-30, 108], [-30, 180], [-30, 252], [-30, 324],
      // South Pole
      [-90, 0]
    ];

    // Create initial triangles (simplified for now)
    const triangles = [
      // Top 5 triangles connecting North Pole
      [0, 1, 2], [0, 2, 3], [0, 3, 4], [0, 4, 5], [0, 5, 1],
      // Middle 10 triangles
      [1, 6, 2], [2, 6, 7], [2, 7, 3], [3, 7, 8], [3, 8, 4],
      [4, 8, 9], [4, 9, 5], [5, 9, 10], [5, 10, 1], [1, 10, 6],
      // Bottom 5 triangles connecting South Pole
      [6, 11, 7], [7, 11, 8], [8, 11, 9], [9, 11, 10], [10, 11, 6]
    ];

    // Draw triangles on the map
    triangles.forEach(triangleIndices => {
      const points = triangleIndices.map(i => icosahedronPoints[i]);
      
      // Create a polygon with 50% transparency
      const polygon = L.polygon(points as L.LatLngExpression[], {
        color: 'white',
        fillColor: 'white',
        fillOpacity: 0.5,
        weight: 1
      }).addTo(map);

      // Add click handler for the triangle
      let clickCount = 0;
      polygon.on('click', () => {
        clickCount++;
        
        if (clickCount <= 10) {
          // Increase gray shade by 10% per click
          const opacity = clickCount * 0.1;
          polygon.setStyle({
            fillColor: '#808080', // Gray
            fillOpacity: opacity * 0.5, // Maintain 50% transparency
          });
        } else if (clickCount === 11) {
          // On 11th click, should divide into 4 triangles (not implemented yet)
          // Just change color to red for demonstration
          polygon.setStyle({
            fillColor: 'red',
            fillOpacity: 0.5,
          });
        }
      });
    });

    return () => {
      // Cleanup if needed
    };
  }, [map]);

  return null;
};

export default TriangleLayer;

