import cron from 'node-cron';
import Proposal from '../models/Proposal';
import Order from '../models/Order';
import SponsorshipBooking from '../models/SponsorshipBooking';

/**
 * Cron Job — Expira propostas vencidas + alertas de expiração + libera bookings de patrocinio
 * Roda diariamente a meia-noite (00:00).
 */
export function startExpireProposalsCron(): void {
  cron.schedule('0 0 * * *', async () => {
    try {
      // 0. Liberar SponsorshipBookings cujo Order foi cancelado/expirado/refunded
      try {
        const releasedOrders = await Order.find({
          status: { $in: ['cancelled', 'expired', 'refunded'] },
          'items.itemType': 'sponsorship',
        }).select('_id').lean();
        const releasedIds = releasedOrders.map((o: any) => o._id);
        if (releasedIds.length > 0) {
          const released = await SponsorshipBooking.updateMany(
            { orderId: { $in: releasedIds }, status: 'reserved' },
            { $set: { status: 'cancelled' } }
          );
          if (released.modifiedCount > 0) {
            console.log(`[Cron] ${released.modifiedCount} reserva(s) de patrocínio liberada(s)`);
          }
        }
      } catch (bookingErr) {
        console.error('[Cron] Erro ao liberar bookings de patrocinio:', bookingErr);
      }

      // 1. Expirar propostas vencidas
      const result = await Proposal.updateMany(
        {
          validUntil: { $lt: new Date() },
          status: { $in: ['draft', 'sent', 'viewed'] }
        },
        {
          $set: { status: 'expired' }
        }
      );

      if (result.modifiedCount > 0) {
        console.log(`[Cron] ${result.modifiedCount} proposta(s) expirada(s)`);
      }

      // 2. Alertar propostas que expiram em 3 dias
      const threeDaysFromNow = new Date();
      threeDaysFromNow.setDate(threeDaysFromNow.getDate() + 3);
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const expiringProposals = await Proposal.find({
        validUntil: { $gte: today, $lte: threeDaysFromNow },
        status: { $in: ['sent', 'viewed'] }
      }).populate('agencyId', 'email companyName').populate('broadcasterId', 'email companyName').lean();

      if (expiringProposals.length > 0) {
        try {
          const emailSvc = (await import('../services/emailService')).default;

          for (const prop of expiringProposals) {
            const owner = prop.ownerType === 'broadcaster' ? prop.broadcasterId as any : prop.agencyId as any;
            const proposalsPath = prop.ownerType === 'broadcaster' ? 'broadcaster/proposals' : 'proposals';
            if (!owner?.email) continue;

            const daysLeft = Math.ceil((new Date(prop.validUntil!).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
            const html = emailSvc.createEmailTemplate({
              title: `Proposta expira em ${daysLeft} dia${daysLeft !== 1 ? 's' : ''}`,
              icon: '⏰',
              content: `<p>A proposta <strong>${prop.proposalNumber}</strong> — "${prop.title}" para <strong>${prop.clientName || 'cliente'}</strong> expira em <strong>${daysLeft} dia${daysLeft !== 1 ? 's' : ''}</strong>.</p><p>Status atual: <strong>${prop.status === 'viewed' ? 'Visualizada' : 'Enviada'}</strong></p>`,
              buttonText: 'Ver Proposta',
              buttonUrl: `${process.env.FRONTEND_URL || 'http://localhost:3000'}/${proposalsPath}/${prop._id}`,
            });

            emailSvc.sendEmail?.({
              to: owner.email,
              subject: `Proposta ${prop.proposalNumber} expira em ${daysLeft} dia${daysLeft !== 1 ? 's' : ''}`,
              html
            });
          }

          console.log(`[Cron] ${expiringProposals.length} alerta(s) de expiração enviado(s)`);
        } catch (emailErr) {
          console.error('[Cron] Erro ao enviar alertas de expiração:', emailErr);
        }
      }
    } catch (error) {
      console.error('[Cron] Erro ao expirar propostas:', error);
    }
  });
}
