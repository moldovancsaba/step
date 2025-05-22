import mongoose, { Document, Schema } from 'mongoose';

// Define the interface for the Example document
export interface IExample extends Document {
  title: string;
  description: string;
  completed: boolean;
  createdAt: Date;
  updatedAt: Date;
}

// Define the schema
const ExampleSchema = new Schema<IExample>(
  {
    title: {
      type: String,
      required: [true, 'Title is required'],
      trim: true,
      maxlength: [100, 'Title cannot be more than 100 characters'],
    },
    description: {
      type: String,
      required: false,
      trim: true,
      maxlength: [500, 'Description cannot be more than 500 characters'],
    },
    completed: {
      type: Boolean,
      default: false,
    },
  },
  {
    // Add timestamps for createdAt and updatedAt
    timestamps: true,
    // Convert _id to id in JSON responses
    toJSON: {
      virtuals: true,
      transform: (_, ret) => {
        ret.id = ret._id;
        delete ret._id;
        delete ret.__v;
        return ret;
      },
    },
  }
);

// Create or retrieve the model
export default mongoose.models.Example || mongoose.model<IExample>('Example', ExampleSchema);

