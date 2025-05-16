import mongoose, { Connection } from 'mongoose';
import { TriangleMeshModel, InteractionModel, SessionModel } from './models';

// Interface for the global mongoose connection cache
interface MongooseCache {
  conn: Connection | null;
  promise: Promise<typeof mongoose> | null;
}

// Define cached connection variable in global scope
declare global {
  var mongooseCache: MongooseCache;
}

// Initialize global mongoose cache object if it doesn't exist
if (!global.mongooseCache) {
  global.mongooseCache = {
    conn: null,
    promise: null,
  };
}

/**
 * Database connection utility
 * Creates a connection to MongoDB and caches it for reuse
 */
export async function connectToDatabase(): Promise<Connection> {
  // If we have a connection, return it
  if (global.mongooseCache.conn) {
    return global.mongooseCache.conn;
  }

  // If a connection is initializing, wait for it
  if (!global.mongooseCache.promise) {
    const MONGODB_URI = process.env.MONGODB_URI;

    if (!MONGODB_URI) {
      throw new Error(
        'Please define the MONGODB_URI environment variable in .env.local'
      );
    }

    const opts = {
      bufferCommands: false,
    };

    // Create a new connection promise
    global.mongooseCache.promise = mongoose
      .connect(MONGODB_URI, opts)
      .then((mongoose) => {
        console.log('Connected to MongoDB');
        return mongoose;
      });
  }

  try {
    const client = await global.mongooseCache.promise;
    global.mongooseCache.conn = client.connection;
    return global.mongooseCache.conn;
  } catch (error) {
    global.mongooseCache.promise = null;
    throw error;
  }
}

/**
 * Check connection status
 */
export function isDatabaseConnected(): boolean {
  return mongoose.connection.readyState === 1;
}

/**
 * Disconnect from database
 */
export async function disconnectFromDatabase(): Promise<void> {
  try {
    await mongoose.disconnect();
    global.mongooseCache.conn = null;
    global.mongooseCache.promise = null;
  } catch (error) {
    console.error('Error disconnecting from MongoDB:', error);
    throw error;
  }
}

// Export models for convenience
export { TriangleMeshModel, InteractionModel, SessionModel };

export default connectToDatabase;

