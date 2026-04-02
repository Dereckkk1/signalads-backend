import mongoose, { Schema, Document } from 'mongoose';

export interface IProposalVersion extends Document {
  proposalId: mongoose.Types.ObjectId;
  version: number;
  snapshot: {
    title: string;
    items: any[];
    grossAmount: number;
    techFee: number;
    productionCost: number;
    agencyCommission: number;
    agencyCommissionAmount: number;
    monitoringCost: number;
    discount?: { type: string; value: number; reason?: string };
    discountAmount: number;
    totalAmount: number;
    customization: any;
  };
  changedBy: mongoose.Types.ObjectId; // userId
  changeType: 'manual' | 'auto_send' | 'auto_update';
  changeNote?: string;
  createdAt: Date;
}

const ProposalVersionSchema = new Schema<IProposalVersion>({
  proposalId: { type: Schema.Types.ObjectId, ref: 'Proposal', required: true },
  version: { type: Number, required: true },
  snapshot: { type: Schema.Types.Mixed, required: true },
  changedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  changeType: { type: String, enum: ['manual', 'auto_send', 'auto_update'], default: 'auto_update' },
  changeNote: { type: String }
}, {
  timestamps: { createdAt: true, updatedAt: false }
});

// Buscar versões de uma proposta
ProposalVersionSchema.index({ proposalId: 1, version: -1 });

// Limitar a 20 versões por proposta (aplicado no controller)
ProposalVersionSchema.index({ proposalId: 1, createdAt: 1 });

export default mongoose.model<IProposalVersion>('ProposalVersion', ProposalVersionSchema);
