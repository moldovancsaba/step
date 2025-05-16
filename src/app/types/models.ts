import { GeoCoordinate, TriangleFace, Vertex } from './geometry';

/**
 * Types for MongoDB models
 */

// MongoDB model for storing triangle mesh data
export interface TriangleMeshDocument {
  _id?: string;
  vertices: Vertex[];
  geoCoordinates: GeoCoordinate[];
  faces: TriangleFace[];
  createdAt: Date;
  updatedAt: Date;
}

// User interaction history
export interface InteractionDocument {
  _id?: string;
  faceId: string;
  action: 'click' | 'subdivide';
  timestamp: Date;
  userId?: string; // For future user authentication
}

// Project session information
export interface SessionDocument {
  _id?: string;
  startTime: Date;
  endTime?: Date;
  interactions: number;
  subdivisions: number;
  maxLevelReached: number;
}

