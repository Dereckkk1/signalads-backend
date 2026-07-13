import cron from 'node-cron';
import { Cart } from '../models/Cart';
import { User } from '../models/User';
import { sendCartReminder } from '../services/emailService';
import { shouldSendNotification } from '../services/notificationService';

/**
 * Envia lembrete para carrinhos parados há 24h+ que ainda não receberam lembrete.
 * Marca `reminderSentAt` para não reenviar. Respeita as preferências de notificação.
 * Exportada para teste direto (sem o agendador).
 */
export async function runCartReminderJob(): Promise<void> {
  const cutoff = new Date(Date.now() - 24 * 3600 * 1000);
  const stale = await Cart.find({
    updatedAt: { $lt: cutoff },
    reminderSentAt: { $exists: false },
    'items.0': { $exists: true },
  }).limit(200);

  for (const cart of stale) {
    const user = await User.findById(cart.userId).select('email name companyName fantasyName');
    if (!user || !user.email) continue;
    if (!(await shouldSendNotification(String(user._id), 'ownOrderUpdates'))) continue;

    const u = user as any;
    const stationNames = [...new Set(cart.items.map((i: any) => i.broadcasterName).filter(Boolean))] as string[];
    try {
      await sendCartReminder(user.email, {
        name: u.name || u.companyName || u.fantasyName,
        itemsCount: cart.items.length,
        stationNames,
      });
      await Cart.updateOne({ _id: cart._id }, { $set: { reminderSentAt: new Date() } });
    } catch (err) {
      console.error('[cartReminder] falha ao enviar lembrete:', err);
    }
  }
}

/** Agenda o job diariamente às 10:00 (America/Sao_Paulo). */
export function startCartReminderCron(): void {
  cron.schedule('0 10 * * *', runCartReminderJob, { timezone: 'America/Sao_Paulo' });
}
