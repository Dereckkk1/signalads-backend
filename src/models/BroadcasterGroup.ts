import mongoose, { Schema, Document } from 'mongoose';

// Chaves de permissão de telas disponíveis para sub-usuários
export type PagePermission =
  | 'dashboard'
  | 'campaigns'
  | 'calendar'
  | 'products'
  | 'sales_team'
  | 'proposals'
  | 'clients'
  | 'goals'
  | 'reports';

export const ALL_PAGE_PERMISSIONS: PagePermission[] = [
  'dashboard',
  'campaigns',
  'calendar',
  'products',
  'sales_team',
  'proposals',
  'clients',
  'goals',
  'reports'
];

// Permissões padrão para sub-usuários sem grupo atribuído
export const DEFAULT_SALES_PERMISSIONS: PagePermission[] = ['proposals', 'clients'];

export interface IBroadcasterGroup extends Document {
  name: string;
  broadcasterId: mongoose.Types.ObjectId; // ID do manager (usuario principal da emissora)
  permissions: PagePermission[];
  createdAt: Date;
  updatedAt: Date;
}

const BroadcasterGroupSchema = new Schema<IBroadcasterGroup>(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 100
    },
    broadcasterId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },
    permissions: {
      type: [String],
      enum: ALL_PAGE_PERMISSIONS,
      default: []
    }
  },
  { timestamps: true }
);

BroadcasterGroupSchema.index({ broadcasterId: 1, name: 1 });

const BroadcasterGroup = mongoose.model<IBroadcasterGroup>('BroadcasterGroup', BroadcasterGroupSchema);
export default BroadcasterGroup;
