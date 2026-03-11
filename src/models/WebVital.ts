import { Schema, model, Document } from 'mongoose';

export interface IWebVital extends Document {
  name: string;
  value: number;
  rating: string;
  page: string;
  timestamp: Date;
}

const webVitalSchema = new Schema<IWebVital>(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    value: {
      type: Number,
      required: true,
    },
    rating: {
      type: String,
      enum: ['good', 'needs-improvement', 'poor', 'unknown'],
      default: 'unknown',
    },
    page: {
      type: String,
      default: 'unknown',
      trim: true,
    },
    timestamp: {
      type: Date,
      default: Date.now,
      required: true,
    },
  },
  { timestamps: false }
);

// TTL: auto-remove após 90 dias
webVitalSchema.index({ timestamp: 1 }, { expireAfterSeconds: 7_776_000 });

// Queries por tipo de vital + período
webVitalSchema.index({ name: 1, timestamp: -1 });

// Queries por página + período
webVitalSchema.index({ page: 1, timestamp: -1 });

export default model<IWebVital>('WebVital', webVitalSchema);
