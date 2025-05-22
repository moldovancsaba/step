import { Schema, Document, models, model } from 'mongoose';

/**
 * Interface for the Message document
 */
export interface IMessage extends Document {
  text: string;
  timestamp: Date;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Schema for the Message model with timestamp support
 */
const MessageSchema = new Schema<IMessage>(
  {
    text: {
      type: String,
      required: [true, 'Message text is required'],
      trim: true,
    },
    timestamp: {
      type: Date,
      required: true,
      default: Date.now,
    },
  },
  {
    // Add timestamps for createdAt and updatedAt
    timestamps: true,
    // Configure toJSON method to format dates in ISO8601
    toJSON: {
      virtuals: true,
      getters: true,
      transform: (_, ret) => {
        ret.id = ret._id;
        delete ret._id;
        delete ret.__v;
        
        // Ensure ISO8601 format with milliseconds for all date fields
        if (ret.timestamp) {
          ret.timestamp = new Date(ret.timestamp).toISOString();
        }
        if (ret.createdAt) {
          ret.createdAt = new Date(ret.createdAt).toISOString();
        }
        if (ret.updatedAt) {
          ret.updatedAt = new Date(ret.updatedAt).toISOString();
        }
        
        return ret;
      },
    },
  }
);

/**
 * Add a virtual property for formatted timestamp (ISO8601 with milliseconds)
 */
MessageSchema.virtual('formattedTimestamp').get(function() {
  return this.timestamp ? this.timestamp.toISOString() : null;
});

/**
 * Helper method to format the timestamp in ISO8601
 */
MessageSchema.methods.getFormattedTimestamp = function(): string {
  return this.timestamp.toISOString();
};

/**
 * Create or retrieve the Message model
 * Using models.Message || model pattern prevents model overwrite errors during hot reloading
 */
const Message = models.Message || model<IMessage>('Message', MessageSchema);

export default Message;

