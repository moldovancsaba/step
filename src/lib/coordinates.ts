import { Coordinate } from '@/types/geometry';

// Constants for coordinate conversion
const EARTH_RADIUS = 6371000; // Earth's radius in meters
const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;

/**
 * Convert geographic coordinates to Cartesian coordinates
 * @param coord Geographic coordinate
 * @param origin Origin point for local coordinate system
 * @param scale Scale factor for the conversion (meters per unit)
 * @returns [x, y, z] coordinates in local space
 */
export function geoToCartesian(
  coord: Coordinate,
  origin: Coordinate,
  scale: number = 1
): [number, number, number] {
  // Convert to radians
  const lat = coord.latitude * DEG_TO_RAD;
  const lon = coord.longitude * DEG_TO_RAD;
  const originLat = origin.latitude * DEG_TO_RAD;
  const originLon = origin.longitude * DEG_TO_RAD;

  // Calculate relative position
  const x = EARTH_RADIUS * Math.cos(lat) * Math.sin(lon - originLon);
  const y = EARTH_RADIUS * (
    Math.sin(lat) * Math.cos(originLat) -
    Math.cos(lat) * Math.sin(originLat) * Math.cos(lon - originLon)
  );
  const z = coord.altitude || 0;

  // Scale and return
  return [x / scale, z / scale, y / scale];
}

/**
 * Convert Cartesian coordinates back to geographic coordinates
 * @param position [x, y, z] coordinates in local space
 * @param origin Origin point for local coordinate system
 * @param scale Scale factor for the conversion (meters per unit)
 * @returns Geographic coordinate
 */
export function cartesianToGeo(
  position: [number, number, number],
  origin: Coordinate,
  scale: number = 1
): Coordinate {
  // Scale up the coordinates
  const [x, z, y] = position.map(coord => coord * scale);
  
  const originLat = origin.latitude * DEG_TO_RAD;
  const originLon = origin.longitude * DEG_TO_RAD;

  // Calculate angular distance
  const angularDistance = Math.sqrt(x * x + y * y) / EARTH_RADIUS;
  const bearing = Math.atan2(x, y);

  // Calculate new latitude and longitude
  const lat = Math.asin(
    Math.sin(originLat) * Math.cos(angularDistance) +
    Math.cos(originLat) * Math.sin(angularDistance) * Math.cos(bearing)
  );

  const lon = originLon + Math.atan2(
    Math.sin(bearing) * Math.sin(angularDistance) * Math.cos(originLat),
    Math.cos(angularDistance) - Math.sin(originLat) * Math.sin(lat)
  );

  return {
    latitude: lat * RAD_TO_DEG,
    longitude: lon * RAD_TO_DEG,
    altitude: z,
    timestamp: Date.now()
  };
}

/**
 * Calculate the bounding box for a set of coordinates
 * @param coordinates Array of coordinates
 * @returns Bounding box as northeast and southwest coordinates
 */
export function calculateBoundingBox(coordinates: Coordinate[]) {
  const lats = coordinates.map(c => c.latitude);
  const lons = coordinates.map(c => c.longitude);
  const alts = coordinates.map(c => c.altitude || 0);

  return {
    northeast: {
      latitude: Math.max(...lats),
      longitude: Math.max(...lons),
      altitude: Math.max(...alts),
      timestamp: Date.now()
    },
    southwest: {
      latitude: Math.min(...lats),
      longitude: Math.min(...lons),
      altitude: Math.min(...alts),
      timestamp: Date.now()
    }
  };
}

/**
 * Calculate the center point of a set of coordinates
 * @param coordinates Array of coordinates
 * @returns Center coordinate
 */
export function calculateCenter(coordinates: Coordinate[]): Coordinate {
  const count = coordinates.length;
  if (count === 0) {
    throw new Error('Cannot calculate center of empty coordinate set');
  }

  const sumLat = coordinates.reduce((sum, coord) => sum + coord.latitude, 0);
  const sumLon = coordinates.reduce((sum, coord) => sum + coord.longitude, 0);
  const sumAlt = coordinates.reduce((sum, coord) => sum + (coord.altitude || 0), 0);

  return {
    latitude: sumLat / count,
    longitude: sumLon / count,
    altitude: sumAlt / count,
    timestamp: Date.now()
  };
}

/**
 * Calculate the distance between two coordinates in meters
 * @param coord1 First coordinate
 * @param coord2 Second coordinate
 * @returns Distance in meters
 */
export function calculateDistance(coord1: Coordinate, coord2: Coordinate): number {
  const lat1 = coord1.latitude * DEG_TO_RAD;
  const lon1 = coord1.longitude * DEG_TO_RAD;
  const lat2 = coord2.latitude * DEG_TO_RAD;
  const lon2 = coord2.longitude * DEG_TO_RAD;

  const dLat = lat2 - lat1;
  const dLon = lon2 - lon1;

  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return EARTH_RADIUS * c;
}
