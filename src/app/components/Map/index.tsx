'use client';

import React, { useEffect, useCallback } from 'react';
import { MapContainer, TileLayer, useMap } from 'react-leaflet';
import type { Map as LeafletMap } from 'leaflet';
import { useMeshStore } from '@/app/store/meshStore';
import TriangleMeshOverlay from '../TriangleMeshOverlay';
import { MapComponentProps } from './types';

// Safely import Leaflet CSS only on client side
const MapWithCSS: React.FC<{children: React.ReactNode}> = ({ children }) => {
  useEffect(() => {
    import('leaflet/dist/leaflet.css');
  }, []);

  return <>{children}</>;
};

// Map event handler component
const MapEventHandler: React.FC<{ onViewportChange?: MapComponentProps['onViewportChange'] }> = ({ onViewportChange }) => {
  const map = useMap();

  useEffect(() => {
    if (!onViewportChange) return;

    const handleMoveEnd = () => {
      const center = map.getCenter();
      onViewportChange([center.lat, center.lng], map.getZoom());
    };

    map.on('moveend', handleMoveEnd);
    return () => {
      map.off('moveend', handleMoveEnd);
    };
  }, [map, onViewportChange]);

  return null;
};

const MapComponent: React.FC<MapComponentProps> = ({
  center = [0, 0],
  zoom = 2,
  onViewportChange,
  onFaceClick,
  onFaceHover
}) => {
  const mesh = useMeshStore(state => state.mesh);

  return (
    <MapWithCSS>
      <div className="w-full h-full relative">
        <MapContainer
          center={center}
          zoom={zoom}
          style={{ height: '100%', width: '100%' }}
          attributionControl={true}
          zoomControl={true}
        >
          <TileLayer
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            maxZoom={19}
          />
          {mesh && (
            <TriangleMeshOverlay
              mesh={mesh}
              onFaceClick={onFaceClick}
              onFaceHover={onFaceHover}
            />
          )}
          <MapEventHandler onViewportChange={onViewportChange} />
        </MapContainer>
      </div>
    </MapWithCSS>
  );
};

