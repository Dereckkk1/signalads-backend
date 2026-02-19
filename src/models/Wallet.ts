import mongoose, { Schema, Document } from 'mongoose';

export interface ITransaction {
  type: 'credit' | 'debit';
  amount: number;
  description: string;
  relatedOrderId?: mongoose.Types.ObjectId;
  relatedPaymentId?: string;
  status: 'pending' | 'completed' | 'failed' | 'reversed';
  createdAt: Date;
}

export interface IWallet extends Document {
  userId: mongoose.Types.ObjectId | string; // ObjectId para users, string para 'platform'
  balance: number; // Saldo disponível em reais
  blockedBalance: number; // Saldo bloqueado (pedidos em análise)
  totalEarned: number; // Total ganho (para emissoras/agências)
  totalSpent: number; // Total gasto (para compradores)
  
  transactions: ITransaction[];
  
  // Dados bancários para saque (emissoras/agências)
  bankAccount?: {
    bankCode: string;
    bankName: string;
    agency: string;
    agencyDigit?: string;
    account: string;
    accountDigit: string;
    accountType: 'checking' | 'savings';
    holderName: string;
    holderDocument: string;
  };
  
  // Subconta Asaas (para emissoras/agências receberem splits)
  asaasAccountId?: string;
  asaasWalletId?: string;
  
  createdAt: Date;
  updatedAt: Date;
  
  // Métodos
  addCredit(amount: number, description: string, orderId?: mongoose.Types.ObjectId): Promise<IWallet>;
  debit(amount: number, description: string, orderId?: mongoose.Types.ObjectId): Promise<IWallet>;
  blockAmount(amount: number): Promise<IWallet>;
  releaseAmount(amount: number): Promise<IWallet>;
}

const WalletSchema = new Schema<IWallet>({
  userId: { type: Schema.Types.Mixed, required: true, unique: true }, // Mixed: aceita ObjectId ou String
  balance: { type: Number, default: 0, min: 0 },
  blockedBalance: { type: Number, default: 0, min: 0 },
  totalEarned: { type: Number, default: 0 },
  totalSpent: { type: Number, default: 0 },
  
  transactions: [{
    type: { type: String, enum: ['credit', 'debit'], required: true },
    amount: { type: Number, required: true },
    description: { type: String, required: true },
    relatedOrderId: { type: Schema.Types.ObjectId, ref: 'Order' },
    relatedPaymentId: String,
    status: { type: String, enum: ['pending', 'completed', 'failed', 'reversed'], default: 'completed' },
    createdAt: { type: Date, default: Date.now }
  }],
  
  bankAccount: {
    bankCode: String,
    bankName: String,
    agency: String,
    agencyDigit: String,
    account: String,
    accountDigit: String,
    accountType: { type: String, enum: ['checking', 'savings'] },
    holderName: String,
    holderDocument: String
  },
  
  asaasAccountId: String,
  asaasWalletId: String
}, {
  timestamps: true
});

// Índices
WalletSchema.index({ userId: 1 });
WalletSchema.index({ asaasAccountId: 1 });

// Métodos auxiliares
WalletSchema.methods.addCredit = function(amount: number, description: string, orderId?: mongoose.Types.ObjectId) {
  this.balance += amount;
  this.totalEarned += amount;
  this.transactions.push({
    type: 'credit',
    amount,
    description,
    relatedOrderId: orderId,
    status: 'completed',
    createdAt: new Date()
  });
  return this.save();
};

WalletSchema.methods.debit = function(amount: number, description: string, orderId?: mongoose.Types.ObjectId) {
  if (this.balance < amount) {
    throw new Error('Saldo insuficiente');
  }
  this.balance -= amount;
  this.totalSpent += amount;
  this.transactions.push({
    type: 'debit',
    amount,
    description,
    relatedOrderId: orderId,
    status: 'completed',
    createdAt: new Date()
  });
  return this.save();
};

WalletSchema.methods.blockAmount = function(amount: number) {
  if (this.balance < amount) {
    throw new Error('Saldo insuficiente para bloqueio');
  }
  this.balance -= amount;
  this.blockedBalance += amount;
  return this.save();
};

WalletSchema.methods.releaseAmount = function(amount: number) {
  if (this.blockedBalance < amount) {
    throw new Error('Saldo bloqueado insuficiente');
  }
  this.blockedBalance -= amount;
  this.balance += amount;
  return this.save();
};

export default mongoose.model<IWallet>('Wallet', WalletSchema);
