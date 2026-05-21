import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import Order from '../models/Order';

/**
 * GET /api/payment/pix/:orderId
 *
 * Retorna QR Code PIX + linha "copia e cola" para o pedido. Usado pela
 * tela de checkout PIX no frontend. Apenas o dono do pedido ou um admin
 * pode acessar.
 */
export const getPixForOrder = async (req: AuthRequest, res: Response): Promise<void> => {
  const { orderId } = req.params;
  const userId = req.userId;
  if (!userId) {
    res.status(401).json({ error: 'Não autenticado' });
    return;
  }

  try {
    const order = await Order.findById(orderId);
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

    if ((order.payment as any).method !== 'pix') {
      res.status(400).json({ error: 'Pedido não é PIX' });
      return;
    }

    res.status(200).json({
      pixQrCode: (order.payment as any).pixQrCode,
      pixCopyPaste: (order.payment as any).pixCopyPaste,
      pixExpiresAt: (order.payment as any).pixExpiresAt,
      status: (order.payment as any).status,
      asaasInvoiceUrl: (order.payment as any).asaasInvoiceUrl,
    });
  } catch (err) {
    console.error('[getPixForOrder] error', err);
    res.status(500).json({ error: 'Erro ao buscar dados PIX' });
  }
};

/**
 * GET /api/payment/status/:orderId
 *
 * Endpoint leve para polling do status de pagamento na UI. Retorna
 * status do pedido + status/método do pagamento + paidAt. Usa
 * .select() para reduzir payload e custo de query.
 */
export const getPaymentStatusForOrder = async (req: AuthRequest, res: Response): Promise<void> => {
  const { orderId } = req.params;
  const userId = req.userId;
  if (!userId) {
    res.status(401).json({ error: 'Não autenticado' });
    return;
  }

  try {
    const order = await Order.findById(orderId).select(
      'buyerId status payment.method payment.status payment.paidAt'
    );
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

    res.status(200).json({
      orderStatus: order.status,
      paymentStatus: (order.payment as any).status,
      paymentMethod: (order.payment as any).method,
      paidAt: (order.payment as any).paidAt,
    });
  } catch (err) {
    console.error('[getPaymentStatusForOrder] error', err);
    res.status(500).json({ error: 'Erro ao buscar status do pagamento' });
  }
};
