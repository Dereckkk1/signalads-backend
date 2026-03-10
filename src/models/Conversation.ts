import mongoose, { Schema, Document } from 'mongoose';

export interface IMessage {
  senderId: string;
  senderName: string;
  senderType: 'advertiser' | 'agency' | 'broadcaster' | 'admin';
  message: string;
  attachments?: {
    type: 'audio' | 'image' | 'document';
    url: string;
    fileName: string;
    fileSize: number;
  }[];
  timestamp: Date;
  read: boolean;
}

export interface IConversation extends Document {
  // Participantes
  advertiserId: string;
  advertiserName: string;
  broadcasterId: string;
  broadcasterName: string;
  broadcasterLogo?: string;
  broadcasterDial?: string;
  broadcasterBand?: string;

  // Referência aos pedidos relacionados
  relatedOrders: string[];

  // Mensagens
  messages: IMessage[];

  // Última atividade
  lastMessageAt: Date;
  lastMessageBy: string;

  // Contador de não lidas por participante
  unreadCount: {
    advertiser: number;
    broadcaster: number;
  };

  // Conversa fixada/pinada (ex: Suporte)
  isPinned?: boolean;

  createdAt: Date;
  updatedAt: Date;
}

const MessageSchema = new Schema({
  senderId: { type: String, required: true },
  senderName: { type: String, required: true },
  senderType: {
    type: String,
    enum: ['advertiser', 'agency', 'broadcaster', 'admin'],
    required: true
  },
  message: { type: String, required: true },
  attachments: [{
    type: {
      type: String,
      enum: ['audio', 'image', 'document'],
      required: true
    },
    url: { type: String, required: true },
    fileName: { type: String, required: true },
    fileSize: { type: Number, required: true }
  }],
  timestamp: { type: Date, default: Date.now },
  read: { type: Boolean, default: false }
});

const ConversationSchema = new Schema({
  advertiserId: { type: String, required: true },
  advertiserName: { type: String, required: true },
  broadcasterId: { type: String, required: true },
  broadcasterName: { type: String, required: true },
  broadcasterLogo: { type: String },
  broadcasterDial: { type: String },
  broadcasterBand: { type: String },

  relatedOrders: [{ type: String }],

  messages: [MessageSchema],

  lastMessageAt: { type: Date, default: Date.now },
  lastMessageBy: { type: String },

  unreadCount: {
    advertiser: { type: Number, default: 0 },
    broadcaster: { type: Number, default: 0 }
  },

  // Conversa fixada/pinada (ex: Suporte)
  isPinned: { type: Boolean, default: false }
}, {
  timestamps: true
});

// ─── Índices de Performance ───────────────────────────────────────────────

// Busca de conversa entre dois usuários específicos (mais frequente)
ConversationSchema.index({ advertiserId: 1, broadcasterId: 1 }, { unique: true });

// Inbox — conversas ordenadas por última mensagem (sidebar de chat)
ConversationSchema.index({ advertiserId: 1, lastMessageAt: -1 });
ConversationSchema.index({ broadcasterId: 1, lastMessageAt: -1 });

// Conversas pinadas (suporte fixado no topo)
ConversationSchema.index({ advertiserId: 1, isPinned: -1, lastMessageAt: -1 });

export const Conversation = mongoose.model<IConversation>('Conversation', ConversationSchema);
