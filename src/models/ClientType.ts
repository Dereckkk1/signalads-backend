import mongoose, { Document, Schema } from 'mongoose';

export interface IClientType extends Document {
  broadcasterId: mongoose.Types.ObjectId;
  name: string;
  color: string;
  createdAt: Date;
  updatedAt: Date;
}

const ClientTypeSchema: Schema = new Schema(
  {
    broadcasterId: { type: Schema.Types.ObjectId, ref: 'User', index: true, required: true },
    name: { type: String, required: true, trim: true },
    color: { type: String, default: '#6366f1' },
  },
  { timestamps: true }
);

export default mongoose.model<IClientType>('ClientType', ClientTypeSchema);
