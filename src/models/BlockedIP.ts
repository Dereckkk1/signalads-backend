import { Schema, model, Document } from 'mongoose';

export interface IBlockedIP extends Document {
  ip: string;
  reason?: string;
  blockedAt: Date;
  blockedById?: string;
  blockedByEmail?: string;
}

const blockedIPSchema = new Schema<IBlockedIP>(
  {
    ip: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    reason: {
      type: String,
      trim: true,
    },
    blockedAt: {
      type: Date,
      default: Date.now,
      required: true,
    },
    blockedById: {
      type: String,
    },
    blockedByEmail: {
      type: String,
    },
  },
  { timestamps: false }
);

blockedIPSchema.index({ ip: 1 }, { unique: true });

export default model<IBlockedIP>('BlockedIP', blockedIPSchema);
