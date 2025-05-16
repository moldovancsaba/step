import mongoose from 'mongoose';

// Define cached connection variable in global scope
declare global {
  var mongoose: {
    conn: typeof mongoose | null;
    promise: Promise<typeof mongoose> | null;
  };
}

// Initialize global mongoose object if it doesn't exist
if (!global.mongoose) {
  global.mongoose = {
    conn: null,
    promise: null,
  };
}

/**
 * Database connection utility
 * Creates a connection to MongoDB and caches it for reuse
 */
export async function connectToDatabase(): Promise<typeof mongoose> {
  // If we have a connection, return it
  if (global.mongoose.conn) {
    return global.mongoose.conn;
  }

  // If a connection is initializing, wait for it
  if (!global.mongoose.promise) {
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
    global.mongoose.promise = mongoose
      .connect(MONGODB_URI, opts)
      .then((mongoose) => {
        console.log('Connected to MongoDB');
        return mongoose;
      })
      .catch((error) => {
        console.error('Error connecting to MongoDB:', error);
        throw error;
      });
  }

  // Wait for connection to resolve
  global.mongoose.conn = await global.mongoose.promise;
  return global.mongoose.conn;
}

export default connectToDatabase;

