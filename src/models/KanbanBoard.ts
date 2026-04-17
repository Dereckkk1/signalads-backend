import { Schema, model, Document, Types } from 'mongoose';

export type KanbanOwnerType = 'broadcaster' | 'agency' | 'admin';
export type KanbanContext = 'proposals' | 'orders';

export interface ICustomKanbanColumn {
  _id: Types.ObjectId;
  name: string;
  color: string;
  icon: string;
  createdAt: Date;
  createdBy?: Types.ObjectId;
}

export interface IKanbanBoard extends Document {
  ownerType: KanbanOwnerType;
  ownerId: Types.ObjectId | null;
  context: KanbanContext;
  customColumns: ICustomKanbanColumn[];
  columnOrder: string[];
  createdAt: Date;
  updatedAt: Date;
}

const customColumnSchema = new Schema<ICustomKanbanColumn>(
  {
    name: { type: String, required: true, trim: true, maxlength: 40 },
    color: { type: String, required: true, match: /^#[0-9a-fA-F]{6}$/ },
    icon: { type: String, required: true, trim: true, maxlength: 40 },
    createdAt: { type: Date, default: Date.now },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { _id: true }
);

const kanbanBoardSchema = new Schema<IKanbanBoard>(
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
    customColumns: { type: [customColumnSchema], default: [] },
    columnOrder: { type: [String], default: [] },
  },
  { timestamps: true }
);

kanbanBoardSchema.index(
  { ownerType: 1, ownerId: 1, context: 1 },
  { unique: true }
);

export const KanbanBoard = model<IKanbanBoard>('KanbanBoard', kanbanBoardSchema);
