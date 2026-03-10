import mongoose, { Schema, Document } from 'mongoose';

export interface IOrderItem {
  productId: string;
  productName: string;
  broadcasterName: string;
  broadcasterId: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  schedule: Map<string, number>; // { 'YYYY-MM-DD': quantity }
  material: {
    type: 'audio' | 'script' | 'text' | 'recording';
    audioUrl?: string;
    audioFileName?: string;
    audioDuration?: number;
    scriptUrl?: string;
    scriptFileName?: string;
    text?: string;
    textDuration?: number;

    // Campos para gravação (recording)
    script?: string;
    phonetic?: string;
    voiceGender?: string;
    musicStyle?: string;
    aiGeneration?: boolean;
    contentHash?: string;

    // Status do material e chat
    status: 'pending_broadcaster_review' | 'broadcaster_rejected' | 'broadcaster_approved' | 'broadcaster_produced' | 'client_approved' | 'client_rejected' | 'final_approved';

    // Produção da emissora (quando ela grava o comercial)
    broadcasterProduction?: {
      audioUrl: string;
      audioFileName: string;
      audioDuration: number;
      producedAt: Date;
      notes?: string;
    };

    // Chat de materiais
    chat: {
      sender: 'client' | 'broadcaster';
      message?: string;
      fileUrl?: string;
      fileName?: string;
      action?: 'uploaded' | 'approved' | 'rejected' | 'requested_change';
      timestamp: Date;
    }[];
  };
}

export interface ISplit {
  recipientId: string; // ID da subconta Asaas (emissora) ou 'platform'
  recipientName: string;
  recipientType: 'broadcaster' | 'platform' | 'agency';
  amount: number;
  percentage: number;
  description: string; // Ex: "Split 75%", "Platform 20%", "Tech Fee 5%"
}

export interface IBillingInvoice {
  type: 'platform_to_client' | 'broadcaster_to_platform';
  recipientId: string; // ID do destinatário da fatura
  recipientName: string;
  amount: number;
  issueDate: Date;
  dueDate: Date;
  status: 'pending' | 'issued' | 'paid' | 'overdue' | 'cancelled';
  asaasInvoiceId?: string;
  invoiceUrl?: string; // URL da NF PDF
  paidAt?: Date;
  notes?: string;
}

export interface IBillingData {
  razaoSocial: string;
  cnpj: string;
  address: {
    cep: string;
    street: string;
    number: string;
    complement?: string;
    neighborhood: string;
    city: string;
    state: string;
  };
  phone: string;
  billingEmail: string; // E-mail financeiro específico
}

export interface IBillingDocument {
  type: 'nota_fiscal' | 'comprovante_pagamento' | 'boleto' | 'outro';
  fileName: string;
  fileUrl: string;
  fileSize: number;
  uploadedBy: 'client' | 'admin' | 'broadcaster';
  uploadedAt: Date;
  status: 'pending_approval' | 'approved' | 'rejected';
  approvedBy?: string; // userId de quem aprovou/rejeitou
  approvedAt?: Date;
  rejectionReason?: string;
  description?: string; // Descrição do documento
}

export interface IBroadcasterInvoice {
  broadcasterId: mongoose.Types.ObjectId; // ID da emissora que enviou
  type: 'broadcaster_nf'; // NF emitida pela emissora CONTRA a plataforma
  fileName: string;
  fileUrl: string;
  fileSize: number;
  uploadedAt: Date;
  status: 'pending_payment' | 'paid'; // Aguardando pagamento da plataforma ou pago
  paidAt?: Date;
  description?: string;
}

// OPEC - Comprovante de Veiculação
export interface IOpec {
  broadcasterId: string; // ID da emissora
  broadcasterName: string; // Nome da emissora
  fileName: string;
  fileUrl: string;
  fileSize: number;
  uploadedBy: 'admin' | 'broadcaster'; // Quem fez upload
  uploadedAt: Date;
  veiculationPeriod?: {
    startDate: Date;
    endDate: Date;
  };
  description?: string;
}

