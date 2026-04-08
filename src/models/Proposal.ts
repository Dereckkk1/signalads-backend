import mongoose, { Schema, Document } from 'mongoose';
import { getNextSequence } from './Counter';

// ─── Sub-Interfaces ──────────────────────────────────────────────────────────

export interface IProposalItem {
  productId?: string; // opcional para itens customizados
  productName: string;
  productType: string; // spotType (ex: "Comercial 30s")
  duration: number;
  broadcasterId?: string; // opcional para itens customizados
  broadcasterName?: string;
  city?: string;
  state?: string;
  region?: string;
  quantity: number;
  unitPrice: number; // preco final com markup (pricePerInsertion)
  netPrice: number; // preco liquido da emissora
  totalPrice: number; // unitPrice * quantity
  tablePrice?: number; // preco tabela antes de negociacao
  adjustedPrice?: number; // preco ajustado por negociacao (se diferente de unitPrice)
  discountReason?: string; // motivo do ajuste de preco
  needsRecording?: boolean; // true = cliente precisa de gravação profissional (R$50)
  isCustom?: boolean; // true = item adicionado manualmente, sem vinculo com Product
  customDescription?: string; // descricao para itens customizados
  schedule?: Map<string, number>; // { 'YYYY-MM-DD': quantity }
  // Snapshot de dados da emissora (para mapa/tabela)
  lat?: number;
  lng?: number;
  antennaClass?: string;
  broadcasterLogo?: string;
  dial?: string;
  band?: string;
  population?: number;
  pmm?: number;
  // Audience snapshot
  categories?: string[];
  audienceGenderFemale?: number;
  audienceAgeRange?: string;
  audienceSocialClass?: string;
  // Campos de Patrocínio
  itemType?: 'product' | 'sponsorship';
  sponsorshipId?: string;
  programName?: string;
  programTimeRange?: { start: string; end: string };
  programDaysOfWeek?: number[];
  selectedMonth?: string;
  sponsorshipInsertions?: {
    name: string;
    duration: number;
    quantityPerDay: number;
    requiresMaterial: boolean;
  }[];
}

export interface IProposalKpi {
  value: string;
  label: string;
  color: string;
  visible: boolean;
}

export interface IProposalMetric {
  value: string;
  label: string;
  icon?: string;
  visible: boolean;
}

export interface ICustomSection {
  id: string; // nanoid
  type: 'richtext' | 'image' | 'video' | 'gallery' | 'divider';
  title?: string;
  content?: string; // HTML para richtext, URL para image/video
  imageUrl?: string;
  imageCaption?: string;
  videoUrl?: string;
  videoCaption?: string;
  galleryImages?: { url: string; caption?: string }[];
  order: number; // posicao na lista de secoes
  visible: boolean;
}

export interface IDiscount {
  type: 'percentage' | 'fixed';
  value: number;
  reason?: string;
}

export interface IApproval {
  name?: string;
  email?: string;
  ip?: string;
  userAgent?: string;
  approvedAt?: Date;
}

export interface IProposalComment {
  _id?: mongoose.Types.ObjectId;
  sectionId: string; // ex: 'header', 'table', 'custom-abc123'
  author: string; // nome
  authorEmail?: string;
  authorType: 'client' | 'agency' | 'broadcaster';
  text: string;
  createdAt: Date;
}

export interface IViewSession {
  startedAt: Date;
  duration: number; // segundos
  scrollDepth: number; // 0-100%
}

export interface IProtection {
  enabled: boolean;
  pin?: string;
  email?: string;
  expiresAt?: Date;
}

