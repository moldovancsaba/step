const mongoose = require('mongoose');

// MongoDB connection test
async function verifySetup() {
  try {
    const MONGODB_URI = process.env.MONGODB_URI;
    if (!MONGODB_URI) {
      throw new Error('MONGODB_URI environment variable is not set');
    }

    console.log('Attempting to connect to MongoDB...');
    
    // Connect to MongoDB
    await mongoose.connect(MONGODB_URI, {
      bufferCommands: false,
    });

    console.log('✓ Connected to MongoDB Atlas');

    // Create a test collection
    const Test = mongoose.model('Test', new mongoose.Schema({
      name: String,
      timestamp: { type: Date, default: Date.now }
    }));

    // Create a test document
    const testDoc = new Test({ name: 'connection_test' });
    await testDoc.save();
    console.log('✓ Test document created successfully');

    // Clean up
    await Test.deleteOne({ _id: testDoc._id });
    console.log('✓ Test cleanup completed');

    return { success: true };
  } catch (error) {
    console.error('MongoDB connection test failed:', error);
    return { success: false, error };
  } finally {
    // Close the connection
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
      console.log('MongoDB connection closed');
    }
  }
}

module.exports = { verifySetup };

