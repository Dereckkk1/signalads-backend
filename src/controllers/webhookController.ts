import { Request, Response } from 'express';
import Order from '../models/Order';
import { sendOrderPaidConfirmedToClient } from '../services/emailService';

/**
 * Webhook handler para eventos do gateway Asaas.
 *
 * Endpoint: POST /api/payment/asaas-webhook
 *
 * Segurança: a rota é pública (sem authenticateToken) — autenticação é
 * feita pelo header `asaas-access-token`, que precisa bater com
 * `process.env.WEBHOOK_AUTH_TOKEN`. Tokens diferentes retornam 401.
 *
 * Sempre responde 200 quando o token é válido (mesmo em erro interno ou
 * pedido não encontrado), porque o Asaas reenvia indefinidamente em
 * qualquer status != 2xx. O log interno registra o problema.
 *
 * Eventos suportados:
 * - PAYMENT_CONFIRMED / PAYMENT_RECEIVED → marca order como paid + paidAt
 * - PAYMENT_OVERDUE → marca payment.status = failed
 * - PAYMENT_REFUNDED → marca order.status = refunded + payment.status = refunded
 *
 * Idempotência: se order já está em estado de destino, retorna
 * { received: true, idempotent: true } sem mutar nada.
 */

const CONFIRMED_EVENTS = ['PAYMENT_CONFIRMED', 'PAYMENT_RECEIVED'];

export const asaasWebhook = async (req: Request, res: Response): Promise<void> => {
  const ts = new Date().toISOString();
  console.log(`[asaasWebhook ${ts}] hit from ip=${req.ip} ua=${req.header('user-agent') || '-'}`);

  // 1. Valida token customizado (Asaas envia no header `asaas-access-token`)
  const token = req.header('asaas-access-token');
  if (!token || token !== process.env.WEBHOOK_AUTH_TOKEN) {
    console.warn(`[asaasWebhook ${ts}] 401 — token recebido="${token || ''}" expected="${process.env.WEBHOOK_AUTH_TOKEN || ''}"`);
    res.status(401).json({ error: 'Token inválido' });
    return;
  }

  // 2. Valida payload mínimo
  const { event, payment } = req.body || {};
  console.log(`[asaasWebhook ${ts}] event=${event} paymentId=${payment?.id} status=${payment?.status}`);
  if (!event || !payment?.id) {
    console.warn(`[asaasWebhook ${ts}] skipped — payload sem event ou payment.id`, JSON.stringify(req.body));
    res.status(200).json({ received: true, skipped: 'missing event or payment.id' });
    return;
  }

  try {
    const order = await Order.findOne({ 'payment.asaasPaymentId': payment.id });
    if (!order) {
      console.warn(`[asaasWebhook ${ts}] order não encontrada — payment.asaasPaymentId="${payment.id}"`);
      res.status(200).json({ received: true, skipped: 'order not found' });
      return;
    }
    console.log(`[asaasWebhook ${ts}] order encontrada #${order.orderNumber} (status=${order.status})`);

    if (CONFIRMED_EVENTS.includes(event)) {
      // Idempotência: se já está paga, ignora reentrega
      if (order.status === 'paid') {
        console.log(`[asaasWebhook ${ts}] idempotente — order #${order.orderNumber} já está paid`);
        res.status(200).json({ received: true, idempotent: true });
        return;
      }
      order.status = 'paid' as any;
      (order.payment as any).status = 'received';
      (order.payment as any).paidAt = new Date();
      order.paidAt = new Date();
      await order.save();
      console.log(`[asaasWebhook ${ts}] ✅ order #${order.orderNumber} marcada como paid`);

      // Email "Pagamento Confirmado" — fire-and-forget, não bloqueia ack do webhook
      sendOrderPaidConfirmedToClient({
        orderNumber: order.orderNumber,
        buyerName: order.buyerName,
        buyerEmail: order.buyerEmail,
        totalValue: order.totalAmount,
      }).catch((err) => console.error(`[asaasWebhook ${ts}] erro ao enviar email de confirmação`, err));
    } else if (event === 'PAYMENT_OVERDUE') {
      (order.payment as any).status = 'failed';
      await order.save();
      console.log(`[asaasWebhook ${ts}] order #${order.orderNumber} marcada como failed (overdue)`);
    } else if (event === 'PAYMENT_REFUNDED') {
      order.status = 'refunded' as any;
      (order.payment as any).status = 'refunded';
      await order.save();
      console.log(`[asaasWebhook ${ts}] order #${order.orderNumber} marcada como refunded`);
    } else {
      console.log(`[asaasWebhook ${ts}] evento ignorado: ${event}`);
    }

    res.status(200).json({ received: true });
  } catch (err) {
    console.error('[asaasWebhook] error', err);
    // Asaas reenvia se receber != 2xx — preferimos engolir e investigar via log
    res.status(200).json({ received: true, error: true });
  }
};
