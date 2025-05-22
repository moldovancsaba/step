import { NextRequest, NextResponse } from 'next/server';
import { connectToDatabase } from '@/lib/mongodb';
import Message from '@/models/Message';

// GET function to retrieve the message
export async function GET() {
  try {
    // Connect to the database
    await connectToDatabase();
    
    // Find the first message or create a default one if none exists
    let message = await Message.findOne().sort({ createdAt: -1 });
    
    if (!message) {
      // Create a default message if none exists
      message = await Message.create({ text: 'Hello World from MongoDB Atlas!' });
    }
    
    // Return the message
    return NextResponse.json({ message: message.text }, { status: 200 });
  } catch (error) {
    console.error('Database error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch message from database' },
      { status: 500 }
    );
  }
}

// POST function to create a new message
export async function POST(request: NextRequest) {
  try {
    // Connect to the database
    await connectToDatabase();
    
    // Get the request body
    const body = await request.json();
    
    // Validate request body
    if (!body.text) {
      return NextResponse.json(
        { error: 'Message text is required' },
        { status: 400 }
      );
    }
    
    // Create a new message
    const message = await Message.create({ text: body.text });
    
    // Return the created message
    return NextResponse.json({ message: message.text }, { status: 201 });
  } catch (error) {
    console.error('Database error:', error);
    return NextResponse.json(
      { error: 'Failed to create message' },
      { status: 500 }
    );
  }
}

