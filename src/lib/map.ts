import mapboxgl from 'mapbox-gl';
import { MapViewport, Coordinate } from '../types/geometry';

// Initialize mapbox with token
mapboxgl.accessToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN || '';

export const defaultViewport: MapViewport = {
  center: [0, 0],
  zoom: 13,
  bearing: 0,
  pitch: 45
};

export const getUserLocation = (): Promise<Coordinate> => {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Geolocation is not supported by your browser'));
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        resolve({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          altitude: position.coords.altitude || undefined,
          timestamp: position.timestamp
        });
      },
      (error) => {
        reject(error);
      },
      {
        enableHighAccuracy: true,
        timeout: 5000,
        maximumAge: 0
      }
    );
  });
};

export const createMapInstance = (
  container: string | HTMLElement,
  initialViewport?: Partial<MapViewport>
): mapboxgl.Map => {
  const map = new mapboxgl.Map({
    container,
    style: 'mapbox://styles/mapbox/dark-v11',
    center: initialViewport?.center || defaultViewport.center,
    zoom: initialViewport?.zoom || defaultViewport.zoom,
    bearing: initialViewport?.bearing || defaultViewport.bearing,
    pitch: initialViewport?.pitch || defaultViewport.pitch,
    antialias: true
  });

  // Add navigation controls
  map.addControl(new mapboxgl.NavigationControl());
  map.addControl(new mapboxgl.GeolocateControl({
    positionOptions: {
      enableHighAccuracy: true
    },
    trackUserLocation: true
  }));

  return map;
};

export const calculateBounds = (coordinates: Coordinate[]): {
  northeast: Coordinate,
  southwest: Coordinate
} => {
  const lats = coordinates.map(coord => coord.latitude);
  const lngs = coordinates.map(coord => coord.longitude);
  
  return {
    northeast: {
      latitude: Math.max(...lats),
      longitude: Math.max(...lngs),
      timestamp: Date.now()
    },
    southwest: {
      latitude: Math.min(...lats),
      longitude: Math.min(...lngs),
      timestamp: Date.now()
    }
  };
};

