import mongoose, { Schema, Document, Model } from 'mongoose';
import { Coordinate, MeshVertex, MeshFace } from '../types/geometry';

const CoordinateSchema = new Schema<Coordinate>({
  latitude: { type: Number, required: true },
  longitude: { type: Number, required: true },
  altitude: { type: Number },
  timestamp: { type: Number, required: true }
});

const MeshVertexSchema = new Schema<MeshVertex>({
  position: {
    type: [Number],
    required: true,
    validate: (v: number[]) => v.length === 3
  },
  normal: {
    type: [Number],
    validate: (v: number[]) => v.length === 3
  },
  uv: {
    type: [Number],
    validate: (v: number[]) => v.length === 2
  }
});

const MeshFaceSchema = new Schema<MeshFace>({
  vertices: {
    type: [Number],
    required: true,
    validate: (v: number[]) => v.length === 3
  }
});

// Define the document interface
interface GeometryMeshDocument extends Document {
  vertices: MeshVertex[];
  faces: MeshFace[];
  creator: string;
  location: {
    center: Coordinate;
    bounds: {
      northeast: Coordinate;
      southwest: Coordinate;
    };
  };
  properties: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
  isUserWithinBounds(userLocation: Coordinate): boolean;
}

const GeometryMeshSchema = new Schema<GeometryMeshDocument>({
  vertices: [MeshVertexSchema],
  faces: [MeshFaceSchema],
  creator: { type: String, required: true },
  location: {
    center: CoordinateSchema,
    bounds: {
      northeast: CoordinateSchema,
      southwest: CoordinateSchema
    }
  },
  properties: {
    type: Schema.Types.Mixed,
    default: {}
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes for geospatial queries
GeometryMeshSchema.index({
  'location.center.latitude': 1,
  'location.center.longitude': 1
});

// Add a method to validate if a user is within mesh bounds
GeometryMeshSchema.methods.isUserWithinBounds = function(userLocation: Coordinate) {
  const { bounds } = this.location;
  return userLocation.latitude <= bounds.northeast.latitude &&
         userLocation.latitude >= bounds.southwest.latitude &&
         userLocation.longitude <= bounds.northeast.longitude &&
         userLocation.longitude >= bounds.southwest.longitude;
};

// Create and export the model
export const GeometryMeshModel: Model<GeometryMeshDocument> = 
  mongoose.models.GeometryMesh as Model<GeometryMeshDocument> || 
  mongoose.model<GeometryMeshDocument>('GeometryMesh', GeometryMeshSchema);
