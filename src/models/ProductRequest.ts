import { Schema, model, Document, Types } from 'mongoose';

export interface IProductRequestItem {
  spotType: string;
  timeSlot: string;
  pricePerInsertion: number;
  // Preenchidos pelo admin na aprovação
  adminPrice?: number;
  broadcasterShare?: number;  // % para a emissora (ex: 80)
  platformShare?: number;     // % para a plataforma (ex: 20)
}

export interface IProductRequest extends Document {
  broadcasterId: Types.ObjectId;
  type: 'create' | 'edit' | 'delete';
  status: 'pending' | 'approved' | 'rejected';

  // Para criação: lista de produtos novos
  items: IProductRequestItem[];

  // Para edição/exclusão: referência ao produto existente
  productId?: Types.ObjectId;
  editedFields?: Partial<IProductRequestItem>;

  // Admin
  adminNotes?: string;
  rejectionReason?: string;
  reviewedBy?: Types.ObjectId;
  reviewedAt?: Date;

  // Aviso de edição pelo admin
  adminEdited?: boolean;
  adminEditMessage?: string;

  createdAt: Date;
  updatedAt: Date;
}

const productRequestItemSchema = new Schema<IProductRequestItem>(
  {
    spotType: {
      type: String,
      required: true,
      enum: [
        'Comercial 5s',
        'Comercial 10s',
        'Comercial 15s',
        'Comercial 30s',
        'Comercial 45s',
        'Comercial 60s',
        'Testemunhal 30s',
        'Testemunhal 60s'
      ]
    },
    timeSlot: {
      type: String,
      required: true
    },
    pricePerInsertion: {
      type: Number,
      required: true,
      min: 0
    },
    adminPrice: {
      type: Number,
      min: 0
    },
    broadcasterShare: {
      type: Number,
      min: 0,
      max: 100
    },
    platformShare: {
      type: Number,
      min: 0,
      max: 100
    }
  },
  { _id: false }
);

const productRequestSchema = new Schema<IProductRequest>(
  {
    broadcasterId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    type: {
      type: String,
      required: true,
      enum: ['create', 'edit', 'delete']
    },
    status: {
      type: String,
      required: true,
      enum: ['pending', 'approved', 'rejected'],
      default: 'pending'
    },
    items: {
      type: [productRequestItemSchema],
      default: []
    },
    productId: {
      type: Schema.Types.ObjectId,
      ref: 'Product'
    },
    editedFields: {
      type: {
        spotType: String,
        timeSlot: String,
        pricePerInsertion: Number,
        adminPrice: Number,
        broadcasterShare: Number,
        platformShare: Number
      }
    },
    adminNotes: {
      type: String
    },
    rejectionReason: {
      type: String
    },
    reviewedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User'
    },
    reviewedAt: {
      type: Date
    },
    adminEdited: {
      type: Boolean,
      default: false
    },
    adminEditMessage: {
      type: String
    }
  },
  {
    timestamps: true
  }
);

productRequestSchema.index({ broadcasterId: 1, status: 1 });
productRequestSchema.index({ status: 1, type: 1 });

export const ProductRequest = model<IProductRequest>('ProductRequest', productRequestSchema);
