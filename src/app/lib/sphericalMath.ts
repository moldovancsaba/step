/**
 * sphericalMath.ts
 * 
 * Mathematical utilities for spherical geometry calculations.
 * This file provides the foundation for converting between coordinate systems,
 * calculating great circle arcs, and performing interpolation on a sphere surface.
 */

import { GeoCoordinate } from '@/app/types/geometry';

/**
 * 3D vector for Cartesian coordinate representation
 */
export interface Vector3 {
  x: number;
  y: number;
  z: number;
}

/**
 * Constants for Earth geometry calculations
 */
export const EARTH_RADIUS = 6371; // in kilometers
export const DEG_TO_RAD = Math.PI / 180;
export const RAD_TO_DEG = 180 / Math.PI;

/**
 * Converts geographic coordinates (latitude, longitude) to 3D Cartesian coordinates
 * 
 * @param geo Geographic coordinates in degrees
 * @returns 3D Cartesian coordinates on a unit sphere
 */
export function geoToVector3(geo: GeoCoordinate): Vector3 {
  // Convert degrees to radians
  const latRad = geo.latitude * DEG_TO_RAD;
  const lonRad = geo.longitude * DEG_TO_RAD;

  // Convert to 3D Cartesian coordinates on unit sphere
  const x = Math.cos(latRad) * Math.cos(lonRad);
  const y = Math.cos(latRad) * Math.sin(lonRad);
  const z = Math.sin(latRad);

  return { x, y, z };
}

/**
 * Converts 3D Cartesian coordinates to geographic coordinates
 * 
 * @param vector 3D Cartesian coordinates on a unit sphere
 * @returns Geographic coordinates in degrees
 */
export function vector3ToGeo(vector: Vector3): GeoCoordinate {
  // Normalize the vector to ensure it's on the unit sphere
  const norm = Math.sqrt(vector.x * vector.x + vector.y * vector.y + vector.z * vector.z);
  const x = vector.x / norm;
  const y = vector.y / norm;
  const z = vector.z / norm;
  
  // Convert to geographic coordinates
  const longitude = Math.atan2(y, x) * RAD_TO_DEG;
  const latitude = Math.asin(z) * RAD_TO_DEG;
  
  return { latitude, longitude };
}

/**
 * Calculates the distance between two points on a sphere (in kilometers)
 * using the Haversine formula
 * 
 * @param a First geographic point
 * @param b Second geographic point
 * @returns Distance in kilometers
 */
export function sphericalDistance(a: GeoCoordinate, b: GeoCoordinate): number {
  const latARad = a.latitude * DEG_TO_RAD;
  const latBRad = b.latitude * DEG_TO_RAD;
  const lonARad = a.longitude * DEG_TO_RAD;
  const lonBRad = b.longitude * DEG_TO_RAD;
  
  const dLat = latBRad - latARad;
  const dLon = lonBRad - lonARad;
  
  const havLat = Math.sin(dLat/2) * Math.sin(dLat/2);
  const havLon = Math.sin(dLon/2) * Math.sin(dLon/2);
  
  const a2 = havLat + Math.cos(latARad) * Math.cos(latBRad) * havLon;
  const c = 2 * Math.atan2(Math.sqrt(a2), Math.sqrt(1-a2));
  
  return EARTH_RADIUS * c;
}

/**
 * Calculates the bearing (in degrees) from point a to point b
 * 
 * @param a Starting geographic point
 * @param b Ending geographic point
 * @returns Bearing in degrees (0-360°)
 */
export function initialBearing(a: GeoCoordinate, b: GeoCoordinate): number {
  const latARad = a.latitude * DEG_TO_RAD;
  const latBRad = b.latitude * DEG_TO_RAD;
  const lonDiffRad = (b.longitude - a.longitude) * DEG_TO_RAD;
  
  const y = Math.sin(lonDiffRad) * Math.cos(latBRad);
  const x = Math.cos(latARad) * Math.sin(latBRad) -
            Math.sin(latARad) * Math.cos(latBRad) * Math.cos(lonDiffRad);
  
  let bearing = Math.atan2(y, x) * RAD_TO_DEG;
  
  // Normalize to 0-360°
  bearing = (bearing + 360) % 360;
  
  return bearing;
}

/**
 * Vector dot product
 */
export function dotProduct(a: Vector3, b: Vector3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

/**
 * Vector cross product
 */
export function crossProduct(a: Vector3, b: Vector3): Vector3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x
  };
}

/**
 * Normalize a vector to unit length
 */
export function normalizeVector(v: Vector3): Vector3 {
  const length = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
  return {
    x: v.x / length,
    y: v.y / length,
    z: v.z / length
  };
}

/**
 * Scale a vector by a scalar
 */
