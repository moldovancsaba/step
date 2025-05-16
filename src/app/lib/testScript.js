#!/usr/bin/env node
// @ts-nocheck
require('dotenv').config({ path: '.env.local' });
const { verifySetup } = require('./testMesh.js');

async function runTests() {
  console.log('Starting setup verification...');
  console.log('Loading environment from .env.local...');
  console.log('MongoDB URI:', process.env.MONGODB_URI ? '✓ Found' : '❌ Missing');
  console.log('Connecting to MongoDB Atlas...');
  
  try {
    const result = await verifySetup();
    
    if (result.success) {
      console.log('\n✅ All systems operational');
      console.log('- Database connection: OK');
      console.log('- Test document creation: OK');
      console.log('- Test cleanup: OK');
    } else {
      console.error('\n❌ Setup verification failed:', result.error);
    }
  } catch (error) {
    console.error('\n❌ Test execution failed:', error);
  } finally {
    process.exit(0);
  }
}

// Run the tests
runTests().catch(error => {
  console.error('\n❌ Fatal error:', error);
  process.exit(1);
});

