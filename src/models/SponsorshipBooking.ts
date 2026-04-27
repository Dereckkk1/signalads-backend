import mongoose, { Document, Schema } from 'mongoose';

/**
 * SponsorshipBooking — controla reserva de slot mensal de patrocinio.
 *
 * Cada (sponsorshipId, month) so pode ter UMA reserva ativa (status='reserved').
 * Pedidos cancelados/expirados marcam o registro como 'cancelled', liberando o slot
 * via o partial unique index abaixo.
 */
export interface ISponsorshipBooking extends Document {
  sponsorshipId: mongoose.Types.ObjectId;
  month: string; // 'YYYY-MM'
  orderId?: mongoose.Types.ObjectId;
  status: 'reserved' | 'cancelled';
  createdAt: Date;
  updatedAt: Date;
}

const SponsorshipBookingSchema: Schema = new Schema(
  {
    sponsorshipId: {
      type: Schema.Types.ObjectId,
      ref: 'Sponsorship',
      required: true,
      index: true,
    },
    month: {
      type: String,
      required: true,
      match: /^\d{4}-\d{2}$/, // YYYY-MM
    },
    orderId: {
      type: Schema.Types.ObjectId,
      ref: 'Order',
      index: true,
    },
    status: {
      type: String,
      enum: ['reserved', 'cancelled'],
      default: 'reserved',
      index: true,
    },
  },
  { timestamps: true }
);

// Partial unique index: somente reservas ativas competem pelo slot.
// Cancelar uma reserva libera (sponsorshipId, month) para nova reserva.
SponsorshipBookingSchema.index(
  { sponsorshipId: 1, month: 1 },
  { unique: true, partialFilterExpression: { status: 'reserved' } }
);

const SponsorshipBooking = mongoose.model<ISponsorshipBooking>(
  'SponsorshipBooking',
  SponsorshipBookingSchema
);
export default SponsorshipBooking;
