import mongoose from 'mongoose';

/**
 * Global type definition for mongoose cache to maintain connection across hot reloads
 */
interface MongooseCache {
  conn: typeof mongoose | null;
  promise: Promise<typeof mongoose> | null;
}

/**
 * Augment the NodeJS global type to include our mongoose cache
 */
declare global {
  // eslint-disable-next-line no-var
  var mongoose: MongooseCache | undefined;
}

// TypeScript safe way to access and initialize the global mongoose cache
const globalMongoose = global as unknown as {
  mongoose?: MongooseCache;
};

// Initialize the global mongoose cache if it doesn't exist
if (!globalMongoose.mongoose) {
  globalMongoose.mongoose = { conn: null, promise: null };
}

/**
 * Connect to MongoDB Atlas database
 * Uses connection caching to prevent multiple connections during development
 */
export async function connectToDatabase() {
  // If we already have a connection, return it
  if (globalMongoose.mongoose?.conn) {
    return globalMongoose.mongoose.conn;
  }

  // Check if MongoDB URI is defined
  const MONGODB_URI = process.env.MONGODB_URI;
  if (!MONGODB_URI) {
    throw new Error(
      'Please define the MONGODB_URI environment variable in .env.local'
    );
  }

  // If a connection is already being established, wait for it
  if (!globalMongoose.mongoose?.promise) {
    const options = {
      bufferCommands: false,
    };

    // Create a new connection
    globalMongoose.mongoose!.promise = mongoose
      .connect(MONGODB_URI, options)
      .then((mongoose) => {
        console.log('Connected to MongoDB Atlas successfully');
        return mongoose;
      })
      .catch((err) => {
        console.error('Error connecting to MongoDB Atlas:', err);
        throw err;
      });
  }

  // Wait for the connection and cache it
  try {
    globalMongoose.mongoose!.conn = await globalMongoose.mongoose!.promise;
  } catch (err) {
    globalMongoose.mongoose!.promise = null;
    throw err;
  }

  return globalMongoose.mongoose!.conn;
}

/**
 * Disconnect from MongoDB Atlas database
 */
export async function disconnectFromDatabase() {
  if (globalMongoose.mongoose?.conn) {
    await mongoose.disconnect();
    globalMongoose.mongoose.conn = null;
    globalMongoose.mongoose.promise = null;
    console.log('Disconnected from MongoDB Atlas');
  }
}