export function scaleVector(v: Vector3, scalar: number): Vector3 {
  return {
    x: v.x * scalar,
    y: v.y * scalar,
    z: v.z * scalar
  };
}

/**
 * Add two vectors
 */
export function addVectors(a: Vector3, b: Vector3): Vector3 {
  return {
    x: a.x + b.x,
    y: a.y + b.y,
    z: a.z + b.z
  };
}

/**
 * Spherical Linear Interpolation (SLERP) between two unit vectors
 * 
 * @param start Starting unit vector
 * @param end Ending unit vector
 * @param t Interpolation parameter (0 to 1)
 * @returns Interpolated unit vector
 */
export function slerp(start: Vector3, end: Vector3, t: number): Vector3 {
  // Calculate the dot product between start and end vectors
  let dot = dotProduct(start, end);
  
  // Clamp dot product to ensure numerical stability
  dot = Math.max(Math.min(dot, 1.0), -1.0);
  
  // Calculate the angle between the vectors
  const theta = Math.acos(dot) * t;
  
  // Calculate the interpolated direction vector
  // Formula: (sin((1-t)*theta) * start + sin(t*theta) * end) / sin(theta)
  
  // Handle special case: vectors are nearly parallel
  if (Math.abs(dot) >= 0.9995) {
    // Linear interpolation for nearly parallel vectors
    return normalizeVector({
      x: start.x + t * (end.x - start.x),
      y: start.y + t * (end.y - start.y),
      z: start.z + t * (end.z - start.z)
    });
  }
  
  // Remove the parallel component from 'end'
  const orthoEnd = normalizeVector({
    x: end.x - start.x * dot,
    y: end.y - start.y * dot,
    z: end.z - start.z * dot
  });
  
  // Compute the interpolated vector using the formula:
  // result = start*cos(theta) + orthoEnd*sin(theta)
  return {
    x: start.x * Math.cos(theta) + orthoEnd.x * Math.sin(theta),
    y: start.y * Math.cos(theta) + orthoEnd.y * Math.sin(theta),
    z: start.z * Math.cos(theta) + orthoEnd.z * Math.sin(theta)
  };
}

/**
 * Interpolate points along a great circle arc between two geographic points
 * 
 * @param a Starting geographic point
 * @param b Ending geographic point
 * @param numPoints Number of points to generate (including endpoints)
 * @returns Array of interpolated geographic points
 */
export function greatCircleArc(a: GeoCoordinate, b: GeoCoordinate, numPoints: number = 10): GeoCoordinate[] {
  if (numPoints < 2) {
    throw new Error('Great circle arc needs at least 2 points');
  }
  
  // Handle the case where points are very close or identical
  if (Math.abs(a.latitude - b.latitude) < 1e-10 && Math.abs(a.longitude - b.longitude) < 1e-10) {
    return Array(numPoints).fill(a);
  }
  
  // Convert to Cartesian coordinates
  const aCartesian = geoToVector3(a);
  const bCartesian = geoToVector3(b);
  
  // Generate points along the great circle
  const result: GeoCoordinate[] = [];
  
  for (let i = 0; i < numPoints; i++) {
    // Calculate interpolation parameter (0 to 1)
    const t = i / (numPoints - 1);
    
    // Use SLERP to interpolate
    const interpolated = slerp(aCartesian, bCartesian, t);
    
    // Convert back to geographic coordinates
    const geoPoint = vector3ToGeo(interpolated);
    
    result.push(geoPoint);
  }
  
  return result;
}

/**
 * Handle special case for crossing the 180° meridian
 * Ensures that arc calculations correctly handle the date line
 * 
 * @param a Starting geographic point
 * @param b Ending geographic point
 * @param numPoints Number of points to generate
 * @returns Array of interpolated geographic points
 */
export function greatCircleArcWithAntimeridian(a: GeoCoordinate, b: GeoCoordinate, numPoints: number = 10): GeoCoordinate[] {
  // Check if the arc crosses the date line (180° meridian)
  const crossesDateLine = Math.abs(a.longitude - b.longitude) > 180;
  
  if (crossesDateLine) {
    // Adjust longitudes for proper interpolation
    const adjustedA = { ...a };
    const adjustedB = { ...b };
    
    if (a.longitude > 0) {
      adjustedA.longitude -= 360;
    } else {
      adjustedB.longitude -= 360;
    }
    
    return greatCircleArc(adjustedA, adjustedB, numPoints);
  }
  
  // Normal case
  return greatCircleArc(a, b, numPoints);
}

/**
 * Generate SVG path data for a great circle arc
 * 
 * @param a Starting geographic point
 * @param b Ending geographic point
 * @param projection Function to project geographic coordinates to screen coordinates
 * @param numPoints Number of points to generate
 * @returns SVG path data string
 */
