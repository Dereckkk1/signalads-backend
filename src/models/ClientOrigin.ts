import mongoose, { Document, Schema } from 'mongoose';

export interface IClientOrigin extends Document {
  broadcasterId: mongoose.Types.ObjectId;
  name: string;
  createdAt: Date;
  updatedAt: Date;
}

const ClientOriginSchema: Schema = new Schema(
  {
    broadcasterId: { type: Schema.Types.ObjectId, ref: 'User', index: true, required: true },
    name: { type: String, required: true, trim: true },
  },
  { timestamps: true }
);

export default mongoose.model<IClientOrigin>('ClientOrigin', ClientOriginSchema);
