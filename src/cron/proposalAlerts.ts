import cron from 'node-cron';
import Proposal from '../models/Proposal';

/**
 * Cron Job — Alertas inteligentes de propostas
 * Roda diariamente às 09:00 (horário comercial).
 *
 * Alertas:
 * 1. Proposta visualizada 3+ vezes mas sem resposta há 5+ dias
 * 2. Propostas enviadas há 7+ dias sem visualização
 *
 * Suporta propostas de agências e emissoras (ownerType).
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
      }).populate('agencyId', 'email companyName').populate('broadcasterId', 'email companyName').lean();

      // 2. Propostas enviadas há 7+ dias sem visualização
      const sentNoView = await Proposal.find({
        status: 'sent',
        sentAt: { $lt: sevenDaysAgo }
      }).populate('agencyId', 'email companyName').populate('broadcasterId', 'email companyName').lean();

      if (viewedNoResponse.length === 0 && sentNoView.length === 0) return;

      try {
        const emailSvc = (await import('../services/emailService')).default;

        // Agrupar por dono (agência ou emissora)
        const ownerAlerts = new Map<string, { email: string; name: string; proposalsPath: string; viewed: any[]; stale: any[] }>();

        const getOwner = (prop: any) => {
          if (prop.ownerType === 'broadcaster' && prop.broadcasterId) {
            return { owner: prop.broadcasterId as any, path: 'broadcaster/proposals' };
          }
          return { owner: prop.agencyId as any, path: 'proposals' };
        };

        for (const prop of viewedNoResponse) {
          const { owner, path } = getOwner(prop);
          if (!owner?.email) continue;
          const key = owner._id.toString();
          if (!ownerAlerts.has(key)) {
            ownerAlerts.set(key, { email: owner.email, name: owner.companyName || '', proposalsPath: path, viewed: [], stale: [] });
          }
          ownerAlerts.get(key)!.viewed.push(prop);
        }

        for (const prop of sentNoView) {
          const { owner, path } = getOwner(prop);
          if (!owner?.email) continue;
          const key = owner._id.toString();
          if (!ownerAlerts.has(key)) {
            ownerAlerts.set(key, { email: owner.email, name: owner.companyName || '', proposalsPath: path, viewed: [], stale: [] });
          }
          ownerAlerts.get(key)!.stale.push(prop);
        }

        for (const [, data] of ownerAlerts) {
          let content = '';

          if (data.viewed.length > 0) {
            content += '<h3 style="margin:0 0 8px;font-size:14px;">Propostas quentes (visualizadas mas sem resposta)</h3><ul>';
            for (const p of data.viewed) {
              content += `<li><strong>${p.proposalNumber}</strong> — "${p.title}" (${p.clientName || 'cliente'}) · ${p.viewCount} visualizações</li>`;
            }
            content += '</ul>';
          }

          if (data.stale.length > 0) {
            if (content) content += '<br>';
            content += '<h3 style="margin:0 0 8px;font-size:14px;">Propostas sem visualização (7+ dias)</h3><ul>';
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
            buttonUrl: `${process.env.FRONTEND_URL || 'http://localhost:3000'}/${data.proposalsPath}`,
          });

          emailSvc.sendEmail?.({
            to: data.email,
            subject: `Alerta: ${data.viewed.length + data.stale.length} proposta(s) precisam de atenção`,
            html
          });
        }

        console.log(`[Cron] Alertas enviados para ${ownerAlerts.size} usuário(s)`);
      } catch (emailErr) {
        console.error('[Cron] Erro ao enviar alertas:', emailErr);
      }
    } catch (error) {
      console.error('[Cron] Erro ao gerar alertas:', error);
    }
  });
}
