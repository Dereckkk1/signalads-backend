import cron from 'node-cron';
import Proposal from '../models/Proposal';

/**
 * Cron Job — Alertas inteligentes de propostas
 * Roda diariamente às 09:00 (horário comercial).
 *
 * Alertas:
 * 1. Proposta visualizada 3+ vezes mas sem resposta há 5+ dias
 * 2. Propostas enviadas há 7+ dias sem visualização
 */
export function startProposalAlertsCron(): void {
  cron.schedule('0 9 * * 1-5', async () => { // 09:00, seg-sex
    try {
      const fiveDaysAgo = new Date();
      fiveDaysAgo.setDate(fiveDaysAgo.getDate() - 5);

      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

      // 1. Propostas visualizadas 3+ vezes sem resposta há 5+ dias
      const viewedNoResponse = await Proposal.find({
        status: 'viewed',
        viewCount: { $gte: 3 },
        viewedAt: { $lt: fiveDaysAgo }
      }).populate('agencyId', 'email companyName').lean();

      // 2. Propostas enviadas há 7+ dias sem visualização
      const sentNoView = await Proposal.find({
        status: 'sent',
        sentAt: { $lt: sevenDaysAgo }
      }).populate('agencyId', 'email companyName').lean();

      if (viewedNoResponse.length === 0 && sentNoView.length === 0) return;

      try {
        const emailSvc = (await import('../services/emailService')).default;

        // Agrupar por agência
        const agencyAlerts = new Map<string, { email: string; name: string; viewed: any[]; stale: any[] }>();

        for (const prop of viewedNoResponse) {
          const agency = prop.agencyId as any;
          if (!agency?.email) continue;
          const key = agency._id.toString();
          if (!agencyAlerts.has(key)) {
            agencyAlerts.set(key, { email: agency.email, name: agency.companyName || '', viewed: [], stale: [] });
          }
          agencyAlerts.get(key)!.viewed.push(prop);
        }

        for (const prop of sentNoView) {
          const agency = prop.agencyId as any;
          if (!agency?.email) continue;
          const key = agency._id.toString();
          if (!agencyAlerts.has(key)) {
            agencyAlerts.set(key, { email: agency.email, name: agency.companyName || '', viewed: [], stale: [] });
          }
          agencyAlerts.get(key)!.stale.push(prop);
        }

        for (const [, data] of agencyAlerts) {
          let content = '';

          if (data.viewed.length > 0) {
            content += '<h3 style="margin:0 0 8px;font-size:14px;">🔥 Propostas quentes (visualizadas mas sem resposta)</h3><ul>';
            for (const p of data.viewed) {
              content += `<li><strong>${p.proposalNumber}</strong> — "${p.title}" (${p.clientName || 'cliente'}) · ${p.viewCount} visualizações</li>`;
            }
            content += '</ul>';
          }

          if (data.stale.length > 0) {
            if (content) content += '<br>';
            content += '<h3 style="margin:0 0 8px;font-size:14px;">📭 Propostas sem visualização (7+ dias)</h3><ul>';
            for (const p of data.stale) {
              content += `<li><strong>${p.proposalNumber}</strong> — "${p.title}" (${p.clientName || 'cliente'})</li>`;
            }
            content += '</ul>';
          }

          const html = emailSvc.createEmailTemplate({
            title: 'Alerta de Propostas',
            icon: '📊',
            content,
            buttonText: 'Ver Propostas',
            buttonUrl: `${process.env.FRONTEND_URL || 'http://localhost:3000'}/proposals`,
          });

          emailSvc.sendEmail?.({
            to: data.email,
            subject: `Alerta: ${data.viewed.length + data.stale.length} proposta(s) precisam de atenção`,
            html
          });
        }

        console.log(`[Cron] Alertas enviados para ${agencyAlerts.size} agência(s)`);
      } catch (emailErr) {
        console.error('[Cron] Erro ao enviar alertas:', emailErr);
      }
    } catch (error) {
      console.error('[Cron] Erro ao gerar alertas:', error);
    }
  });
}
