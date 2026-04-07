import mongoose, { Document, Schema } from 'mongoose';

export interface IClientAddress {
  cep?: string;
  street?: string;
  number?: string;
  complement?: string;
  neighborhood?: string;
  city?: string;
  state?: string;
}

export interface IAgencyClient extends Document {
  agencyId?: mongoose.Types.ObjectId;
  broadcasterId?: mongoose.Types.ObjectId;
  name: string;
  documentNumber: string; // CNPJ ou CPF
  email?: string;
  phone?: string;
  contactName?: string;
  logo?: string;
  address?: IClientAddress;
  status: 'active' | 'inactive';
  createdAt: Date;
  updatedAt: Date;
}

const AgencyClientSchema: Schema = new Schema(
  {
    agencyId: { type: Schema.Types.ObjectId, ref: 'User', index: true },
    broadcasterId: { type: Schema.Types.ObjectId, ref: 'User', index: true },
    name: { type: String, required: true },
    documentNumber: { type: String, required: true },
    email: { type: String },
    phone: { type: String },
    contactName: { type: String },
    logo: { type: String },
    address: {
      cep: String,
      street: String,
      number: String,
      complement: String,
      neighborhood: String,
      city: String,
      state: String
    },
    status: { type: String, enum: ['active', 'inactive'], default: 'active' },
  },
  { timestamps: true }
);

export default mongoose.model<IAgencyClient>('AgencyClient', AgencyClientSchema);
