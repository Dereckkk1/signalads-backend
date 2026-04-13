import { Schema, model, Document, Types } from 'mongoose';

export interface IProduct extends Document {
  broadcasterId: Types.ObjectId;
  name?: string;              // Nome livre da inserção (ex: "Manhã", "Horário Nobre")
  spotType: string;           // "Comercial 5s", "Manhã 30s", etc. (legado + gerado)
  duration: number;           // Duração em segundos (qualquer valor positivo)
  timeSlot: string;           // Slot de horário legado ou faixa gerada "HH:MM-HH:MM"
  timeRange?: {               // Faixa horária explícita
    start: string;            // "06:00"
    end: string;              // "12:00"
  };
  daysOfWeek?: number[];      // [1,2,3,4,5] — 0=Dom, 6=Sab (opcional)
  netPrice: number;           // Preço líquido que a emissora recebe
  pricePerInsertion: number;  // Preço bruto (netPrice * 1.25) exibido no marketplace
  isActive: boolean;
  manuallyEdited: boolean;
  broadcasterSharePercent: number; // Legado
  platformSharePercent: number;    // Legado
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
    name: {
      type: String,
      trim: true
    },
    spotType: {
      type: String,
      required: true
      // enum removido: suporta spotTypes legados e novos customizados
    },
    duration: {
      type: Number,
      required: true,
      min: 1
      // enum removido: suporta qualquer duração em segundos
    },
    timeSlot: {
      type: String,
      required: true
    },
    timeRange: {
      type: {
        start: { type: String, required: true },
        end: { type: String, required: true }
      },
      default: undefined
    },
    daysOfWeek: {
      type: [Number],
      default: undefined
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

productSchema.index({ broadcasterId: 1, isActive: 1 });
productSchema.index({ broadcasterId: 1, spotType: 1, isActive: 1 });
productSchema.index({ isActive: 1, pricePerInsertion: 1 });
productSchema.index({ broadcasterId: 1, isActive: 1, createdAt: -1 });

// Taxa de comissão da plataforma (25% sobre o preço líquido da emissora)
export const PLATFORM_COMMISSION_RATE = 0.25;

// Middleware: extrai duração do spotType (legado) e calcula preço bruto
productSchema.pre('save', function () {
  // Extrai duração do spotType apenas se duration não foi definido explicitamente
  if (this.isModified('spotType') && !this.isModified('duration')) {
    const match = this.spotType.match(/(\d+)s/);
    if (match && match[1]) {
      this.duration = parseInt(match[1], 10);
    }
  }

  // Calcula pricePerInsertion a partir de netPrice
  if (this.isModified('netPrice') && this.netPrice > 0) {
    this.pricePerInsertion = Math.round(this.netPrice * (1 + PLATFORM_COMMISSION_RATE) * 100) / 100;
  }
});

export const Product = model<IProduct>('Product', productSchema);
