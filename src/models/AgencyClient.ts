import mongoose, { Document, Schema } from 'mongoose';

export interface IAgencyClient extends Document {
  agencyId: mongoose.Types.ObjectId;
  name: string;
  documentNumber: string; // CNPJ ou CPF
  email?: string;
  phone?: string;
  contactName?: string;
  status: 'active' | 'inactive';
  createdAt: Date;
  updatedAt: Date;
}

const AgencyClientSchema: Schema = new Schema(
  {
    agencyId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    name: { type: String, required: true },
    documentNumber: { type: String, required: true },
    email: { type: String },
    phone: { type: String },
    contactName: { type: String },
    status: { type: String, enum: ['active', 'inactive'], default: 'active' },
  },
  { timestamps: true }
);

export default mongoose.model<IAgencyClient>('AgencyClient', AgencyClientSchema);
