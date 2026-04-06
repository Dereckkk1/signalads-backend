import mongoose, { Schema, Document } from 'mongoose';
import { IProposalKpi, IProposalMetric, ICustomSection } from './Proposal';

export interface IProposalTemplate extends Document {
  name: string;
  agencyId?: mongoose.Types.ObjectId; // null = template padrao da plataforma
  broadcasterId?: mongoose.Types.ObjectId; // null = template padrao da plataforma
  isDefault: boolean;
  category?: string; // ex: 'varejo', 'automotivo', 'saude', 'governo', 'educacao', 'geral'

  customization: {
    logo?: string;
    coverImage?: string;
    primaryColor: string;
    secondaryColor: string;
    backgroundColor: string;
    textColor: string;
    accentColor: string;
    titleFont: string;
    bodyFont: string;
    sectionOrder: string[];
    layoutRows?: string[][];
    hiddenSections: string[];
    hiddenElements: string[];
    // Templates Pro: salvam conteúdo além de visual
    kpis: IProposalKpi[];
    metrics: IProposalMetric[];
    customSections: ICustomSection[];
    aboutAgency?: {
      enabled: boolean;
      description?: string;
      website?: string;
      email?: string;
      phone?: string;
      position: 'start' | 'end';
    };
    customTexts: {
      headerTitle?: string;
      headerSubtitle?: string;
      briefingTitle?: string;
      briefingContent?: string;
      videoUrl?: string;
      videoCaption?: string;
      mapTitle?: string;
      tableTitle?: string;
      notesTitle?: string;
      notesContent?: string;
      footerNote?: string;
      // Legados mantidos para migração
      kpi1Value?: string; kpi1Label?: string; kpi1Color?: string;
      kpi2Value?: string; kpi2Label?: string; kpi2Color?: string;
      kpi3Value?: string; kpi3Label?: string; kpi3Color?: string;
      kpi4Value?: string; kpi4Label?: string; kpi4Color?: string;
      metric1Value?: string; metric1Label?: string; metric1Icon?: string;
      metric2Value?: string; metric2Label?: string; metric2Icon?: string;
    };
  };

  createdAt: Date;
  updatedAt: Date;
}

const DEFAULT_SECTION_ORDER = ['header', 'briefing', 'kpis', 'metrics', 'map', 'table', 'notes'];

const ProposalTemplateSchema = new Schema<IProposalTemplate>({
  name: { type: String, required: true },
  agencyId: { type: Schema.Types.ObjectId, ref: 'User' },
  broadcasterId: { type: Schema.Types.ObjectId, ref: 'User' },
  isDefault: { type: Boolean, default: false },
  category: { type: String, enum: ['varejo', 'automotivo', 'saude', 'governo', 'educacao', 'geral', null], default: null },

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
    kpis: { type: [{ value: String, label: String, color: String, visible: { type: Boolean, default: true } }], default: [] },
    metrics: { type: [{ value: String, label: String, icon: String, visible: { type: Boolean, default: true } }], default: [] },
    customSections: { type: [{ id: String, type: { type: String }, title: String, content: String, imageUrl: String, imageCaption: String, videoUrl: String, videoCaption: String, galleryImages: [{ url: String, caption: String }], order: Number, visible: { type: Boolean, default: true } }], default: [] },
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
      briefingContent: { type: String },
      videoUrl: { type: String },
      videoCaption: { type: String },
      mapTitle: { type: String },
      tableTitle: { type: String },
      notesTitle: { type: String },
      notesContent: { type: String },
      footerNote: { type: String },
      kpi1Value: { type: String }, kpi1Label: { type: String }, kpi1Color: { type: String },
      kpi2Value: { type: String }, kpi2Label: { type: String }, kpi2Color: { type: String },
      kpi3Value: { type: String }, kpi3Label: { type: String }, kpi3Color: { type: String },
      kpi4Value: { type: String }, kpi4Label: { type: String }, kpi4Color: { type: String },
      metric1Value: { type: String }, metric1Label: { type: String }, metric1Icon: { type: String },
      metric2Value: { type: String }, metric2Label: { type: String }, metric2Icon: { type: String }
    }
  }
}, {
  timestamps: true
});

// Templates de uma agencia especifica
ProposalTemplateSchema.index({ agencyId: 1 });

// Templates de uma emissora especifica
ProposalTemplateSchema.index({ broadcasterId: 1 });

// Templates padrao da plataforma
ProposalTemplateSchema.index({ isDefault: 1 });

// Templates por categoria
ProposalTemplateSchema.index({ category: 1 });

export default mongoose.model<IProposalTemplate>('ProposalTemplate', ProposalTemplateSchema);
