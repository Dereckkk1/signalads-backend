import { Schema, model, Document, Types } from 'mongoose';

// Interface para agendamento de inserções
export interface ISchedule {
  [date: string]: number; // { "2025-12-15": 3, "2025-12-16": 2 }
}

// Interface para material enviado
export interface IMaterial {
  type: 'audio' | 'script' | 'text' | 'recording';

  // Campos para áudio
  audioUrl?: string;
  audioFileName?: string;
  audioFileSize?: number;
  audioDuration?: number;

  // Campos para roteiro (arquivo)
  scriptUrl?: string;
  scriptFileName?: string;
  scriptFileSize?: number;

  // Campos para texto
  text?: string; // Usado para type='text'
  wordCount?: number;
  textDuration?: number;

  // Campos para gravação (recording)
  script?: string; // Conteúdo do roteiro
  phonetic?: string;
  voiceGender?: string;
  musicStyle?: string;
  aiGeneration?: boolean;
  contentHash?: string;

  uploadedAt?: Date;
}

// Interface para inserção de patrocínio no carrinho
export interface ICartSponsorshipInsertion {
  name: string;
  duration: number;
  quantityPerDay: number;
  requiresMaterial: boolean;
}

// Interface para item do carrinho
export interface ICartItem {
  productId: Types.ObjectId;
  productName: string;
  productSchedule: string;
  broadcasterId: Types.ObjectId;
  broadcasterName: string;
  broadcasterDial: string;
  broadcasterBand: string;
  broadcasterLogo: string;
  broadcasterCity: string;
  price: number;
  quantity: number;
  duration: number; // Duração do spot em segundos
  schedule?: ISchedule;
  material?: IMaterial;
  addedAt: Date;
  // Campos de Patrocínio
  itemType?: 'product' | 'sponsorship';
  selectedMonth?: string;                        // "2026-04" (YYYY-MM) — primeiro mês selecionado
  selectedMonths?: string[];                     // Array de meses selecionados (multi-mês)
  programDaysInMonth?: number;                    // Dias do programa no(s) mês(es) selecionado(s)
  daysOfWeek?: number[];                         // Dias da semana do programa [0-6]
  sponsorshipInsertions?: ICartSponsorshipInsertion[];  // Snapshot das inserções do patrocínio
  sponsorshipMaterials?: Record<string, IMaterial>;     // Material por tipo de inserção (key = insertion name)
}

export interface ICart extends Document {
  userId: Types.ObjectId;
  items: ICartItem[];
  lastUpdated: Date;
  createdAt: Date;
}

const scheduleSchema = new Schema({
  // Datas dinâmicas: chave = data ISO, valor = quantidade
}, { strict: false, _id: false });

const materialSchema = new Schema({
  type: {
    type: String,
    enum: ['audio', 'script', 'text', 'recording'],
    required: true
  },
  // Áudio
  audioUrl: String,
  audioFileName: String,
  audioFileSize: Number,
  audioDuration: Number,
  // Roteiro (Arquivo)
  scriptUrl: String,
  scriptFileName: String,
  scriptFileSize: Number,
  // Texto
  text: String,
  wordCount: Number,
  textDuration: Number,

  // Campos para gravação (recording)
  script: String,
  phonetic: String,
  voiceGender: String,
  musicStyle: String,
  aiGeneration: Boolean,
  contentHash: String,

  uploadedAt: {
    type: Date,
    default: Date.now
  }
}, { _id: false });

const sponsorshipInsertionSchema = new Schema({
  name: { type: String, required: true },
  duration: { type: Number, default: 0 },
  quantityPerDay: { type: Number, required: true, min: 1 },
  requiresMaterial: { type: Boolean, default: false }
}, { _id: false });

const cartItemSchema = new Schema({
  productId: {
    type: Schema.Types.ObjectId,
    ref: 'Product',
    required: true // Armazena sponsorshipId quando itemType='sponsorship'
  },
  productName: {
    type: String,
    required: true
  },
  productSchedule: {
    type: String,
    required: true
  },
  broadcasterId: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  broadcasterName: String,
  broadcasterDial: String,
  broadcasterBand: String,
  broadcasterLogo: String,
  broadcasterCity: String,
  price: {
    type: Number,
    required: true
  },
  quantity: {
    type: Number,
    required: true,
    min: 1
  },
  duration: {
    type: Number,
    required: false // Opcional para compatibilidade com dados antigos
  },
  schedule: {
    type: Map,
    of: Number,
    default: {}
  },
  material: materialSchema,
  addedAt: {
    type: Date,
    default: Date.now
  },
  // Campos de Patrocínio
  itemType: {
    type: String,
    enum: ['product', 'sponsorship'],
    default: 'product'
  },
  selectedMonth: String,           // "2026-04" (YYYY-MM) — primeiro mês
  selectedMonths: [String],        // Array de meses selecionados
  programDaysInMonth: Number,      // Dias do programa no(s) mês(es)
  daysOfWeek: [Number],            // Dias da semana do programa [0-6]
  sponsorshipInsertions: [sponsorshipInsertionSchema],
  sponsorshipMaterials: {
    type: Map,
    of: materialSchema,
    default: undefined
  }
}, { _id: false });

const cartSchema = new Schema<ICart>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true
    },
    items: [cartItemSchema],
    lastUpdated: {
      type: Date,
      default: Date.now
    }
  },
  {
    timestamps: true
  }
);

// Index para buscar carrinho por usuário
cartSchema.index({ userId: 1 });

// Atualizar lastUpdated automaticamente
cartSchema.pre('save', function () {
  this.lastUpdated = new Date();
});

export const Cart = model<ICart>('Cart', cartSchema);
