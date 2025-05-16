import mongoose from 'mongoose';
import { 
  connectToDatabase, 
  disconnectFromDatabase, 
  isDatabaseConnected,
  getDatabaseConnectionStatus 
} from '../lib/db';
import TriangleMeshModel from '../lib/models/triangleMesh';
import { INITIAL_VERTICES, INITIAL_FACES } from '../types/geometry';
import { cartesianToGeo } from '../store/triangleMeshStore';

// Define a timeout for the tests
jest.setTimeout(30000); // 30 seconds

/**
 * Validate MongoDB URI
 * This checks if the URI is properly formatted
 */
function isValidMongoURI(uri: string | undefined): boolean {
  if (!uri) return false;
  
  // Basic validation for MongoDB URI format
  return uri.startsWith('mongodb://') || uri.startsWith('mongodb+srv://');
}

/**
 * Create a test triangle mesh document
 */
async function createTestTriangleMesh() {
  // Start with the initial vertices
  const vertices = [...INITIAL_VERTICES];
  
  // Calculate the geographic coordinates for each vertex
  const geoCoordinates = vertices.map(vertex => cartesianToGeo(vertex));
  
  // Create the initial faces with level 0 and 0 clicks
  const faces = INITIAL_FACES.map((vertexIndices, index) => ({
    vertices: vertexIndices,
    level: 0,
    clickCount: 0,
    color: 'white',
  }));
  
  // Create and save the test document
  const testMesh = new TriangleMeshModel({
    vertices,
    geoCoordinates,
    faces,
  });
  
  return await testMesh.save();
}

describe('MongoDB Connection Tests', () => {
  
  // Before all tests, check if we have a valid MongoDB URI
  beforeAll(() => {
    const uri = process.env.MONGODB_URI;
    
    // Skip all tests if no valid MongoDB URI is found
    if (!isValidMongoURI(uri)) {
      console.warn('Skipping MongoDB tests - no valid MongoDB URI found');
      return;
    }
  });
  
  // After all tests, disconnect from the database
  afterAll(async () => {
    // Clean up the database connection
    await disconnectFromDatabase();
  });
  
  // Test that the environment variables are properly set
  test('MongoDB URI environment variable is set and valid', () => {
    const uri = process.env.MONGODB_URI;
    expect(uri).toBeDefined();
    expect(isValidMongoURI(uri)).toBe(true);
  });
  
  // Test the database connection
  test('Can connect to MongoDB', async () => {
    // Skip test if no valid MongoDB URI is found
    if (!isValidMongoURI(process.env.MONGODB_URI)) {
      return;
    }
    
    await connectToDatabase();
    expect(isDatabaseConnected()).toBe(true);
    
    const status = getDatabaseConnectionStatus();
    expect(status.connected).toBe(true);
    expect(status.error).toBeNull();
  });
  
  // Test the triangle mesh model
  describe('Triangle Mesh Model Operations', () => {
    // Skip all model tests if no valid MongoDB URI is found
    beforeAll(() => {
      if (!isValidMongoURI(process.env.MONGODB_URI)) {
        console.warn('Skipping model tests - no valid MongoDB URI found');
        return;
      }
      
      // Ensure we're connected to the database
      return connectToDatabase();
    });
    
    // Clean up after the model tests
    afterAll(async () => {
      // Skip cleanup if no valid MongoDB URI is found
      if (!isValidMongoURI(process.env.MONGODB_URI)) {
        return;
      }
      
      // Clean up test data
      await TriangleMeshModel.deleteMany({});
    });
    
    // Test creating a triangle mesh document
    test('Can create a triangle mesh document', async () => {
      // Skip test if no valid MongoDB URI is found
      if (!isValidMongoURI(process.env.MONGODB_URI)) {
        return;
      }
      
      // Create test triangle mesh
      const testMesh = await createTestTriangleMesh();
      
      // Verify the document was created
      expect(testMesh).toBeDefined();
      expect(testMesh._id).toBeDefined();
      expect(testMesh.vertices.length).toBe(INITIAL_VERTICES.length);
      expect(testMesh.faces.length).toBe(INITIAL_FACES.length);
      
      // Clean up the test document
      await TriangleMeshModel.deleteOne({ _id: testMesh._id });
    });
    
    // Test finding triangle mesh documents
    test('Can query triangle mesh documents', async () => {
      // Skip test if no valid MongoDB URI is found
      if (!isValidMongoURI(process.env.MONGODB_URI)) {
        return;
      }
      
      // Create test triangle mesh
      const testMesh = await createTestTriangleMesh();
      
      // Query for documents
      const findResult = await TriangleMeshModel.findById(testMesh._id);
      
      // Verify the query result
      expect(findResult).toBeDefined();
      expect(findResult?._id.toString()).toBe(testMesh._id.toString());
      
      // Clean up the test document
      await TriangleMeshModel.deleteOne({ _id: testMesh._id });
    });
    
    // Test updating triangle mesh documents
    test('Can update triangle mesh documents', async () => {
      // Skip test if no valid MongoDB URI is found
      if (!isValidMongoURI(process.env.MONGODB_URI)) {
        return;
      }
      
      // Create test triangle mesh
      const testMesh = await createTestTriangleMesh();
      
      // Update a face's click count
      testMesh.faces[0].clickCount = 5;
      testMesh.faces[0].color = 'gray';
      await testMesh.save();
      
      // Query for the updated document
      const updatedMesh = await TriangleMeshModel.findById(testMesh._id);
      
      // Verify the update
      expect(updatedMesh).toBeDefined();
      expect(updatedMesh?.faces[0].clickCount).toBe(5);
      expect(updatedMesh?.faces[0].color).toBe('gray');
      
      // Clean up the test document
      await TriangleMeshModel.deleteOne({ _id: testMesh._id });
    });
  });
  
  // Test error handling
  describe('Error Handling', () => {
    test('Handles invalid MongoDB URI', async () => {
      // Save the original URI
      const originalURI = process.env.MONGODB_URI;
      
      try {
        // Set an invalid URI
        process.env.MONGODB_URI = 'invalid-uri';
        
        // Attempt to connect
        await expect(connectToDatabase()).rejects.toThrow();
        
        // Check connection status
        const status = getDatabaseConnectionStatus();
        expect(status.connected).toBe(false);
        expect(status.error).not.toBeNull();
      } finally {
        // Restore the original URI
        process.env.MONGODB_URI = originalURI;
      }
    });
  });
});

