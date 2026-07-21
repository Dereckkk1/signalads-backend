import { Request, Response } from 'express';
import { timingSafeEqual } from 'crypto';
import Order from '../models/Order';
import { sendOrderPaidConfirmedToClient } from '../services/emailService';
import { getPaymentStatus, CONFIRMED_ASAAS_STATUSES } from '../services/asaasService';
import { getClientIp } from '../utils/clientIp';

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

/** Eventos do Asaas que SINALIZAM confirmacao — nao confirmam por si sos. */
const CONFIRMED_EVENTS = ['PAYMENT_CONFIRMED', 'PAYMENT_RECEIVED'];

/** Eventos que invalidam um pagamento previamente aceito. */
const REFUSED_EVENTS = [
  'PAYMENT_REFUSED',
  'PAYMENT_DELETED',
  'PAYMENT_CHARGEBACK_REQUESTED',
  'PAYMENT_CHARGEBACK_DISPUTE',
];

export const asaasWebhook = async (req: Request, res: Response): Promise<void> => {
  const ts = new Date().toISOString();
  console.log(`[asaasWebhook ${ts}] hit from ip=${getClientIp(req)} ua=${req.header('user-agent') || '-'}`);

  // 1. Valida token customizado (Asaas envia no header `asaas-access-token`)
  // NUNCA logar o token esperado nem o recebido: a rota é publica, entao
  // qualquer requisicao com token errado imprimiria o segredo no stdout.
  // Comparacao em tempo constante para nao vazar prefixo por timing.
  const token = req.header('asaas-access-token') || '';
  const expectedToken = process.env.WEBHOOK_AUTH_TOKEN || '';
  const tokenBuf = Buffer.from(token);
  const expectedBuf = Buffer.from(expectedToken);
  const tokenIsValid =
    expectedToken.length > 0 &&
    tokenBuf.length === expectedBuf.length &&
    timingSafeEqual(tokenBuf, expectedBuf);

  if (!tokenIsValid) {
    console.warn(`[asaasWebhook ${ts}] 401 — token invalido (len=${token.length}) ip=${getClientIp(req)}`);
    res.status(401).json({ error: 'Token inválido' });
    return;
  }

  // 2. Valida payload mínimo
  const { event, payment } = req.body || {};
  console.log(`[asaasWebhook ${ts}] event=${event} paymentId=${payment?.id} status=${payment?.status}`);
  if (!event || !payment?.id) {
    // Nao serializar req.body: o payload do Asaas carrega PII e dados
    // financeiros (nome, CPF/CNPJ, e-mail, valor) — logar o corpo inteiro
    // cria copia nao gerenciada de dado sensivel (LGPD).
    console.warn(
      `[asaasWebhook ${ts}] skipped — payload sem event ou payment.id ` +
        `(temEvent=${!!event} temPaymentId=${!!payment?.id})`
    );
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

    // Idempotência por EVENTO (nao por estado final): sem isso, reentrega de
    // PAYMENT_REFUNDED sobre pedido ja reembolsado reexecuta efeitos colaterais.
    const eventId = typeof req.body?.id === 'string' ? req.body.id : undefined;
    if (eventId && (order.payment as any).processedEvents?.some((e: any) => e.eventId === eventId)) {
      console.log(`[asaasWebhook ${ts}] idempotente — evento ${eventId} já processado`);
      res.status(200).json({ received: true, idempotent: true });
      return;
    }
    const markEventProcessed = () => {
      if (!eventId) return;
      const p = order.payment as any;
      if (!Array.isArray(p.processedEvents)) p.processedEvents = [];
      p.processedEvents.push({ eventId, event, at: new Date() });
    };

    if (CONFIRMED_EVENTS.includes(event)) {
      // Idempotência: se já está paga, ignora reentrega
      if (order.status === 'paid') {
        console.log(`[asaasWebhook ${ts}] idempotente — order #${order.orderNumber} já está paid`);
        res.status(200).json({ received: true, idempotent: true });
        return;
      }

      // ── RECONCILIACAO (nao confiar no corpo do webhook) ──────────────
      // O corpo do evento e apenas uma notificacao vinda de um remetente
      // autenticado por token estatico. Confirmar pagamento a partir dele
      // permite que, de posse do token, alguem marque qualquer pedido como
      // pago — ou que uma cobranca legitima de R$ 5 confirme um pedido de
      // R$ 50.000. A verdade vem de GET /payments/:id.
      const remote = await getPaymentStatus(payment.id);

      if (!CONFIRMED_ASAAS_STATUSES.includes(remote.status)) {
        console.warn(
          `[asaasWebhook ${ts}] ⚠️ status divergente — order #${order.orderNumber} ` +
            `evento=${event} statusRemoto=${remote.status}`
        );
        (order.payment as any).asaasStatus = remote.status;
        markEventProcessed();
        await order.save();
        res.status(200).json({ received: true, skipped: 'status divergente' });
        return;
      }

      const expectedAmount = Number(
        (order.payment as any).chargedAmount ?? order.totalAmount
      );
      const paidAmount = Number(remote.value);
      if (!Number.isFinite(paidAmount) || Math.abs(paidAmount - expectedAmount) > 0.01) {
        console.error(
          `[asaasWebhook ${ts}] 🚨 VALOR DIVERGENTE — order #${order.orderNumber} ` +
            `esperado=${expectedAmount} recebido=${paidAmount}. Pedido NAO confirmado.`
        );
        (order.payment as any).asaasStatus = remote.status;
        (order.payment as any).failureReason = `Valor divergente: esperado ${expectedAmount}, recebido ${paidAmount}`;
        markEventProcessed();
        await order.save();
        res.status(200).json({ received: true, skipped: 'valor divergente' });
        return;
      }

      order.status = 'paid' as any;
      (order.payment as any).status = 'received';
      (order.payment as any).asaasStatus = remote.status;
      (order.payment as any).paidAt = new Date();
      order.paidAt = new Date();
      markEventProcessed();
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
      markEventProcessed();
      await order.save();
      console.log(`[asaasWebhook ${ts}] order #${order.orderNumber} marcada como failed (overdue)`);
    } else if (REFUSED_EVENTS.includes(event)) {
      // Pagamento recusado/estornado pelo gateway apos a criacao do pedido —
      // antes esses eventos caiam no ramo "ignorado" e o pedido seguia pago.
      (order.payment as any).status = 'failed';
      (order.payment as any).failureReason = `Evento do gateway: ${event}`;
      if (order.status === 'paid') order.status = 'pending_payment' as any;
      markEventProcessed();
      await order.save();
      console.warn(`[asaasWebhook ${ts}] order #${order.orderNumber} revertida por ${event}`);
    } else if (event === 'PAYMENT_REFUNDED') {
      if (order.status === 'refunded') {
        console.log(`[asaasWebhook ${ts}] idempotente — order #${order.orderNumber} já está refunded`);
        res.status(200).json({ received: true, idempotent: true });
        return;
      }
      order.status = 'refunded' as any;
      (order.payment as any).status = 'refunded';
      markEventProcessed();
      await order.save();
      console.log(`[asaasWebhook ${ts}] order #${order.orderNumber} marcada como refunded`);
    } else {
      console.log(`[asaasWebhook ${ts}] evento ignorado: ${event}`);
    }

    res.status(200).json({ received: true });
  } catch (err) {
    console.error(`[asaasWebhook ${ts}] erro transitório ao processar evento`, err);
    // 500 (nao 200): erro aqui e transitorio (banco fora, timeout do Asaas).
    // Respondendo 200 o Asaas considera entregue e NUNCA reenvia — um
    // PAYMENT_CONFIRMED legitimo perdido deixa o pedido pago eternamente
    // em pending_payment. A idempotencia por eventId torna o retry seguro.
    res.status(500).json({ received: false });
  }
};