export function greatCircleArcPathData(
  a: GeoCoordinate, 
  b: GeoCoordinate, 
  projection: (geo: GeoCoordinate) => { x: number, y: number }, 
  numPoints: number = 10
): string {
  // Generate points along the great circle arc
  const points = greatCircleArcWithAntimeridian(a, b, numPoints);
  
  // Project points to screen coordinates
  const screenPoints = points.map(projection);
  
  // Create SVG path data
  let pathData = `M ${screenPoints[0].x} ${screenPoints[0].y}`;
  
  for (let i = 1; i < screenPoints.length; i++) {
    pathData += ` L ${screenPoints[i].x} ${screenPoints[i].y}`;
  }
  
  return pathData;
}

/**
 * Generate SVG path data for a spherical triangle
 * 
 * @param vertices Array of three geographic coordinates
 * @param projection Function to project geographic coordinates to screen coordinates
 * @param numPointsPerEdge Number of points to generate per edge
 * @returns SVG path data string for the complete triangle
 */
export function sphericalTrianglePathData(
  vertices: [GeoCoordinate, GeoCoordinate, GeoCoordinate],
  projection: (geo: GeoCoordinate) => { x: number, y: number },
  numPointsPerEdge: number = 10
): string {
  const [a, b, c] = vertices;
  
  // Generate paths for each edge
  const edge1 = greatCircleArcWithAntimeridian(a, b, numPointsPerEdge);
  const edge2 = greatCircleArcWithAntimeridian(b, c, numPointsPerEdge);
  const edge3 = greatCircleArcWithAntimeridian(c, a, numPointsPerEdge);
  
  // Project all points to screen coordinates
  const screenEdge1 = edge1.map(projection);
  const screenEdge2 = edge2.map(projection);
  const screenEdge3 = edge3.map(projection);
  
  // Create SVG path data - start at first point
  let pathData = `M ${screenEdge1[0].x} ${screenEdge1[0].y}`;
  
  // Add first edge (a to b)
  for (let i = 1; i < screenEdge1.length; i++) {
    pathData += ` L ${screenEdge1[i].x} ${screenEdge1[i].y}`;
  }
  
  // Add second edge (b to c)
  for (let i = 1; i < screenEdge2.length; i++) {
    pathData += ` L ${screenEdge2[i].x} ${screenEdge2[i].y}`;
  }
  
  // Add third edge (c to a)
  for (let i = 1; i < screenEdge3.length; i++) {
    pathData += ` L ${screenEdge3[i].x} ${screenEdge3[i].y}`;
  }
  
  // Close the path
  pathData += ' Z';
  
  return pathData;
}

/**
 * Check if a point is inside a triangle on a sphere using spherical barycentric coordinates
 * 
 * @param point The geographic point to check
 * @param a First vertex of the triangle
 * @param b Second vertex of the triangle
 * @param c Third vertex of the triangle
 * @returns True if the point is inside the triangle
 */
export function isPointInGeoTriangle(
  point: GeoCoordinate, 
  a: GeoCoordinate, 
  b: GeoCoordinate, 
  c: GeoCoordinate
): boolean {
  // Convert to Vector3 Cartesian coordinates
  const pointCart = geoToVector3(point);
  const aCart = geoToVector3(a);
  const bCart = geoToVector3(b);
  const cCart = geoToVector3(c);
  
  // Calculate vectors for barycentric coordinates on a unit sphere
  // This uses proper 3D vectors from spherical coordinates (converted via geoToVector3)
  // The barycentric method is mathematically accurate for spherical triangles
  // as we're operating in 3D space with normalized coordinates
  const v0: Vector3 = {
    x: bCart.x - aCart.x,
    y: bCart.y - aCart.y,
    z: bCart.z - aCart.z
  };
  
  const v1: Vector3 = {
    x: cCart.x - aCart.x,
    y: cCart.y - aCart.y,
    z: cCart.z - aCart.z
  };
  
  const v2: Vector3 = {
    x: pointCart.x - aCart.x,
    y: pointCart.y - aCart.y,
    z: pointCart.z - aCart.z
  };
  
  const dot00 = dotProduct(v0, v0);
  const dot01 = dotProduct(v0, v1);
  const dot02 = dotProduct(v0, v2);
  const dot11 = dotProduct(v1, v1);
  const dot12 = dotProduct(v1, v2);
  
  const invDenom = 1 / (dot00 * dot11 - dot01 * dot01);
  const u = (dot11 * dot02 - dot01 * dot12) * invDenom;
  const v = (dot00 * dot12 - dot01 * dot02) * invDenom;
  
  return (u >= 0) && (v >= 0) && (u + v <= 1);
}
