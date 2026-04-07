import { Schema, model, Document, Types } from 'mongoose';
import { PLATFORM_COMMISSION_RATE } from './Product';

export interface ISponsorshipInsertion {
  name: string;           // Nome livre: "Citação", "Spot 30s", "Vinheta", etc
  duration: number;       // Duração em segundos (0 para citação/menção)
  quantityPerDay: number; // Quantas inserções por dia do programa
  requiresMaterial: boolean; // true para comerciais, false para testemunhais/citações
}

export interface ISponsorship extends Document {
  broadcasterId: Types.ObjectId;
  programName: string;
  description?: string;
  timeRange: {
    start: string; // "14:00"
    end: string;   // "15:00"
  };
  daysOfWeek: number[];              // [1,2,3,4,5] (0=Dom..6=Sab)
  insertions: ISponsorshipInsertion[];
  announcer?: string;                // Preparado para uso futuro
  netPrice: number;                  // Preço líquido mensal da emissora
  pricePerMonth: number;             // netPrice * 1.25 (preço marketplace)
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const sponsorshipInsertionSchema = new Schema<ISponsorshipInsertion>(
  {
    name: {
      type: String,
      required: true,
      trim: true
    },
    duration: {
      type: Number,
      required: true,
      min: 0,
      default: 0
    },
    quantityPerDay: {
      type: Number,
      required: true,
      min: 1
    },
    requiresMaterial: {
      type: Boolean,
      default: false
    }
  },
  { _id: false }
);

const sponsorshipSchema = new Schema<ISponsorship>(
  {
    broadcasterId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    programName: {
      type: String,
      required: true,
      trim: true
    },
    description: {
      type: String,
      trim: true
    },
    timeRange: {
      start: {
        type: String,
        required: true
      },
      end: {
        type: String,
        required: true
      }
    },
    daysOfWeek: {
      type: [Number],
      required: true,
      validate: {
        validator: (v: number[]) => v.length > 0 && v.every(d => d >= 0 && d <= 6),
        message: 'daysOfWeek deve ter pelo menos 1 dia (valores de 0 a 6)'
      }
    },
    insertions: {
      type: [sponsorshipInsertionSchema],
      required: true,
      validate: {
        validator: (v: ISponsorshipInsertion[]) => v.length > 0,
        message: 'Patrocínio deve ter pelo menos 1 inserção'
      }
    },
    announcer: {
      type: String,
      trim: true
    },
    netPrice: {
      type: Number,
      required: true,
      min: 0
    },
    pricePerMonth: {
      type: Number,
      min: 0,
      default: 0
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

// ─── Índices de Performance ───────────────────────────────────────────────

// Patrocínios ativos de uma emissora (query principal)
sponsorshipSchema.index({ broadcasterId: 1, isActive: 1 });

// Filtro de preço no marketplace
sponsorshipSchema.index({ isActive: 1, pricePerMonth: 1 });

// Middleware para calcular preço bruto antes de salvar
sponsorshipSchema.pre('save', function () {
  if (this.isModified('netPrice') && this.netPrice > 0) {
    this.pricePerMonth = Math.round(this.netPrice * (1 + PLATFORM_COMMISSION_RATE) * 100) / 100;
  }
});

export const Sponsorship = model<ISponsorship>('Sponsorship', sponsorshipSchema);
