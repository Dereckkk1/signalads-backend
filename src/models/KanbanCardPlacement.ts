import { Schema, model, Document, Types } from 'mongoose';
import type { KanbanOwnerType, KanbanContext } from './KanbanBoard';

export type KanbanCardType = 'proposal' | 'order';

export interface IKanbanCardPlacement extends Document {
  ownerType: KanbanOwnerType;
  ownerId: Types.ObjectId | null;
  context: KanbanContext;
  cardType: KanbanCardType;
  cardId: Types.ObjectId;
  columnId: string;
  createdAt: Date;
  updatedAt: Date;
}

const kanbanCardPlacementSchema = new Schema<IKanbanCardPlacement>(
  {
    ownerType: {
      type: String,
      enum: ['broadcaster', 'agency', 'admin'],
      required: true,
    },
    ownerId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    context: {
      type: String,
      enum: ['proposals', 'orders'],
      required: true,
    },
    cardType: {
      type: String,
      enum: ['proposal', 'order'],
      required: true,
    },
    cardId: {
      type: Schema.Types.ObjectId,
      required: true,
    },
    columnId: {
      type: String,
      required: true,
    },
  },
  { timestamps: true }
);

kanbanCardPlacementSchema.index(
  { ownerType: 1, ownerId: 1, context: 1, cardId: 1 },
  { unique: true }
);
kanbanCardPlacementSchema.index({ cardId: 1, cardType: 1 });
kanbanCardPlacementSchema.index({ columnId: 1 });

export const KanbanCardPlacement = model<IKanbanCardPlacement>(
  'KanbanCardPlacement',
  kanbanCardPlacementSchema
);
