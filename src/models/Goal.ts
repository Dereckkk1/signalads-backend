import mongoose, { Document, Schema } from 'mongoose';

export interface IGoal extends Document {
  broadcasterOwnerId: mongoose.Types.ObjectId;
  type: 'general' | 'individual';
  sellerId?: mongoose.Types.ObjectId;
  sellerName?: string;
  targetValue: number;
  startDate: Date;
  endDate: Date;
  description?: string;
  createdAt: Date;
  updatedAt: Date;
}

const GoalSchema = new Schema<IGoal>(
  {
    broadcasterOwnerId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    type: {
      type: String,
      enum: ['general', 'individual'],
      required: true,
    },
    sellerId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
    },
    sellerName: {
      type: String,
      trim: true,
    },
    targetValue: {
      type: Number,
      required: true,
      min: 0,
    },
    startDate: {
      type: Date,
      required: true,
    },
    endDate: {
      type: Date,
      required: true,
    },
    description: {
      type: String,
      trim: true,
    },
  },
  { timestamps: true }
);

GoalSchema.index({ broadcasterOwnerId: 1, type: 1, startDate: -1 });
GoalSchema.index({ broadcasterOwnerId: 1, sellerId: 1 });

export default mongoose.model<IGoal>('Goal', GoalSchema);