export interface IProposalCustomization {
  logo?: string; // URL GCS
  coverImage?: string; // URL GCS
  primaryColor: string;
  secondaryColor: string;
  backgroundColor: string;
  textColor: string;
  accentColor: string;
  titleFont: string;
  bodyFont: string;
  sectionOrder: string[];
  layoutRows?: string[][]; // e.g. [['header'], ['kpis', 'metrics'], ['map']]
  hiddenSections: string[];
  hiddenElements: string[];
  // KPIs dinâmicos (1-8) — substitui kpi1-4 hardcoded
  kpis: IProposalKpi[];
  // Métricas dinâmicas (1-6) — substitui metric1-2 hardcoded
  metrics: IProposalMetric[];
  // Seções customizadas (blocos de conteúdo adicionais)
  customSections: ICustomSection[];
  // Seção sobre a agência
  aboutAgency?: {
    enabled: boolean;
    description?: string; // HTML rich text
    website?: string;
    email?: string;
    phone?: string;
    position: 'start' | 'end'; // antes ou depois das seções
  };
  customTexts: {
    headerTitle?: string;
    headerSubtitle?: string;
    // Briefing
    briefingTitle?: string;
    briefingContent?: string; // agora suporta HTML (TipTap)
    videoUrl?: string;
    videoCaption?: string;
    // KPIs legados (mantidos para migração, preferir kpis[])
    kpi1Value?: string;
    kpi1Label?: string;
    kpi1Color?: string;
    kpi2Value?: string;
    kpi2Label?: string;
    kpi2Color?: string;
    kpi3Value?: string;
    kpi3Label?: string;
    kpi3Color?: string;
    kpi4Value?: string;
    kpi4Label?: string;
    kpi4Color?: string;
    // Metricas legadas (mantidas para migração, preferir metrics[])
    metric1Value?: string;
    metric1Label?: string;
    metric1Icon?: string;
    metric2Value?: string;
    metric2Label?: string;
    metric2Icon?: string;
    // Map & Table
    mapTitle?: string;
    tableTitle?: string;
    // Notes & Footer
    notesTitle?: string;
    notesContent?: string; // agora suporta HTML (TipTap)
    footerNote?: string;
  };
}

// ─── Main Interface ──────────────────────────────────────────────────────────

export interface IProposal extends Document {
  proposalNumber: string;
  slug: string;

  // Ownership
  ownerType: 'agency' | 'broadcaster';
  agencyId?: mongoose.Types.ObjectId;
  broadcasterId?: mongoose.Types.ObjectId;
  createdBy?: mongoose.Types.ObjectId; // Sub-user que criou (se aplicavel)
  clientId?: mongoose.Types.ObjectId;
  clientName?: string;

  // Conteudo
  title: string;
  description?: string;
  items: IProposalItem[];

  // Financeiro (snapshot)
  grossAmount: number;
  techFee: number; // 5% do grossAmount (taxa técnica)
  agencyCommission: number; // percentual
  agencyCommissionAmount: number; // valor calculado
  productionCost: number; // R$50 por item que precisa de gravação
  monitoringCost: number;
  discount?: IDiscount; // desconto global
  discountAmount: number; // valor calculado do desconto
  totalAmount: number;

  // Personalizacao visual
  customization: IProposalCustomization;

  // Template
  templateId?: mongoose.Types.ObjectId;

  // Status & Lifecycle
  status: 'draft' | 'sent' | 'viewed' | 'approved' | 'rejected' | 'expired' | 'converted';
  validUntil?: Date;
  sentAt?: Date;
  viewedAt?: Date;
  respondedAt?: Date;
  responseNote?: string;

  // Aprovação formal
  approval?: IApproval;

  // Comentários inline por seção
  comments: IProposalComment[];

  // Proteção por PIN
  protection?: IProtection;

  // Tracking
  viewCount: number;
  lastViewedAt?: Date;
  viewSessions: IViewSession[];

  // Conversao
  convertedOrderId?: mongoose.Types.ObjectId;

  createdAt: Date;
  updatedAt: Date;
}

const DEFAULT_SECTION_ORDER = ['header', 'briefing', 'kpis', 'metrics', 'map', 'table', 'notes'];

