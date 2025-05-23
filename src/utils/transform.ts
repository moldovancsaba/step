import { ViewportState } from '../types/viewport';
import { degToRad, radToDeg } from './math';

const EARTH_RADIUS = 6371000; // meters
const MAX_LATITUDE = 85.05112878; // Maximum latitude for Web Mercator

export const geoToMercator = (coord: [number, number]): [number, number] => {
  const [lon, lat] = coord;
  const x = degToRad(lon) * EARTH_RADIUS;
  const y = Math.log(Math.tan(Math.PI / 4 + degToRad(lat) / 2)) * EARTH_RADIUS;
  return [x, y];
};

export const mercatorToGeo = (point: [number, number]): [number, number] => {
  const [x, y] = point;
  const lon = radToDeg(x / EARTH_RADIUS);
  const lat = radToDeg(2 * Math.atan(Math.exp(y / EARTH_RADIUS)) - Math.PI / 2);
  return [lon, lat];
};

export const geoToScreen = (
  coord: [number, number],
  viewport: ViewportState,
  dimensions: { width: number; height: number }
): [number, number] => {
  // Convert to Mercator
  const [mx, my] = geoToMercator(coord);
  
  // Get viewport center in Mercator
  const [centerMx, centerMy] = geoToMercator(viewport.center);
  
  // Calculate scale based on zoom
  const scale = Math.pow(2, viewport.zoom);
  
  // Apply viewport transform
  const dx = mx - centerMx;
  const dy = my - centerMy;
  
  // Rotate point around viewport center
  const rotation = degToRad(viewport.rotation);
  const rotatedX = dx * Math.cos(rotation) - dy * Math.sin(rotation);
  const rotatedY = dx * Math.sin(rotation) + dy * Math.cos(rotation);
  
  // Scale and translate to screen coordinates
  const x = dimensions.width / 2 + rotatedX * scale;
  const y = dimensions.height / 2 - rotatedY * scale;
  
  return [x, y];
};

export const screenToGeo = (
  point: [number, number],
  viewport: ViewportState,
  dimensions: { width: number; height: number }
): [number, number] => {
  const scale = Math.pow(2, viewport.zoom);
  const [centerMx, centerMy] = geoToMercator(viewport.center);
  
  // Translate to Mercator coordinates relative to viewport center
  const dx = (point[0] - dimensions.width / 2) / scale;
  const dy = -(point[1] - dimensions.height / 2) / scale;
  
  // Reverse rotation
  const rotation = -degToRad(viewport.rotation);
  const rotatedX = dx * Math.cos(rotation) - dy * Math.sin(rotation);
  const rotatedY = dx * Math.sin(rotation) + dy * Math.cos(rotation);
  
  // Add viewport center offset
  const mx = centerMx + rotatedX;
  const my = centerMy + rotatedY;
  
  return mercatorToGeo([mx, my]);
};

export const calculateViewportBounds = (
  viewport: ViewportState,
  dimensions: { width: number; height: number }
): ViewportState['bounds'] => {
  const topLeft = screenToGeo([0, 0], viewport, dimensions);
  const bottomRight = screenToGeo([dimensions.width, dimensions.height], viewport, dimensions);
  
  return {
    min: [Math.min(topLeft[0], bottomRight[0]), Math.min(topLeft[1], bottomRight[1])],
    max: [Math.max(topLeft[0], bottomRight[0]), Math.max(topLeft[1], bottomRight[1])]
  };
};

export const isCoordinateVisible = (
  coord: [number, number],
  viewport: ViewportState
): boolean => {
  const { bounds } = viewport;
  return coord[0] >= bounds.min[0] && coord[0] <= bounds.max[0] &&
         coord[1] >= bounds.min[1] && coord[1] <= bounds.max[1];
};

export const normalizeViewport = (viewport: ViewportState): ViewportState => {
  return {
    ...viewport,
    center: [
      ((viewport.center[0] + 180) % 360) - 180, // Normalize longitude to [-180, 180]
      Math.max(Math.min(viewport.center[1], MAX_LATITUDE), -MAX_LATITUDE) // Clamp latitude
    ],
    rotation: ((viewport.rotation % 360) + 360) % 360, // Normalize rotation to [0, 360]
    zoom: Math.max(0, viewport.zoom) // Ensure non-negative zoom
  };
};
