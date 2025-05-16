import mongoose from 'mongoose';
import { GeoCoordinate, TriangleFace } from '@/app/types/geometry';

// Schema for GeoCoordinate
const GeoCoordinateSchema = new mongoose.Schema<GeoCoordinate>({
  latitude: { type: Number, required: true, min: -90, max: 90 },
  longitude: { type: Number, required: true, min: -180, max: 180 }
});

// Schema for TriangleFace
const TriangleFaceSchema = new mongoose.Schema<TriangleFace>({
  id: { type: String, required: true, unique: true },
  vertices: {
    type: [Number],
    required: true,
    validate: (v: number[]) => v.length === 3
  },
  level: { type: Number, required: true, min: 0, max: 19 },
  clickCount: { type: Number, required: true, min: 0, max: 11 },
  color: { type: String, required: true },
  parentFaceId: { type: String }
});

// Main TriangleMesh Schema
const TriangleMeshSchema = new mongoose.Schema({
  vertices: [GeoCoordinateSchema],
  faces: [TriangleFaceSchema],
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

// Create models
export const TriangleMeshModel = mongoose.models.TriangleMesh || 
  mongoose.model('TriangleMesh', TriangleMeshSchema);

export const InteractionModel = mongoose.models.Interaction ||
  mongoose.model('Interaction', new mongoose.Schema({
    faceId: { type: String, required: true },
    action: { type: String, enum: ['click', 'subdivide'], required: true },
    timestamp: { type: Date, default: Date.now },
    userId: String
  }));

export const SessionModel = mongoose.models.Session ||
  mongoose.model('Session', new mongoose.Schema({
    startTime: { type: Date, required: true },
    endTime: Date,
    interactions: { type: Number, default: 0 },
    subdivisions: { type: Number, default: 0 },
    maxLevelReached: { type: Number, default: 0 }
  }));

