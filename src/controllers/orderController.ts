import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import Order from '../models/Order';

/**
 * GET /api/orders/:orderId
 *
 * Retorna um pedido específico pelo ID. Acesso permitido apenas
 * para o dono do pedido (buyerId) ou administradores. Usado pela
 * tela de detalhe do pedido (página `/orders/:orderId`).
 */
export const getOrderById = async (req: AuthRequest, res: Response): Promise<void> => {
  const userId = req.userId;
  if (!userId) {
    res.status(401).json({ error: 'Não autenticado' });
    return;
  }

  try {
    const order = await Order.findById(req.params.orderId);
    if (!order) {
      res.status(404).json({ error: 'Pedido não encontrado' });
      return;
    }

    const isOwner = String((order as any).buyerId) === String(userId);
    const isAdmin = req.user?.userType === 'admin';
    if (!isOwner && !isAdmin) {
      res.status(403).json({ error: 'Acesso negado' });
      return;
    }

    // Admin ve o documento completo.
    if (isAdmin) {
      res.status(200).json(order);
      return;
    }

    // SEGURANCA (3.2): o COMPRADOR nao pode ver a composicao interna do
    // preco. Devolver o documento inteiro expunha broadcasterAmount (75%
    // liquido da emissora), platformSplit, techFee e splits[] — ou seja,
    // exatamente quanto a emissora recebe. Risco comercial de
    // desintermediacao (negociar direto, fora do marketplace).
    const o = order.toObject() as any;
    delete o.broadcasterAmount;
    delete o.platformSplit;
    delete o.techFee;
    delete o.splits;
    delete o.webhookLogs;
    delete o.broadcasterInvoices;
    if (o.payment) {
      delete o.payment.asaasPaymentId;
      delete o.payment.processedEvents;
    }

    res.status(200).json(o);
  } catch (err) {
    console.error('[getOrderById] error', err);
    res.status(500).json({ error: 'Erro ao buscar pedido' });
  }
};
