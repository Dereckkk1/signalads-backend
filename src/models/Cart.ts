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

const cartItemSchema = new Schema({
  productId: {
    type: Schema.Types.ObjectId,
    ref: 'Product',
    required: true
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
