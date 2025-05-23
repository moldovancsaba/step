'use client';

import React, { useEffect, useRef, useState, useCallback } from 'react';
import mapboxgl from 'mapbox-gl';
import { createMapInstance, getUserLocation } from '@/lib/map';
import { MapViewport, Coordinate, MeshVertex, MeshFace, MeshVisualization, MeshInteractionState } from '@/types/geometry';
import MeshRenderer from '../MeshRenderer/MeshRenderer';
import MeshInteractionManager from '../MeshInteractionManager/MeshInteractionManager';
import 'mapbox-gl/dist/mapbox-gl.css';

interface MapComponentProps {
  onMapLoad?: (map: mapboxgl.Map) => void;
  onUserLocation?: (location: Coordinate) => void;
  initialViewport?: Partial<MapViewport>;
  className?: string;
  visualization?: MeshVisualization;
  interactionMode?: MeshInteractionState['mode'];
  vertices?: MeshVertex[];
  faces?: MeshFace[];
  onVerticesChange?: (vertices: MeshVertex[]) => void;
  onFacesChange?: (faces: MeshFace[] | ((prev: MeshFace[]) => MeshFace[])) => void;
}

const MapComponent: React.FC<MapComponentProps> = ({
  onMapLoad,
  onUserLocation,
  initialViewport,
  className = 'w-full h-full min-h-[60vh]',
  visualization = {
    wireframe: true,
    opacity: 0.7,
    color: '#00ff00',
    visible: true
  },
  interactionMode = 'VIEW',
  vertices = [],
  faces = [],
  onVerticesChange = () => {},
  onFacesChange = () => {}
}) => {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);
  const userMarker = useRef<mapboxgl.Marker | null>(null);
  const [error, setError] = useState<string | null>(null);
  
  // Map state
  const [mapState, setMapState] = useState<MapState>({
    center: {
      latitude: 0,
      longitude: 0,
      altitude: 0,
      timestamp: Date.now()
    },
    zoom: initialViewport?.zoom || 15,
    pitch: initialViewport?.pitch || 45,
    bearing: initialViewport?.bearing || 0
  });

  const updateUserLocationMarker = useCallback((location: Coordinate) => {
    if (!map.current) return;

    if (userMarker.current) {
      userMarker.current.remove();
    }

    // Create a custom marker element
    const el = document.createElement('div');
    el.className = 'w-4 h-4 bg-blue-500 rounded-full border-2 border-white shadow-lg';
    
    // Create and add the marker
    userMarker.current = new mapboxgl.Marker(el)
      .setLngLat([location.longitude, location.latitude])
      .addTo(map.current);

    // Add a pulsing effect
    const pulse = document.createElement('div');
    pulse.className = 'absolute w-8 h-8 bg-blue-500 rounded-full opacity-30 animate-ping -translate-x-2 -translate-y-2';
    el.appendChild(pulse);
  }, []);

  const handleMapMove = useCallback(() => {
    if (!map.current) return;

    const center = map.current.getCenter();
    const zoom = map.current.getZoom();
    const pitch = map.current.getPitch();
    const bearing = map.current.getBearing();

    setMapState({
      center: {
        latitude: center.lat,
        longitude: center.lng,
        altitude: 0,
        timestamp: Date.now()
      },
      zoom,
      pitch,
      bearing
    });
  }, []);

  // Wrap onFacesChange to handle both direct arrays and updater functions
  const handleFacesChange = useCallback((newFaces: MeshFace[] | ((prev: MeshFace[]) => MeshFace[])) => {
    if (typeof newFaces === 'function') {
      onFacesChange(current => newFaces(current));
    } else {
      onFacesChange(newFaces);
    }
  }, [onFacesChange]);

  useEffect(() => {
    if (!mapContainer.current || map.current) return;

    if (!process.env.NEXT_PUBLIC_MAPBOX_TOKEN) {
      setError('Mapbox token is not configured');
      return;
    }

    const container = mapContainer.current;

    const initializeMap = async () => {
      try {
        // Get user location first
        const location = await getUserLocation();
        onUserLocation?.(location);

        // Initialize map centered on user location
        const mapInstance = createMapInstance(container, {
          ...initialViewport,
          center: [location.longitude, location.latitude]
        });

        map.current = mapInstance;

        // Set initial map state
        setMapState(prev => ({
          ...prev,
          center: location
        }));

        mapInstance.on('load', () => {
          onMapLoad?.(mapInstance);
          
          // Add terrain and sky layers for 3D effect
          mapInstance.addSource('mapbox-dem', {
            'type': 'raster-dem',
            'url': 'mapbox://mapbox.mapbox-terrain-dem-v1',
            'tileSize': 512,
            'maxzoom': 14
          });
          
          mapInstance.setTerrain({ 'source': 'mapbox-dem', 'exaggeration': 1.5 });
          
          mapInstance.addLayer({
            'id': 'sky',
            'type': 'sky',
            'paint': {
              'sky-type': 'atmosphere',
              'sky-atmosphere-sun': [0.0, 90.0],
              'sky-atmosphere-sun-intensity': 15
            }
          });

          // Add user location marker
          updateUserLocationMarker(location);
        });

        // Add map movement handlers
        mapInstance.on('move', handleMapMove);
        mapInstance.on('zoom', handleMapMove);
        mapInstance.on('rotate', handleMapMove);
        mapInstance.on('pitch', handleMapMove);

      } catch (error) {
        console.error('Error initializing map:', error);
        setError('Failed to initialize map. Please check your location settings.');
        
        // Initialize with default viewport if geolocation fails
        if (container && !map.current) {
          const mapInstance = createMapInstance(container, initialViewport);
          map.current = mapInstance;
          mapInstance.on('load', () => onMapLoad?.(mapInstance));
          mapInstance.on('move', handleMapMove);
          mapInstance.on('zoom', handleMapMove);
          mapInstance.on('rotate', handleMapMove);
          mapInstance.on('pitch', handleMapMove);
        }
      }
    };

    initializeMap();

    return () => {
      if (map.current) {
        map.current.remove();
        map.current = null;
      }
      if (userMarker.current) {
        userMarker.current.remove();
        userMarker.current = null;
      }
    };
  }, [onMapLoad, onUserLocation, initialViewport, updateUserLocationMarker, handleMapMove]);

  return (
    <div className="relative w-full h-full">
      <div ref={mapContainer} className={className}>
        {!mapboxgl.supported() && (
          <div className="absolute inset-0 flex items-center justify-center bg-gray-100 text-gray-900 p-4 text-center">
            Your browser does not support Mapbox GL JS. Please update your browser.
          </div>
        )}
      </div>
      {error && (
        <div className="absolute top-4 left-4 right-4 bg-red-500 text-white p-4 rounded-lg shadow-lg">
          {error}
        </div>
      )}
      {map.current && (
        <>
          <MeshRenderer
            vertices={vertices}
            faces={faces}
            visualization={visualization}
            mapCenter={mapState.center}
            mapRotation={mapState.bearing}
            mapPitch={mapState.pitch}
            mapZoom={mapState.zoom}
            onMeshUpdate={() => {
              console.log('Mesh updated with map state:', mapState);
            }}
          />
          <MeshInteractionManager
            map={map.current}
            mode={interactionMode}
            onVerticesChange={onVerticesChange}
            onFacesChange={handleFacesChange}
            initialVertices={vertices}
            initialFaces={faces}
          />
        </>
      )}
    </div>
  );
};

interface MapState {
  center: Coordinate;
  zoom: number;
  pitch: number;
  bearing: number;
}

export default MapComponent;
