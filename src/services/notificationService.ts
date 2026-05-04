import mongoose from 'mongoose';
import { User } from '../models/User';

export type NotificationKey =
  | 'newOrders'
  | 'proposalAcceptedRejected'
  | 'marketplaceOrders'
  | 'ownOrderUpdates';

/**
 * Retorna true se o user deve receber a notificacao indicada.
 *
 * Fail-open: se o user nao existe ou o campo `notificationPreferences`
 * nao esta seteado (users legados), retorna `true`. Apenas `false`
 * explicito desliga a notificacao.
 */
export async function shouldSendNotification(
  userId: string | mongoose.Types.ObjectId,
  key: NotificationKey
): Promise<boolean> {
  try {
    const user = await User.findById(userId).select('notificationPreferences').lean();
    if (!user) return true;
    const prefs = (user as any).notificationPreferences;
    if (!prefs) return true;
    return prefs[key] !== false;
  } catch (err) {
    // Fail-open em qualquer erro — nao podemos perder email transacional
    console.error('[shouldSendNotification] fail-open after error:', err);
    return true;
  }
}
