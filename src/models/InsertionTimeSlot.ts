import { Schema, model, Document, Types } from 'mongoose';

export interface IInsertionTimeSlot extends Document {
  broadcasterId: Types.ObjectId;
  name: string;           // Nome de exibição: "Manhã", "Tarde", "Noite"
  type: string;
  start?: string;         // "06:00" — para tipo 'determinado'
  end?: string;           // "12:00" — para tipo 'determinado'
  customLabel?: string;   // Texto livre — para tipo 'outro'
  createdAt: Date;
  updatedAt: Date;
}

const insertionTimeSlotSchema = new Schema<IInsertionTimeSlot>(
  {
    broadcasterId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 60
    },
    type: {
      type: String,
      required: true,
      trim: true,
      maxlength: 80
    },
    start: { type: String, trim: true },
    end:   { type: String, trim: true },
    customLabel: { type: String, trim: true, maxlength: 80 }
  },
  { timestamps: true }
);

insertionTimeSlotSchema.index({ broadcasterId: 1, createdAt: -1 });

export const InsertionTimeSlot = model<IInsertionTimeSlot>('InsertionTimeSlot', insertionTimeSlotSchema);