export interface IPayment {
  method: 'credit_card' | 'pix' | 'wallet' | 'billing' | 'pending_contact'; // Adicionado 'pending_contact'
  status: 'pending' | 'confirmed' | 'received' | 'failed' | 'refunded';
  asaasPaymentId?: string;
  asaasInvoiceId?: string; // ID da NF gerada pelo Asaas
  asaasInvoiceUrl?: string; // URL do PDF da NF
  asaasBoletoUrl?: string; // URL do boleto (para A Faturar)
  pixQrCode?: string;
  pixCopyPaste?: string;
  cardBrand?: string;
  cardLastDigits?: string;
  installments?: number;
  walletAmountUsed: number;
  chargedAmount: number; // Valor cobrado no gateway (total - wallet)
  totalAmount: number; // Valor total do pedido
  paidAt?: Date;
  failureReason?: string;
}

export interface IOrder extends Document {
  orderNumber: string; // Número único do pedido (ex: ORD-20251201-0001)
  buyerId: mongoose.Types.ObjectId;
  buyerName: string;
  buyerEmail: string;
  buyerPhone: string;
  buyerDocument: string; // CPF ou CNPJ

  items: IOrderItem[];

  // Agência: referência ao cliente
  clientId?: mongoose.Types.ObjectId; // Referência ao AgencyClient

  // Faturamento
  billingData?: IBillingData;
  billingStatus?: 'pending_validation' | 'awaiting_payment' | 'paid_client' | 'rejected' | 'invoiced_client' | 'completed_billing';
  billingInvoices: IBillingInvoice[];
  billingDocuments: IBillingDocument[]; // Documentos de faturamento (NFs, comprovantes) - enviados pelo ADMIN
  broadcasterInvoices: IBroadcasterInvoice[]; // NFs enviadas pelas EMISSORAS para a plataforma
  opecs: IOpec[]; // Comprovantes de veiculação (OPEC)
  billingRejectionReason?: string;

  payment: IPayment;
  splits: ISplit[];

  status: 'pending_payment' | 'paid' | 'pending_approval' | 'approved' | 'scheduled' | 'in_progress' | 'completed' | 'expired' | 'cancelled' | 'refunded' | 'pending_billing_validation' | 'billing_rejected' | 'awaiting_payment' | 'completed_billing' | 'pending_contact';

  // Valores financeiros
  grossAmount: number; // Valor bruto dos produtos (100%)
  broadcasterAmount: number; // 75% do gross
  platformSplit: number; // 20% do gross
  techFee: number; // 5% do gross (taxa técnica adicional)
  agencyCommission: number; // 12% do gross (se aplicável)
  monitoringCost: number; // Valor do serviço de monitoramento
  isMonitoringEnabled: boolean; // Flag se contratou o serviço
  totalAmount: number; // grossAmount + techFee + agencyCommission + monitoringCost (o que o cliente paga)

  // DEPRECATED (manter por compatibilidade)
  subtotal: number;
  platformFee: number;

  // Metadados
  createdAt: Date;
  updatedAt: Date;
  paidAt?: Date;
  approvedAt?: Date;
  completedAt?: Date;
  cancelledAt?: Date;
  cancellationReason?: string;

  // Comunicação
  notifications: {
    type: 'email' | 'whatsapp' | 'sms';
    sentAt: Date;
    status: 'sent' | 'delivered' | 'failed';
    message: string;
  }[];

  // Webhook logs
  webhookLogs: {
    event: string;
    receivedAt: Date;
    payload: any;
  }[];
}

