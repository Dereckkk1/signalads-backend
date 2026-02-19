import { Schema, model, Document, Types } from 'mongoose';

export interface IProduct extends Document {
  broadcasterId: Types.ObjectId;
  spotType: string; // "Comercial 5s", "Comercial 10s", etc
  duration: number; // Duração em segundos (5, 10, 15, 30, 60)
  timeSlot: string; // "Rotativo", "Horário Nobre", "Indeterminado", "08:00-12:00"
  pricePerInsertion: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const productSchema = new Schema<IProduct>(
  {
    broadcasterId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    spotType: {
      type: String,
      required: true,
      enum: [
        'Comercial 5s',
        'Comercial 10s',
        'Comercial 15s',
        'Comercial 30s',
        'Comercial 60s',
        'Testemunhal 30s',
        'Testemunhal 60s'
      ]
    },
    duration: {
      type: Number,
      required: true,
      enum: [5, 10, 15, 30, 60]
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
    isActive: {
      type: Boolean,
      default: true
    }
  },
  {
    timestamps: true
  }
);

// Index para buscar produtos por emissora
productSchema.index({ broadcasterId: 1, isActive: 1 });

// Middleware para extrair duração do spotType antes de salvar
productSchema.pre('save', function() {
  if (this.isModified('spotType')) {
    // Extrai número da string (ex: "Comercial 30s" -> 30)
    const match = this.spotType.match(/(\d+)s/);
    if (match && match[1]) {
      this.duration = parseInt(match[1], 10);
    }
  }
});

export const Product = model<IProduct>('Product', productSchema);
