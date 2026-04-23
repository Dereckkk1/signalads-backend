import mongoose, { Schema, Document } from 'mongoose';

export interface IBroadcasterPaymentTag extends Document {
  broadcasterId: mongoose.Types.ObjectId;
  label: string;
  createdBy?: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const BroadcasterPaymentTagSchema = new Schema<IBroadcasterPaymentTag>({
  broadcasterId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  label: { type: String, required: true, trim: true, maxlength: 60 },
  createdBy: { type: Schema.Types.ObjectId, ref: 'User' }
}, {
  timestamps: true
});

BroadcasterPaymentTagSchema.index({ broadcasterId: 1, label: 1 }, { unique: true });

export default mongoose.model<IBroadcasterPaymentTag>('BroadcasterPaymentTag', BroadcasterPaymentTagSchema);