const OrderSchema = new Schema<IOrder>({
  orderNumber: { type: String, required: true, unique: true },
  buyerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  buyerName: { type: String, required: true },
  buyerEmail: { type: String, required: true },
  buyerPhone: { type: String, required: true },
  buyerDocument: { type: String, required: true },

  clientId: { type: Schema.Types.ObjectId, ref: 'AgencyClient' },

  items: [{
    productId: { type: String, required: true },
    productName: { type: String, required: true },
    broadcasterName: { type: String, required: true },
    broadcasterId: { type: String, required: true },
    quantity: { type: Number, required: true },
    unitPrice: { type: Number, required: true },
    totalPrice: { type: Number, required: true },
    schedule: { type: Map, of: Number, required: true },
    material: {
      type: { type: String, enum: ['audio', 'script', 'text', 'recording'] },
      audioUrl: String,
      audioFileName: String,
      audioDuration: Number,
      scriptUrl: String,
      scriptFileName: String,
      text: String,
      textDuration: Number,

      // Campos para gravação (recording)
      script: String,
      phonetic: String,
      voiceGender: String,
      musicStyle: String,
      aiGeneration: Boolean,
      contentHash: String,

      status: {
        type: String,
        enum: ['pending_broadcaster_review', 'broadcaster_rejected', 'broadcaster_approved', 'broadcaster_produced', 'client_approved', 'client_rejected', 'final_approved'],
        default: 'pending_broadcaster_review'
      },

      broadcasterProduction: {
        audioUrl: String,
        audioFileName: String,
        audioDuration: Number,
        producedAt: Date,
        notes: String
      },

      chat: [{
        sender: { type: String, enum: ['client', 'broadcaster'], required: true },
        message: String,
        fileUrl: String,
        fileName: String,
        action: { type: String, enum: ['uploaded', 'approved', 'rejected', 'requested_change'] },
        timestamp: { type: Date, default: Date.now }
      }]
    }
  }],

  billingData: {
    razaoSocial: String,
    cnpj: String,
    address: {
      cep: String,
      street: String,
      number: String,
      complement: String,
      neighborhood: String,
      city: String,
      state: String
    },
    phone: String,
    billingEmail: String
  },

  billingStatus: {
    type: String,
    enum: ['pending_validation', 'awaiting_payment', 'rejected', 'invoiced_client', 'paid_client', 'completed_billing']
  },

  billingInvoices: [{
    type: { type: String, enum: ['platform_to_client', 'broadcaster_to_platform'], required: true },
    recipientId: { type: String, required: true },
    recipientName: { type: String, required: true },
    amount: { type: Number, required: true },
    issueDate: { type: Date, required: true },
    dueDate: { type: Date, required: true },
    status: { type: String, enum: ['pending', 'issued', 'paid', 'overdue', 'cancelled'], default: 'pending' },
    asaasInvoiceId: String,
    invoiceUrl: String,
    paidAt: Date,
    notes: String
  }],

  billingDocuments: [{
    type: { type: String, enum: ['nota_fiscal', 'comprovante_pagamento', 'boleto', 'outro'], required: true },
    fileName: { type: String, required: true },
    fileUrl: { type: String, required: true },
    fileSize: { type: Number, required: true },
    uploadedBy: { type: String, enum: ['client', 'admin', 'broadcaster'], required: true },
    uploadedAt: { type: Date, default: Date.now },
    status: { type: String, enum: ['pending_approval', 'approved', 'rejected'], default: 'pending_approval' },
    approvedBy: String,
    approvedAt: Date,
    rejectionReason: String,
    description: String
  }],

  broadcasterInvoices: [{
    broadcasterId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    type: { type: String, enum: ['broadcaster_nf'], default: 'broadcaster_nf' },
    fileName: { type: String, required: true },
    fileUrl: { type: String, required: true },
    fileSize: { type: Number, required: true },
    uploadedAt: { type: Date, default: Date.now },
    status: { type: String, enum: ['pending_payment', 'paid'], default: 'pending_payment' },
    paidAt: Date,
    description: String
  }],

  opecs: [{
    broadcasterId: { type: String, required: true },
    broadcasterName: { type: String, required: true },
    fileName: { type: String, required: true },
    fileUrl: { type: String, required: true },
    fileSize: { type: Number, required: true },
    uploadedBy: { type: String, enum: ['admin', 'broadcaster'], required: true },
    uploadedAt: { type: Date, default: Date.now },
    veiculationPeriod: {
      startDate: Date,
      endDate: Date
    },
    description: String
  }],

  billingRejectionReason: String,

  payment: {
    method: { type: String, enum: ['credit_card', 'pix', 'wallet', 'billing', 'pending_contact'], required: true },
    status: { type: String, enum: ['pending', 'confirmed', 'received', 'failed', 'refunded'], default: 'pending' },
    asaasPaymentId: String,
    asaasInvoiceId: String, // ID da NF gerada pelo Asaas
    asaasInvoiceUrl: String, // URL do PDF da NF
    asaasBoletoUrl: String, // URL do boleto (para A Faturar)
    pixQrCode: String,
    pixCopyPaste: String,
    cardBrand: String,
    cardLastDigits: String,
    installments: Number,
    walletAmountUsed: { type: Number, default: 0 },
    chargedAmount: { type: Number, required: true },
    totalAmount: { type: Number, required: true },
    paidAt: Date,
    failureReason: String
  },

  splits: [{
    recipientId: { type: String, required: true },
    recipientName: { type: String, required: true },
    recipientType: { type: String, enum: ['broadcaster', 'platform', 'agency'], required: true },
    amount: { type: Number, required: true },
    percentage: { type: Number, required: true },
    description: { type: String, required: true }
  }],

  status: {
    type: String,
    enum: ['pending_payment', 'paid', 'pending_approval', 'approved', 'scheduled', 'in_progress', 'completed', 'expired', 'cancelled', 'refunded', 'pending_billing_validation', 'billing_rejected', 'awaiting_payment', 'completed_billing', 'pending_contact'],
    default: 'pending_payment'
  },

  grossAmount: { type: Number, required: true },
  broadcasterAmount: { type: Number, required: true },
  platformSplit: { type: Number, required: true },
  techFee: { type: Number, required: true },
  agencyCommission: { type: Number, default: 0 },
  monitoringCost: { type: Number, default: 0 },
  isMonitoringEnabled: { type: Boolean, default: true },
  totalAmount: { type: Number, required: true },

  // DEPRECATED (manter por compatibilidade)
  subtotal: { type: Number, required: true },
  platformFee: { type: Number, required: true },

  paidAt: Date,
  approvedAt: Date,
  completedAt: Date,
  cancelledAt: Date,
  cancellationReason: String,

  notifications: [{
    type: { type: String, enum: ['email', 'whatsapp', 'sms'] },
    sentAt: { type: Date, default: Date.now },
    status: { type: String, enum: ['sent', 'delivered', 'failed'] },
    message: String
  }],

  webhookLogs: [{
    event: String,
    receivedAt: { type: Date, default: Date.now },
    payload: Schema.Types.Mixed
  }]
}, {
  timestamps: true
});

