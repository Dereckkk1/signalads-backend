import { Schema, model, Document } from 'mongoose';

export interface IBlockedDomain extends Document {
  domain: string;
  reason?: string;
  createdBy: Schema.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const blockedDomainSchema = new Schema<IBlockedDomain>(
  {
    domain: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    reason: {
      type: String,
      trim: true,
    },
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
  },
  { timestamps: true }
);

export default model<IBlockedDomain>('BlockedDomain', blockedDomainSchema);