const ProposalSchema = new Schema<IProposal>({
  proposalNumber: { type: String, required: true, unique: true },
  slug: { type: String, required: true, unique: true },

  ownerType: { type: String, enum: ['agency', 'broadcaster'], default: 'agency' },
  agencyId: { type: Schema.Types.ObjectId, ref: 'User' },
  broadcasterId: { type: Schema.Types.ObjectId, ref: 'User' },
  createdBy: { type: Schema.Types.ObjectId, ref: 'User' }, // Sub-user que criou (se aplicavel)
  clientId: { type: Schema.Types.ObjectId, ref: 'AgencyClient' },
  clientName: { type: String },

  title: { type: String, required: true, default: 'Proposta Comercial' },
  description: { type: String },

  items: [{
    productId: { type: String }, // opcional para itens customizados
    productName: { type: String, required: true },
    productType: { type: String, default: '' },
    duration: { type: Number, default: 0 },
    broadcasterId: { type: String }, // opcional para itens customizados
    broadcasterName: { type: String, default: '' },
    city: { type: String, default: '' },
    state: { type: String, default: '' },
    region: { type: String },
    quantity: { type: Number, required: true },
    unitPrice: { type: Number, required: true },
    netPrice: { type: Number, default: 0 },
    totalPrice: { type: Number, required: true },
    tablePrice: { type: Number },
    adjustedPrice: { type: Number }, // preco negociado
    discountReason: { type: String }, // motivo do desconto
    needsRecording: { type: Boolean, default: false },
    isCustom: { type: Boolean, default: false }, // item manual
    customDescription: { type: String },
    schedule: { type: Map, of: Number },
    // Map snapshot
    lat: { type: Number },
    lng: { type: Number },
    antennaClass: { type: String },
    broadcasterLogo: { type: String },
    dial: { type: String },
    band: { type: String },
    population: { type: Number },
    pmm: { type: Number },
    // Audience snapshot
    categories: [{ type: String }],
    audienceGenderFemale: { type: Number },
    audienceAgeRange: { type: String },
    audienceSocialClass: { type: String },
    // Campos de Patrocínio
    itemType: { type: String, enum: ['product', 'sponsorship'], default: 'product' },
    sponsorshipId: String,
    programName: String,
    programTimeRange: {
      start: String,
      end: String
    },
    programDaysOfWeek: [Number],
    selectedMonth: String,
    sponsorshipInsertions: [{
      name: { type: String, required: true },
      duration: { type: Number, default: 0 },
      quantityPerDay: { type: Number, required: true },
      requiresMaterial: { type: Boolean, default: false },
      _id: false
    }],
  }],

  // ─── Financeiro ─────────────────────────────────────────────────────────
  grossAmount: { type: Number, required: true },
  techFee: { type: Number, default: 0 },
  agencyCommission: { type: Number, default: 0 },
  agencyCommissionAmount: { type: Number, default: 0 },
  productionCost: { type: Number, default: 0 },
  monitoringCost: { type: Number, default: 0 },
  discount: {
    type: {
      type: String, enum: ['percentage', 'fixed']
    },
    value: { type: Number },
    reason: { type: String }
  },
  discountAmount: { type: Number, default: 0 },
  totalAmount: { type: Number, required: true },

  // ─── Customização Visual ─────────────────────────────────────────────────
  customization: {
    logo: { type: String },
    coverImage: { type: String },
    primaryColor: { type: String, default: '#1a1a2e' },
    secondaryColor: { type: String, default: '#16213e' },
    backgroundColor: { type: String, default: '#ffffff' },
    textColor: { type: String, default: '#1a1a2e' },
    accentColor: { type: String, default: '#0f3460' },
    titleFont: { type: String, default: 'Space Grotesk' },
    bodyFont: { type: String, default: 'Fira Sans Condensed' },
    sectionOrder: { type: [String], default: DEFAULT_SECTION_ORDER },
    layoutRows: { type: [[String]] },
    hiddenSections: { type: [String], default: [] },
    hiddenElements: { type: [String], default: [] },

    // KPIs dinâmicos (1-8) — substitui kpi1-4 hardcoded
    kpis: { type: [{
      value: { type: String },
      label: { type: String },
      color: { type: String },
      visible: { type: Boolean, default: true }
    }], default: [] },

    // Métricas dinâmicas (1-6) — substitui metric1-2 hardcoded
    metrics: { type: [{
      value: { type: String },
      label: { type: String },
      icon: { type: String },
      visible: { type: Boolean, default: true }
    }], default: [] },

    // Seções customizadas (blocos livres de conteúdo)
    customSections: { type: [{
      id: { type: String, required: true },
      type: { type: String, enum: ['richtext', 'image', 'video', 'gallery', 'divider'], required: true },
      title: { type: String },
      content: { type: String }, // HTML para richtext
      imageUrl: { type: String },
      imageCaption: { type: String },
      videoUrl: { type: String },
      videoCaption: { type: String },
      galleryImages: { type: [{ url: String, caption: String }] },
      order: { type: Number, default: 0 },
      visible: { type: Boolean, default: true }
    }], default: [] },

    // Seção "Sobre a Agência"
    aboutAgency: {
      enabled: { type: Boolean, default: false },
      description: { type: String },
      website: { type: String },
      email: { type: String },
      phone: { type: String },
      position: { type: String, enum: ['start', 'end'], default: 'end' }
    },

    customTexts: {
      headerTitle: { type: String },
      headerSubtitle: { type: String },
      briefingTitle: { type: String },
      briefingContent: { type: String }, // suporta HTML (TipTap)
      videoUrl: { type: String },
      videoCaption: { type: String },
      // KPIs legados (para migração)
      kpi1Value: { type: String },
      kpi1Label: { type: String },
      kpi1Color: { type: String },
      kpi2Value: { type: String },
      kpi2Label: { type: String },
      kpi2Color: { type: String },
      kpi3Value: { type: String },
      kpi3Label: { type: String },
      kpi3Color: { type: String },
      kpi4Value: { type: String },
      kpi4Label: { type: String },
      kpi4Color: { type: String },
      // Metricas legadas (para migração)
      metric1Value: { type: String },
      metric1Label: { type: String },
      metric1Icon: { type: String },
      metric2Value: { type: String },
      metric2Label: { type: String },
      metric2Icon: { type: String },
      mapTitle: { type: String },
      tableTitle: { type: String },
      notesTitle: { type: String },
      notesContent: { type: String }, // suporta HTML (TipTap)
      footerNote: { type: String }
    }
  },

  templateId: { type: Schema.Types.ObjectId, ref: 'ProposalTemplate' },

  // ─── Status & Lifecycle ─────────────────────────────────────────────────
  status: {
    type: String,
    enum: ['draft', 'sent', 'viewed', 'approved', 'rejected', 'expired', 'converted'],
    default: 'draft'
  },
  validUntil: { type: Date },
  sentAt: { type: Date },
  viewedAt: { type: Date },
  respondedAt: { type: Date },
  responseNote: { type: String },

  // Aprovação formal (assinatura digital)
  approval: {
    name: { type: String },
    email: { type: String },
    ip: { type: String },
    userAgent: { type: String },
    approvedAt: { type: Date }
  },

  // Comentários inline por seção
  comments: { type: [{
    sectionId: { type: String, required: true },
    author: { type: String, required: true },
    authorEmail: { type: String },
    authorType: { type: String, enum: ['client', 'agency', 'broadcaster'], required: true },
    text: { type: String, required: true },
    createdAt: { type: Date, default: Date.now }
  }], default: [] },

  // Proteção por PIN
  protection: {
    enabled: { type: Boolean, default: false },
    pin: { type: String },
    email: { type: String },
    expiresAt: { type: Date }
  },

  // Tracking
  viewCount: { type: Number, default: 0 },
  lastViewedAt: { type: Date },
  viewSessions: { type: [{
    startedAt: { type: Date },
    duration: { type: Number }, // segundos
    scrollDepth: { type: Number } // 0-100
  }], default: [] },

  convertedOrderId: { type: Schema.Types.ObjectId, ref: 'Order' }
}, {
  timestamps: true
});

