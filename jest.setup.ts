// Type declarations for global test utilities and custom matchers
interface CustomMatchers<R = unknown> {
  toBeWithinRange(floor: number, ceiling: number): R;
}

// Augment Jest's expect with our custom matchers
declare global {
  namespace jest {
    interface Expect extends CustomMatchers {}
    interface Matchers<R> extends CustomMatchers<R> {}
    interface InverseAsymmetricMatchers extends CustomMatchers {}
  }
  
  // Define our test utilities type
  interface TestUtils {
    wait: (ms: number) => Promise<void>;
    isConnectedToDB: () => boolean;
    randomString: (length?: number) => string;
  }
  
  // Add testUtils to the global namespace
  var testUtils: TestUtils;
}

// Import jest-dom for DOM testing utilities
import '@testing-library/jest-dom';
import mongoose from 'mongoose';

// Define MongoDB connection management
let connection: typeof mongoose | null = null;

// MongoDB connection handling for tests
async function connectToTestDB() {
  try {
    // Use test MongoDB URI from environment or fallback to the provided one
    const MONGODB_URI = process.env.MONGODB_URI || 
      'mongodb+srv://moldovancsaba:bYnmuz-5gaqqa-riqriw@cluster-step.crnvmcs.mongodb.net/?retryWrites=true&w=majority&appName=Cluster-Step';
    
    // Connect to MongoDB with test-specific options
    connection = await mongoose.connect(MONGODB_URI, {
      // Connection options specific for tests
      serverSelectionTimeoutMS: 5000, // Shorter timeout for tests
      socketTimeoutMS: 10000,
      connectTimeoutMS: 10000,
    });
    
    console.log('Connected to test MongoDB instance');
    return connection;
  } catch (error) {
    console.error('Error connecting to test MongoDB:', error);
    throw error;
  }
}

// Disconnect from test DB
async function disconnectFromTestDB() {
  if (connection) {
    await mongoose.disconnect();
    connection = null;
    console.log('Disconnected from test MongoDB instance');
  }
}

// Setup and teardown for MongoDB
beforeAll(async () => {
  // Check if we're in test environment (don't directly assign to NODE_ENV)
  const isTestEnvironment = process.env.NODE_ENV === 'test';
  
  // Only connect if MONGODB_URI is valid
  if (process.env.MONGODB_URI && 
     (process.env.MONGODB_URI.startsWith('mongodb://') || 
      process.env.MONGODB_URI.startsWith('mongodb+srv://'))) {
    try {
      await connectToTestDB();
    } catch (error) {
      console.warn('Unable to connect to MongoDB for tests. Some tests may be skipped.', error);
    }
  } else {
    console.warn('No valid MONGODB_URI found. MongoDB tests will be skipped.');
  }
});

afterAll(async () => {
  await disconnectFromTestDB();
});

// Environment variable mocking (avoiding direct assignment to NODE_ENV)
// Ensure test environment variables are set
process.env.NEXT_PUBLIC_API_URL = 'http://localhost:3000/api';

// Set up MongoDB URI for tests if not already set
if (!process.env.MONGODB_URI) {
  process.env.MONGODB_URI = 'mongodb+srv://moldovancsaba:bYnmuz-5gaqqa-riqriw@cluster-step.crnvmcs.mongodb.net/?retryWrites=true&w=majority&appName=Cluster-Step';
}

// Mock window.matchMedia
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: jest.fn().mockImplementation(query => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: jest.fn(), // Deprecated
    removeListener: jest.fn(), // Deprecated
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    dispatchEvent: jest.fn(),
  })),
});

// Mock Next.js router
jest.mock('next/navigation', () => ({
  useRouter: () => ({
    push: jest.fn(),
    replace: jest.fn(),
    back: jest.fn(),
    forward: jest.fn(),
    refresh: jest.fn(),
    prefetch: jest.fn(),
    pathname: '/',
    query: {},
  }),
  usePathname: jest.fn(() => '/'),
  useSearchParams: jest.fn(() => ({ get: jest.fn() })),
}));

// Global test utilities
global.testUtils = {
  // Helper to wait for a specified time
  wait: (ms: number) => new Promise(resolve => setTimeout(resolve, ms)),
  
  // Helper to check if connected to MongoDB
  isConnectedToDB: () => mongoose.connection.readyState === 1,
  
  // Helper to generate a random string
  randomString: (length = 10) => {
    const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < length; i++) {
      result += characters.charAt(Math.floor(Math.random() * characters.length));
    }
    return result;
  },
};

// Extend expect with custom matchers if needed
expect.extend({
  toBeWithinRange(received, floor, ceiling) {
    const pass = received >= floor && received <= ceiling;
    if (pass) {
      return {
        message: () => `expected ${received} not to be within range ${floor} - ${ceiling}`,
        pass: true,
      };
    } else {
      return {
        message: () => `expected ${received} to be within range ${floor} - ${ceiling}`,
        pass: false,
      };
    }
  },
});

// Increase EventEmitter maximum listener count
require('events').EventEmitter.defaultMaxListeners = 20;

// Ignore specific console warnings or errors during tests if needed
// Uncomment to suppress warnings
// const originalConsoleWarn = console.warn;
// console.warn = (...args) => {
//   // Filter out specific warning patterns
//   if (args[0]?.includes('some pattern to ignore')) {
//     return;
//   }
//   originalConsoleWarn(...args);
// };

// Additional test cleanup
afterEach(() => {
  // Clear mocks between tests
  jest.clearAllMocks();
  
  // Clean DOM between tests
  document.body.innerHTML = '';
});

// Suppress console errors during tests (optional)
// jest.spyOn(console, 'error').mockImplementation(() => {});
