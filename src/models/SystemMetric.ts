import { Schema, model, Document } from 'mongoose';

export interface ISystemMetric extends Document {
  route: string;
  method: string;
  statusCode: number;
  duration: number;
  isError: boolean;
  isSlow: boolean;
  timestamp: Date;
  ip?: string;
  userId?: string;
  userEmail?: string;
}

const systemMetricSchema = new Schema<ISystemMetric>(
  {
    route: {
      type: String,
      required: true,
      trim: true,
    },
    method: {
      type: String,
      required: true,
      enum: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS', 'HEAD'],
    },
    statusCode: {
      type: Number,
      required: true,
    },
    duration: {
      type: Number,
      required: true,
    },
    isError: {
      type: Boolean,
      default: false,
    },
    isSlow: {
      type: Boolean,
      default: false,
    },
    ip: {
      type: String,
    },
    userId: {
      type: String,
    },
    userEmail: {
      type: String,
    },
    timestamp: {
      type: Date,
      default: Date.now,
      required: true,
    },
  },
  { timestamps: false }
);

// TTL: auto-remove após 30 dias
systemMetricSchema.index({ timestamp: 1 }, { expireAfterSeconds: 2_592_000 });

// Queries por rota + período
systemMetricSchema.index({ route: 1, timestamp: -1 });

// Queries de erros
systemMetricSchema.index({ isError: 1, timestamp: -1 });

// Queries de requests lentos
systemMetricSchema.index({ isSlow: 1, timestamp: -1 });

// Queries por ator (IP + userId) para auditoria de segurança
systemMetricSchema.index({ ip: 1, timestamp: -1 });
systemMetricSchema.index({ userId: 1, timestamp: -1 });

export default model<ISystemMetric>('SystemMetric', systemMetricSchema);