// Gera proposalNumber antes de validar (mesmo padrao do Order)
ProposalSchema.pre('validate', async function () {
  if (!this.proposalNumber) {
    const date = new Date();
    const dateStr = date.toISOString().split('T')[0]?.replace(/-/g, '') || '';
    const seq = await getNextSequence(`proposal-${dateStr}`);
    this.proposalNumber = `PROP-${dateStr}-${String(seq).padStart(4, '0')}`;
  }
});

// ─── Índices de Performance ───────────────────────────────────────────────

// Listagem de propostas da agencia (query principal)
ProposalSchema.index({ agencyId: 1, createdAt: -1 });

// Filtro por status da agencia
ProposalSchema.index({ agencyId: 1, status: 1 });

// Pagina publica — lookup por slug
ProposalSchema.index({ slug: 1 }, { unique: true });

// Cron de expiracao — propostas vencidas
ProposalSchema.index({ status: 1, validUntil: 1 });

// Propostas de um cliente especifico
ProposalSchema.index({ clientId: 1, createdAt: -1 });

// Listagem de propostas da emissora (query principal)
ProposalSchema.index({ broadcasterId: 1, createdAt: -1 });

// Filtro por status da emissora
ProposalSchema.index({ broadcasterId: 1, status: 1 });

export default mongoose.model<IProposal>('Proposal', ProposalSchema);
