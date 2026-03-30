import { Schema, model, Document, Types } from 'mongoose';

export interface IProduct extends Document {
  broadcasterId: Types.ObjectId;
  spotType: string; // "Comercial 5s", "Comercial 10s", etc
  duration: number; // Duração em segundos (5, 10, 15, 30, 60)
  timeSlot: string; // "Rotativo", "Horário Nobre", "Indeterminado", "08:00-12:00"
  netPrice: number; // Preço líquido que a emissora recebe
  pricePerInsertion: number; // Preço bruto (netPrice * 1.25) exibido no marketplace
  isActive: boolean;
  manuallyEdited: boolean;
  broadcasterSharePercent: number; // Legado - mantido para compatibilidade
  platformSharePercent: number;    // Legado - mantido para compatibilidade
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
        'Comercial 45s',
        'Comercial 60s',
        'Testemunhal 30s',
        'Testemunhal 60s'
      ]
    },
    duration: {
      type: Number,
      required: true,
      enum: [5, 10, 15, 30, 45, 60]
    },
    timeSlot: {
      type: String,
      required: true
    },
    netPrice: {
      type: Number,
      min: 0,
      default: 0
    },
    pricePerInsertion: {
      type: Number,
      required: true,
      min: 0
    },
    isActive: {
      type: Boolean,
      default: true
    },
    manuallyEdited: {
      type: Boolean,
      default: false
    },
    broadcasterSharePercent: {
      type: Number,
      default: 80,
      min: 0,
      max: 100
    },
    platformSharePercent: {
      type: Number,
      default: 20,
      min: 0,
      max: 100
    }
  },
  {
    timestamps: true
  }
);

// ─── Índices de Performance ───────────────────────────────────────────────

// Produtos ativos de uma emissora (query principal do marketplace ao abrir emissora)
productSchema.index({ broadcasterId: 1, isActive: 1 });

// Busca por tipo de spot ativo (filtros no marketplace)
productSchema.index({ broadcasterId: 1, spotType: 1, isActive: 1 });
// Performance: filtro de preco no marketplace
productSchema.index({ isActive: 1, pricePerInsertion: 1 });
// Performance: ordenacao por data + broadcaster
productSchema.index({ broadcasterId: 1, isActive: 1, createdAt: -1 });

// Taxa de comissão da plataforma (25% sobre o preço líquido da emissora)
export const PLATFORM_COMMISSION_RATE = 0.25;

// Middleware para extrair duração e calcular preço bruto antes de salvar
productSchema.pre('save', function () {
  if (this.isModified('spotType')) {
    const match = this.spotType.match(/(\d+)s/);
    if (match && match[1]) {
      this.duration = parseInt(match[1], 10);
    }
  }

  // Se netPrice foi definido, calcula pricePerInsertion automaticamente
  if (this.isModified('netPrice') && this.netPrice > 0) {
    this.pricePerInsertion = Math.round(this.netPrice * (1 + PLATFORM_COMMISSION_RATE) * 100) / 100;
  }
});

export const Product = model<IProduct>('Product', productSchema);
