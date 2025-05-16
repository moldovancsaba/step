// @ts-nocheck
const { connectToDatabase } = require('./db');
const { TriangleMeshModel } = require('./models');
const { createInitialMesh } = require('../types/geometry');

async function verifySetup() {
  try {
    // Test database connection
    const conn = await connectToDatabase();
    console.log('✓ Database connection successful');

    // Test mesh initialization
    const initialMesh = createInitialMesh();
    const meshDoc = new TriangleMeshModel({
      vertices: initialMesh.vertices,
      faces: initialMesh.faces
    });
    
    await meshDoc.save();
    console.log('✓ Test mesh saved successfully');

    return { success: true };
  } catch (error) {
    console.error('Setup verification failed:', error);
    return { success: false, error };
  }
}

module.exports = { verifySetup };

