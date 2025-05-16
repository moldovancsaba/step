import mongoose from 'mongoose';

/**
 * Global type definition for mongoose connection
 */
declare global {
  var mongoose: {
    conn: typeof mongoose | null;
    promise: Promise<typeof mongoose> | null;
  };
}

// Initialize the global mongoose object
if (!global.mongoose) {
  global.mongoose = {
    conn: null,
    promise: null,
  };
}

/**
 * Configuration options for MongoDB connection
 */
const MONGODB_OPTIONS: mongoose.ConnectOptions = {
  bufferCommands: false,
};

/**
 * Validates that the MongoDB URI is properly configured
 * @returns The validated MongoDB URI
 * @throws Error if URI is not configured
 */
function getMongoURI(): string {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error(
      'Please define the MONGODB_URI environment variable in .env.local'
    );
  }
  return uri;
}

/**
 * Creates and/or returns a cached MongoDB connection
 * Implements connection pooling to avoid multiple connections
 * 
 * @returns Promise resolving to mongoose instance
 */
export async function connectToDatabase(): Promise<typeof mongoose> {
  // If we already have a connection, return it
  if (global.mongoose.conn) {
    return global.mongoose.conn;
  }

  // If a connection is being established, wait for it
  if (!global.mongoose.promise) {
    try {
      const uri = getMongoURI();
      
      // Create a new connection promise
      global.mongoose.promise = mongoose
        .connect(uri, MONGODB_OPTIONS)
        .then((mongoose) => {
          console.log('Connected to MongoDB successfully');
          return mongoose;
        });
    } catch (error) {
      // Handle connection errors
      global.mongoose.promise = null;
      console.error('Error connecting to MongoDB:', error);
      throw error;
    }
  }

  try {
    // Wait for the connection to resolve
    global.mongoose.conn = await global.mongoose.promise;
    return global.mongoose.conn;
  } catch (error) {
    // Reset the promise on error
    global.mongoose.promise = null;
    console.error('Failed to establish MongoDB connection:', error);
    throw error;
  }
}

/**
 * Disconnects from MongoDB (useful for tests and cleanup)
 */
export async function disconnectFromDatabase(): Promise<void> {
  if (global.mongoose.conn) {
    await global.mongoose.conn.disconnect();
    global.mongoose.conn = null;
    global.mongoose.promise = null;
    console.log('Disconnected from MongoDB');
  }
}

/**
 * Check if database is connected
 * @returns boolean indicating if connection is established
 */
export function isDatabaseConnected(): boolean {
  return global.mongoose.conn !== null && mongoose.connection.readyState === 1;
}

export default connectToDatabase;

