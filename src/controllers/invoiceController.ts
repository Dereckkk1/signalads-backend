import { Request, Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import Order from '../models/Order';
import asaasService from '../services/asaasService';

/**
 * POST /api/invoices/emit/:orderId
 * Emite nota fiscal manualmente para um pedido
 * Requer autenticação de admin
 */
export const emitInvoiceManually = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { orderId } = req.params;
    const userId = req.userId;


    // Busca pedido
    const order = await Order.findById(orderId);

    if (!order) {
      res.status(404).json({ message: 'Pedido não encontrado' });
      return;
    }

    // Valida se já tem NF emitida
    if (order.payment.asaasInvoiceId) {
      
      // Consulta status da NF existente
      try {
        const existingInvoice = await asaasService.consultarNotaFiscal(order.payment.asaasInvoiceId);
        
        res.json({
          message: 'Nota fiscal já existe',
          invoice: {
            id: existingInvoice.id,
            number: existingInvoice.number,
            status: existingInvoice.status,
            pdfUrl: existingInvoice.pdfUrl,
            xmlUrl: existingInvoice.xmlUrl
          }
        });
        return;
      } catch (err) {
      }
    }

    // Valida se tem payment ID
    if (!order.payment.asaasPaymentId) {
      res.status(400).json({ message: 'Pedido não possui ID de pagamento do Asaas' });
      return;
    }

    // Valida se pagamento foi confirmado
    if (order.payment.status !== 'confirmed' && order.payment.status !== 'received') {
      res.status(400).json({ message: 'Pagamento ainda não foi confirmado' });
      return;
    }

    // Emite NF
    
    const nfData = await asaasService.emitirNotaFiscal({
      paymentId: order.payment.asaasPaymentId,
      serviceDescription: `Veiculação de campanha publicitária - Pedido ${order.orderNumber}`,
      observations: `Campanha de ${order.buyerName}. Total de ${order.items.length} item(ns).`,
      externalReference: order.orderNumber
    });

    // Atualiza order
    order.payment.asaasInvoiceId = nfData.id;
    order.payment.asaasInvoiceUrl = nfData.pdfUrl || '';
    await order.save();


    res.json({
      message: 'Nota fiscal emitida com sucesso',
      invoice: {
        id: nfData.id,
        number: nfData.number,
        status: nfData.status,
        pdfUrl: nfData.pdfUrl,
        xmlUrl: nfData.xmlUrl,
        value: nfData.value
      }
    });

  } catch (error: any) {
    console.error('❌ Erro ao emitir nota fiscal:', error);
    res.status(500).json({ 
      message: 'Erro ao emitir nota fiscal',
      error: error.message 
    });
  }
};

/**
 * GET /api/invoices/:orderId
 * Consulta nota fiscal de um pedido
 */
export const getInvoiceByOrder = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { orderId } = req.params;

    const order = await Order.findById(orderId);

    if (!order) {
      res.status(404).json({ message: 'Pedido não encontrado' });
      return;
    }

    if (!order.payment.asaasInvoiceId) {
      res.status(404).json({ message: 'Pedido não possui nota fiscal' });
      return;
    }

    // Consulta NF no Asaas
    const invoice = await asaasService.consultarNotaFiscal(order.payment.asaasInvoiceId);

    res.json({
      invoice: {
        id: invoice.id,
        number: invoice.number,
        status: invoice.status,
        pdfUrl: invoice.pdfUrl,
        xmlUrl: invoice.xmlUrl,
        value: invoice.value,
        effectiveDate: invoice.effectiveDate,
        observations: invoice.observations
      }
    });

  } catch (error: any) {
    console.error('❌ Erro ao consultar nota fiscal:', error);
    res.status(500).json({ 
      message: 'Erro ao consultar nota fiscal',
      error: error.message 
    });
  }
};

/**
 * POST /api/invoices/cancel/:orderId
 * Cancela nota fiscal de um pedido
 * Requer autenticação de admin
 */
export const cancelInvoice = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { orderId } = req.params;
    const { reason } = req.body;

    if (!reason) {
      res.status(400).json({ message: 'Motivo do cancelamento é obrigatório' });
      return;
    }

    const order = await Order.findById(orderId);

    if (!order) {
      res.status(404).json({ message: 'Pedido não encontrado' });
      return;
    }

    if (!order.payment.asaasInvoiceId) {
      res.status(404).json({ message: 'Pedido não possui nota fiscal' });
      return;
    }

    // Cancela NF no Asaas
    await asaasService.cancelarNotaFiscal(order.payment.asaasInvoiceId, reason);

    // Atualiza order (remove IDs de NF)
    order.payment.asaasInvoiceId = undefined;
    order.payment.asaasInvoiceUrl = undefined;
    await order.save();


    res.json({ message: 'Nota fiscal cancelada com sucesso' });

  } catch (error: any) {
    console.error('❌ Erro ao cancelar nota fiscal:', error);
    res.status(500).json({ 
      message: 'Erro ao cancelar nota fiscal',
      error: error.message 
    });
  }
};
