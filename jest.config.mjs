import nextJest from 'next/jest.js';

// Create a Next.js-specific Jest configuration
const createJestConfig = nextJest({
  // Provide the path to your Next.js app to load next.config.js and .env files
  dir: './',
});

// Custom Jest configuration
const config = {
  // Setup files to run before each test
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  
  // Test environment for simulating a browser
  testEnvironment: 'jest-environment-jsdom',
  
  // TypeScript support
  preset: 'ts-jest',
  
  // Module name mapping for '@/' imports
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  
  // Test patterns to find test files
  testMatch: [
    '**/__tests__/**/*.ts?(x)',
    '**/?(*.)+(spec|test).ts?(x)'
  ],
  
  // Files to collect coverage from
  collectCoverageFrom: [
    'src/**/*.{js,jsx,ts,tsx}',
    '!src/**/*.d.ts',
    '!src/**/_*.{js,jsx,ts,tsx}',
    '!**/node_modules/**',
    '!**/.next/**',
  ],
  
  // Coverage configuration
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html'],
  
  // Additional settings
  verbose: true,
  transform: {
    '^.+\\.(ts|tsx)$': ['ts-jest', {
      tsconfig: 'tsconfig.json',
    }],
  },
  
  // Global variables for MongoDB tests
  globals: {
    'ts-jest': {
      tsconfig: 'tsconfig.json',
    },
  },
  
  // Allow test modules to use ES modules
  transformIgnorePatterns: [
    '/node_modules/(?!mongo-client|mongoose-client|mongodb-client)/',
  ],
  
  // Add .mjs and .cjs to module extensions
  moduleFileExtensions: ['js', 'jsx', 'ts', 'tsx', 'json', 'node', 'mjs', 'cjs'],
  
  // Handle MongoDB memory server
  testTimeout: 30000, // 30 seconds for MongoDB operations
  
  // Run tests in sequence for MongoDB tests
  maxWorkers: 1,
  
  // Watch mode settings
  watchPathIgnorePatterns: [
    '<rootDir>/node_modules/',
    '<rootDir>/.next/',
    '<rootDir>/coverage/',
  ],
};

// Export the merged configuration
export default createJestConfig(config);

