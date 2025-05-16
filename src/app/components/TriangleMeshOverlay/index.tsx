'use client';

import React from 'react';
import { Polygon, useMap } from 'react-leaflet';
import type { LatLngExpression } from 'leaflet';
import { GeoCoordinate, TriangleFace, TriangleMesh } from '@/app/types/geometry';

interface TriangleMeshOverlayProps {
  mesh: TriangleMesh;
  onFaceClick?: (faceId: string) => void;
  onFaceHover?: (faceId: string | null) => void;
}

const TriangleMeshOverlay: React.FC<TriangleMeshOverlayProps> = ({
  mesh,
  onFaceClick,
  onFaceHover
}) => {
  const map = useMap();

  return (
    <>
      {mesh.faces.map((face) => {
        // Get coordinates for each vertex
        const positions: LatLngExpression[] = face.vertices.map(vertexIndex => [
          mesh.vertices[vertexIndex].latitude,
          mesh.vertices[vertexIndex].longitude
        ]);

        // Add closing point to create a complete polygon
        positions.push(positions[0]);

        return (
          <Polygon
            key={face.id}
            positions={positions}
            pathOptions={{
              color: face.clickCount === 0 ? '#666' : face.color,
              weight: 1,
              fillColor: face.color,
              fillOpacity: 0.5,
            }}
            eventHandlers={{
              click: () => onFaceClick?.(face.id),
              mouseover: () => onFaceHover?.(face.id),
              mouseout: () => onFaceHover?.(null),
            }}
          />
        );
      })}
    </>
  );
};

export default TriangleMeshOverlay;

