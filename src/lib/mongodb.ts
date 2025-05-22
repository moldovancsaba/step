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
    // Enhanced connection options for better performance and reliability
    const options = {
      bufferCommands: false,
      autoIndex: true, // Build indexes
      maxPoolSize: 10, // Maintain up to 10 socket connections
      serverSelectionTimeoutMS: 5000, // Keep trying to send operations for 5 seconds
      socketTimeoutMS: 45000, // Close sockets after 45 seconds of inactivity
      family: 4, // Use IPv4, skip trying IPv6
      connectTimeoutMS: 10000, // Give up initial connection after 10 seconds
      retryWrites: true,
      retryReads: true,
    };

    // Log connection attempt with URI structure (hiding credentials)
    const sanitizedUri = MONGODB_URI.replace(
      /mongodb(\+srv)?:\/\/([^:]+):([^@]+)@/,
      'mongodb$1://$2:****@'
    );
    console.log(`Connecting to MongoDB Atlas: ${sanitizedUri}`);

    // Check if URI format is valid before attempting connection
    if (!MONGODB_URI.startsWith('mongodb://') && !MONGODB_URI.startsWith('mongodb+srv://')) {
      console.error('Invalid MongoDB URI format. URI must start with mongodb:// or mongodb+srv://');
      throw new Error('Invalid MongoDB URI format');
    }

    // Create a new connection with enhanced error handling
    globalMongoose.mongoose!.promise = mongoose
      .connect(MONGODB_URI, options)
      .then((mongoose) => {
        console.log('Connected to MongoDB Atlas successfully');
        // Log database information
        const db = mongoose.connection.db;
        if (db) {
          console.log(`Connected to database: ${db.databaseName}`);
        } else {
          console.log('Connected to database, but database information is not available');
        }
        return mongoose;
      })
      .catch((err) => {
        console.error('Error connecting to MongoDB Atlas:', err);
        
        // More specific error logging based on error type
        if (err.name === 'MongoServerSelectionError') {
          console.error('Could not connect to any MongoDB server in the cluster');
        } else if (err.name === 'MongoParseError') {
          console.error('Invalid MongoDB connection string format');
        } else if (err.name === 'MongoError' && err.code === 18) {
          console.error('MongoDB authentication failed - check username and password');
        } else if (err.name === 'MongoError' && err.code === 13) {
          console.error('MongoDB authorization failed - check database permissions');
        }
        
        throw err;
      });
  }

  // Wait for the connection and cache it
  try {
    globalMongoose.mongoose!.conn = await globalMongoose.mongoose!.promise;
    
    // Set up connection event listeners for better monitoring
    const connection = mongoose.connection;
    
    connection.on('error', (err) => {
      console.error('MongoDB connection error:', err);
    });
    
    connection.on('disconnected', () => {
      console.warn('MongoDB disconnected. Attempting to reconnect...');
    });
    
    connection.on('reconnected', () => {
      console.log('MongoDB reconnected successfully');
    });
    
    // Log successful connection details
    console.log(`MongoDB connection state: ${connection.readyState}`);
  } catch (err) {
    console.error('Failed to establish MongoDB connection:', err);
    globalMongoose.mongoose!.promise = null;
    throw err;
  }

  return globalMongoose.mongoose!.conn;
}

/**
 * Disconnect from MongoDB Atlas database
 */
/**
 * Safely disconnect from MongoDB Atlas database
 */
export async function disconnectFromDatabase() {
  if (globalMongoose.mongoose?.conn) {
    try {
      await mongoose.disconnect();
      console.log('Disconnected from MongoDB Atlas successfully');
      globalMongoose.mongoose.conn = null;
      globalMongoose.mongoose.promise = null;
    } catch (err) {
      console.error('Error disconnecting from MongoDB:', err);
      throw err;
    }
  } else {
    console.log('No active MongoDB connection to disconnect');
  }
}

