import mongoose, { Schema, Document } from 'mongoose';
import { getNextSequence } from './Counter';

/**
 * QuoteRequest - Solicitação de Contato Comercial
 * 
 * Substitui o modelo Order complexo com pagamentos
 * Agora é apenas uma solicitação que o admin recebe para processar manualmente
 */

export interface IQuoteRequestItem {
  productId: string;
  productName: string;
  broadcasterName: string;
  broadcasterId: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;

  // Cronograma de veiculação
  schedule: Map<string, number>; // { 'YYYY-MM-DD': quantity }

  // Material publicitário enviado pelo cliente
  material: {
    type: 'audio' | 'script' | 'text' | 'recording';

    // Áudio pronto
    audioUrl?: string;
    audioFileName?: string;
    audioDuration?: number;

    // Roteiro para emissora produzir
    scriptUrl?: string;
    scriptFileName?: string;

    // Texto para locução
    text?: string;
    textDuration?: number;

    // Gravação
    script?: string;
    phonetic?: string;
    voiceGender?: string;
    musicStyle?: string;
    aiGeneration?: boolean;
    contentHash?: string;
  };
}

export interface IQuoteRequest extends Document {
  // Numeração sequencial para fácil identificação
  requestNumber: string; // Ex: REQ-000001

  // Cliente solicitante
  buyer: mongoose.Types.ObjectId;
  buyerName: string;
  buyerEmail: string;
  buyerPhone?: string;
  buyerType: 'advertiser' | 'agency';

  // Itens da solicitação
  items: IQuoteRequestItem[];

  // Valores totais (apenas para referência, sem splits)
  totalValue: number; // Soma simples de todos os items

  // Status da solicitação
  status: 'pending' | 'contacted' | 'negotiating' | 'converted' | 'rejected';

  // Observações do cliente
  clientNotes?: string;

  // Anotações internas do admin
  adminNotes?: string;

  // Histórico de status
  statusHistory: {
    status: string;
    changedBy: mongoose.Types.ObjectId;
    changedAt: Date;
    notes?: string;
  }[];

  // Datas
  createdAt: Date;
  updatedAt: Date;
  contactedAt?: Date; // Quando admin marcou como "contatado"
  convertedAt?: Date; // Quando virou venda real
  rejectedAt?: Date;
}

const quoteRequestItemSchema = new Schema({
  productId: {
    type: String,
    required: true
  },
  productName: {
    type: String,
    required: true
  },
  broadcasterName: {
    type: String,
    required: true
  },
  broadcasterId: {
    type: String,
    required: true
  },
  quantity: {
    type: Number,
    required: true
  },
  unitPrice: {
    type: Number,
    required: true
  },
  totalPrice: {
    type: Number,
    required: true
  },
  schedule: {
    type: Map,
    of: Number,
    default: {}
  },
  material: {
    type: {
      type: String,
      enum: ['audio', 'script', 'text', 'recording'],
      required: true
    },
    audioUrl: String,
    audioFileName: String,
    audioDuration: Number,
    scriptUrl: String,
    scriptFileName: String,
    text: String,
    textDuration: Number,

    // Gravação
    script: String,
    phonetic: String,
    voiceGender: String,
    musicStyle: String,
    aiGeneration: Boolean,
    contentHash: String
  }
}, { _id: false });

const quoteRequestSchema = new Schema({
  requestNumber: {
    type: String,
    required: true,
    unique: true
  },
  buyer: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  buyerName: {
    type: String,
    required: true
  },
  buyerEmail: {
    type: String,
    required: true
  },
  buyerPhone: String,
  buyerType: {
    type: String,
    enum: ['advertiser', 'agency'],
    required: true
  },
  items: [quoteRequestItemSchema],
  totalValue: {
    type: Number,
    required: true
  },
  status: {
    type: String,
    enum: ['pending', 'contacted', 'negotiating', 'converted', 'rejected'],
    default: 'pending'
  },
  clientNotes: String,
  adminNotes: String,
  statusHistory: [{
    status: String,
    changedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User'
    },
    changedAt: {
      type: Date,
      default: Date.now
    },
    notes: String
  }],
  contactedAt: Date,
  convertedAt: Date,
  rejectedAt: Date
}, {
  timestamps: true
});

// Auto-incremento para requestNumber (atomico via Counter)
quoteRequestSchema.pre('save', async function () {
  if (this.isNew) {
    const seq = await getNextSequence('quoteRequest');
    this.requestNumber = `REQ-${String(seq).padStart(6, '0')}`;

    // Adiciona primeiro item no histórico
    this.statusHistory.push({
      status: this.status,
      changedBy: this.buyer,
      changedAt: new Date(),
      notes: 'Solicitação criada'
    });
  }
});

// Indexes de performance
quoteRequestSchema.index({ buyer: 1, createdAt: -1 }); // "Minhas solicitacoes"
quoteRequestSchema.index({ status: 1, createdAt: -1 }); // Admin: filtro por status
quoteRequestSchema.index({ requestNumber: 1 }); // Busca direta (ja unique, explicita index)

const QuoteRequest = mongoose.model<IQuoteRequest>('QuoteRequest', quoteRequestSchema);

export default QuoteRequest;