// Gera número único do pedido antes de salvar
OrderSchema.pre('save', async function () {
  if (!this.orderNumber) {
    const date = new Date();
    const dateStr = date.toISOString().split('T')[0]?.replace(/-/g, '') || '';

    // Usa this.constructor para acessar o modelo
    const OrderModel = this.constructor as any;
    const count = await OrderModel.countDocuments({
      createdAt: { $gte: new Date(date.setHours(0, 0, 0, 0)) }
    });

    this.orderNumber = `ORD-${dateStr}-${String(count + 1).padStart(4, '0')}`;
  }
});

// ─── Índices de Performance ───────────────────────────────────────────────

// Consultas do comprador — "Meus pedidos" (mais usada)
OrderSchema.index({ buyerId: 1, createdAt: -1 });
OrderSchema.index({ buyerId: 1, status: 1 });

// Admin — listagem com filtro de status paginada
OrderSchema.index({ status: 1, createdAt: -1 });

// Webhook Asaas — lookup por paymentId (crítico para pagamentos)
OrderSchema.index({ 'payment.asaasPaymentId': 1 });

// Número do pedido — busca direta
OrderSchema.index({ orderNumber: 1 });  // já unique, mas explicita o índice

// Pedidos de uma emissora específica (via items.broadcasterId)
OrderSchema.index({ 'items.broadcasterId': 1, status: 1 });

// Agência — pedidos de um cliente específico
OrderSchema.index({ clientId: 1, createdAt: -1 });

// Análise financeira — pedidos pagos em período
OrderSchema.index({ 'payment.status': 1, paidAt: -1 });

// Faturamento — pedidos com billingStatus pendente
OrderSchema.index({ billingStatus: 1, createdAt: -1 });

export default mongoose.model<IOrder>('Order', OrderSchema);
