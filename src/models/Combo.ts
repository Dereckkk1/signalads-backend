import { Schema, model, Document, Types } from 'mongoose';

export type ComboItemType = 'product' | 'sponsorship';
export type ComboDiscountType = 'percentage' | 'fixed';

export interface IComboItem {
  itemType: ComboItemType;
  productId?: Types.ObjectId;      // referencia Product quando itemType === 'product'
  sponsorshipId?: Types.ObjectId;  // referencia Sponsorship quando itemType === 'sponsorship'
  defaultQuantity: number;         // qtd default de inserções (produto) ou meses (patrocinio)
  defaultDiscountType?: ComboDiscountType;
  defaultDiscountValue?: number;   // 0 = sem desconto
  isBonification?: boolean;        // item oferecido como bonificação
}

export interface ICombo extends Document {
  broadcasterId: Types.ObjectId;
  name: string;
  description?: string;
  items: IComboItem[];
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const comboItemSchema = new Schema<IComboItem>(
  {
    itemType: {
      type: String,
      enum: ['product', 'sponsorship'],
      required: true
    },
    productId: {
      type: Schema.Types.ObjectId,
      ref: 'Product'
    },
    sponsorshipId: {
      type: Schema.Types.ObjectId,
      ref: 'Sponsorship'
    },
    defaultQuantity: {
      type: Number,
      required: true,
      min: 1,
      default: 1
    },
    defaultDiscountType: {
      type: String,
      enum: ['percentage', 'fixed'],
      default: 'percentage'
    },
    defaultDiscountValue: {
      type: Number,
      min: 0,
      default: 0
    },
    isBonification: {
      type: Boolean,
      default: false
    }
  },
  { _id: false }
);

const comboSchema = new Schema<ICombo>(
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
      maxlength: 120
    },
    description: {
      type: String,
      trim: true,
      maxlength: 500
    },
    items: {
      type: [comboItemSchema],
      required: true,
      validate: {
        validator: (v: IComboItem[]) => v.length > 0,
        message: 'Combo deve ter pelo menos 1 item'
      }
    },
    isActive: {
      type: Boolean,
      default: true
    }
  },
  { timestamps: true }
);

comboSchema.index({ broadcasterId: 1, isActive: 1, createdAt: -1 });

export const Combo = model<ICombo>('Combo', comboSchema);
export default Combo;
