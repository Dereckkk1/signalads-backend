import { Request, Response } from 'express';
import Order from '../models/Order';
import { User } from '../models/User';
import emailService from '../services/emailService';
import asaasService from '../services/asaasService';

/**
 * Lista todos os pedidos "A Faturar" pendentes de validação
 * GET /api/admin/billing/pending
 */
export const getPendingBillingOrders = async (req: Request, res: Response) => {
  try {
    // Primeiro vamos ver TODOS os pedidos billing para debug
    const allBillingOrders = await Order.find({
      'payment.method': 'billing'
    }).sort({ createdAt: -1 });



    const orders = await Order.find({
      'payment.method': 'billing',
      billingStatus: 'pending_validation',
      status: 'pending_billing_validation'
    }).sort({ createdAt: -1 });


    res.json(orders);
  } catch (error: any) {
    console.error('❌ Erro ao buscar pedidos pendentes:', error.message);
    res.status(500).json({ message: 'Erro ao buscar pedidos pendentes' });
  }
};

/**
 * Aprova pedido "A Faturar" e gera cobrança + NF automaticamente
 * POST /api/admin/billing/:orderId/approve
 * Body: { billingType: 'BOLETO' | 'PIX' | 'BANK_TRANSFER' }
 * 
 * FLUXO "A FATURAR":
 * 1. Cliente faz pedido com método "A Faturar"
 * 2. Admin aprova e escolhe tipo de cobrança (boleto/PIX/transferência)
 * 3. Sistema gera cobrança + NF automaticamente via Asaas
 * 4. Documento da NF é anexado automaticamente ao pedido
 * 5. Cliente recebe email com NF e dados de pagamento
 * 6. Emissoras recebem pedido e aprovam
 * 7. Cliente paga por fora (boleto/PIX/transferência)
 * 8. Admin confirma pagamento → Wallets creditadas
 */
export const approveBillingOrder = async (req: Request, res: Response) => {
  try {
    const { orderId } = req.params;
    const { billingType } = req.body; // 'BOLETO' | 'PIX' | 'BANK_TRANSFER'

    // Validação do tipo de cobrança
    if (!billingType || !['BOLETO', 'PIX', 'BANK_TRANSFER'].includes(billingType)) {
      return res.status(400).json({
        message: 'Tipo de cobrança inválido. Escolha: BOLETO, PIX ou BANK_TRANSFER'
      });
    }

    const order = await Order.findById(orderId);

    if (!order) {
      return res.status(404).json({ message: 'Pedido não encontrado' });
    }

    if (order.payment.method !== 'billing') {
      return res.status(400).json({ message: 'Este pedido não é do tipo faturamento' });
    }

    if (order.billingStatus !== 'pending_validation') {
      return res.status(400).json({ message: 'Pedido já foi validado' });
    }

    // Atualiza status
    order.billingStatus = 'awaiting_payment'; // NF enviada, aguardando pagamento
    order.status = 'awaiting_payment'; // Status geral também muda
    order.payment.status = 'pending'; // Pagamento ainda pendente

    await order.save();


    // 🆕 GERAR COBRANÇA + NOTA FISCAL VIA ASAAS
    try {
      // Validação: billingData deve existir
      if (!order.billingData) {
        throw new Error('Dados de faturamento não encontrados no pedido');
      }

      // 1. Criar/buscar cliente no Asaas
      const asaasCustomer = await asaasService.createOrUpdateCustomer({
        name: order.billingData.razaoSocial,
        email: order.billingData.billingEmail,
        phone: order.billingData.phone,
        cpfCnpj: order.billingData.cnpj,
        postalCode: order.billingData.address?.cep,
        address: order.billingData.address?.street,
        addressNumber: order.billingData.address?.number,
        complement: order.billingData.address?.complement,
        province: order.billingData.address?.neighborhood,
        externalReference: order._id.toString()
      });


      // 2. Criar cobrança (tipo escolhido pelo admin)
      const dueDate = new Date();
      dueDate.setDate(dueDate.getDate() + 30); // Vencimento em 30 dias
      const dueDateString: string = dueDate.toISOString().split('T')[0] as string;

      // Para transferência bancária, usa UNDEFINED (cobrança manual)
      const asaasBillingType = billingType === 'BANK_TRANSFER' ? 'UNDEFINED' : billingType;

      const payment = await asaasService.createPayment({
        customer: asaasCustomer.id,
        billingType: asaasBillingType as 'BOLETO' | 'PIX' | 'UNDEFINED',
        value: order.totalAmount,
        dueDate: dueDateString,
        description: `Pedido #${order.orderNumber} - Veiculação de mídia publicitária`,
        externalReference: order._id.toString()
      });


      // 3. Emitir Nota Fiscal vinculada à cobrança
      const itemsDescription = order.items
        .map(item => `${item.quantity}x ${item.productName} - ${item.broadcasterName}`)
        .join('\n');

      const invoice = await asaasService.issueServiceInvoice({
        payment: payment.id,
        serviceDescription: `Veiculação de mídia publicitária em rádio\n\nItens:\n${itemsDescription}`,
        observations: `Pedido: ${order.orderNumber}\nPeríodo de veiculação conforme grade`,
        externalReference: order._id.toString(),
        municipalServiceCode: '',
        municipalServiceName: 'Veiculação de mídia publicitária'
      });


      // 4. Salvar dados da NF e cobrança no pedido
      order.payment.asaasPaymentId = payment.id;
      order.payment.asaasInvoiceId = invoice.id;
      order.payment.asaasInvoiceUrl = invoice.pdfUrl || payment.invoiceUrl;
      order.payment.asaasBoletoUrl = payment.bankSlipUrl;
      order.payment.pixQrCode = payment.pixQrCode;
      order.payment.pixCopyPaste = payment.pixCopyPaste;

      // 5. Adicionar documento da NF automaticamente ao array billingDocuments
      if (!order.billingDocuments) {
        order.billingDocuments = [];
      }

      order.billingDocuments.push({
        type: 'nota_fiscal',
        fileName: `NF_${order.orderNumber}_${invoice.id}.pdf`,
        fileUrl: invoice.pdfUrl || payment.invoiceUrl || '',
        fileSize: 0,
        uploadedBy: 'admin',
        uploadedAt: new Date(),
        status: 'approved',
        description: `Nota Fiscal gerada automaticamente via Asaas - Tipo: ${billingType}`
      } as any);

      await order.save();

      if (billingType === 'PIX') {
      }
      if (billingType === 'BOLETO') {
      }

    } catch (asaasError: any) {
      console.error('⚠️ Erro ao gerar NF via Asaas:', asaasError.message);

      // Se erro for por falta de informações fiscais, loga instruções
      if (asaasError.message?.includes('invalid_fiscal_info')) {
      }

      // Não bloqueia a aprovação, apenas loga o erro
      // Admin pode gerar manualmente depois
    }


    // Envia e-mail para cliente
    await emailService.sendBillingApproved({
      clientEmail: order.buyerEmail,
      clientName: order.buyerName,
      orderNumber: order.orderNumber,
      totalValue: order.totalAmount
    });

    // Envia e-mail para emissoras com DADOS CADASTRAIS DA PLATAFORMA para emitirem NF
    const broadcasters = [...new Set(order.items.map(item => ({
      id: item.broadcasterId,
      name: item.broadcasterName
    })))];

    // Dados cadastrais da plataforma (para emissora emitir NF CONTRA a plataforma)
    const platformBillingData = {
      razaoSocial: process.env.PLATFORM_RAZAO_SOCIAL || 'E-rádios Tecnologia Ltda',
      cnpj: process.env.PLATFORM_CNPJ || '00.000.000/0001-00',
      address: process.env.PLATFORM_ADDRESS || 'Rua Exemplo, 123 - São Paulo/SP - CEP 00000-000',
      email: process.env.PLATFORM_BILLING_EMAIL || 'financeiro@E-rádios.com.br',
      phone: process.env.PLATFORM_PHONE || '(11) 0000-0000'
    };

    for (const broadcaster of broadcasters) {
      const broadcasterUser = await User.findById(broadcaster.id);
      if (broadcasterUser?.email) {
        // Calcula valor que a emissora receberá (80% do seu gross)
        const broadcasterItems = order.items.filter(item => item.broadcasterId.toString() === broadcaster.id.toString());
        const broadcasterGross = broadcasterItems.reduce((sum, item) => sum + (item.totalPrice || 0), 0);
        const broadcasterValue = broadcasterGross * 0.80; // 80% para emissora

        // Busca datas da campanha (primeira e última data)
        // schedule é um Map<string, number> onde key = 'YYYY-MM-DD' e value = quantity
        const allDates: string[] = [];
        broadcasterItems.forEach(item => {
          if (item.schedule) {
            const dates = Array.from(item.schedule.keys());
            allDates.push(...dates);
          }
        });

        const startDate = allDates.length > 0
          ? new Date(Math.min(...allDates.map(d => new Date(d).getTime()))).toLocaleDateString('pt-BR')
          : 'N/A';
        const endDate = allDates.length > 0
          ? new Date(Math.max(...allDates.map(d => new Date(d).getTime()))).toLocaleDateString('pt-BR')
          : 'N/A';

        await emailService.sendBillingOrderToBroadcaster({
          broadcasterEmail: broadcasterUser.email,
          broadcasterName: broadcaster.name,
          orderNumber: order.orderNumber,
          broadcasterValue, // Valor que a emissora deve faturar
          platformBillingData, // Dados da plataforma para emissora emitir NF
          startDate,
          endDate
        });
      }
    }

    res.json({
      message: 'Pedido aprovado com sucesso',
      order
    });

  } catch (error: any) {
    console.error('❌ Erro ao aprovar pedido:', error.message);
    res.status(500).json({ message: 'Erro ao aprovar pedido' });
  }
};

/**
 * Recusa pedido "A Faturar"
 * POST /api/admin/billing/:orderId/reject
 * Body: { reason: string }
 */
export const rejectBillingOrder = async (req: Request, res: Response) => {
  try {
    const { orderId } = req.params;
    const { reason } = req.body;

    if (!reason || reason.trim() === '') {
      return res.status(400).json({ message: 'Motivo da recusa é obrigatório' });
    }

    const order = await Order.findById(orderId);

    if (!order) {
      return res.status(404).json({ message: 'Pedido não encontrado' });
    }

    if (order.payment.method !== 'billing') {
      return res.status(400).json({ message: 'Este pedido não é do tipo faturamento' });
    }

    if (order.billingStatus !== 'pending_validation') {
      return res.status(400).json({ message: 'Pedido já foi validado' });
    }

    // Atualiza status
    order.billingStatus = 'rejected';
    order.billingRejectionReason = reason;
    order.status = 'billing_rejected';
    order.payment.status = 'failed';
    order.payment.failureReason = reason;

    await order.save();


    // Envia e-mail para cliente
    await emailService.sendBillingRejected({
      clientEmail: order.buyerEmail,
      clientName: order.buyerName,
      orderNumber: order.orderNumber,
      reason
    });

    res.json({
      message: 'Pedido recusado',
      order
    });

  } catch (error: any) {
    console.error('❌ Erro ao recusar pedido:', error.message);
    res.status(500).json({ message: 'Erro ao recusar pedido' });
  }
};

/**
 * Marca NF do cliente como paga E credita wallets
 * POST /api/admin/billing/:orderId/mark-client-paid
 * 
 * ESTE É O MOMENTO QUE AS WALLETS SÃO CREDITADAS!
 * Quando o cliente paga a NF por fora (boleto/transferência),
 * o admin confirma o pagamento e o sistema credita as wallets.
 */
export const markClientInvoiceAsPaid = async (req: Request, res: Response) => {
  try {
    const { orderId } = req.params;
    const { paidAt } = req.body; // Data do pagamento

    const order = await Order.findById(orderId);

    if (!order) {
      return res.status(404).json({ message: 'Pedido não encontrado' });
    }

    if (order.payment.method !== 'billing') {
      return res.status(400).json({ message: 'Este pedido não é do tipo faturamento' });
    }

    if (order.billingStatus !== 'awaiting_payment' && order.billingStatus !== 'invoiced_client') {
      return res.status(400).json({
        message: `Pedido não pode ser marcado como pago. Status atual: ${order.billingStatus}`
      });
    }


    // ⚠️ NO FLUXO "A FATURAR", AS WALLETS NÃO SÃO CREDITADAS!
    // Motivo: Emissoras emitem NF diretamente CONTRA a plataforma
    // O pagamento acontece por fora (transferência bancária/boleto)
    // A plataforma recebe do cliente e paga as emissoras via NF delas



    // Atualiza status do pedido
    order.billingStatus = 'paid_client'; // Cliente pagou
    order.status = 'approved'; // Pedido aprovado (campanha pode veicular)
    order.payment.status = 'received'; // Cliente pagou
    order.payment.paidAt = paidAt ? new Date(paidAt) : new Date();

    // Atualiza fatura do cliente como paga
    const clientInvoice = order.billingInvoices.find(inv => inv.type === 'platform_to_client');
    if (clientInvoice) {
      clientInvoice.status = 'paid';
      clientInvoice.paidAt = order.payment.paidAt;
    }

    await order.save();


    // Notifica cliente que pagamento foi confirmado
    await emailService.sendPaymentConfirmed({
      clientEmail: order.buyerEmail,
      clientName: order.buyerName,
      orderNumber: order.orderNumber,
      totalValue: order.totalAmount,
      paidAt: order.payment.paidAt
    });

    res.json({
      message: 'Pagamento confirmado! Emissoras foram notificadas para emitirem NF contra a plataforma.',
      order: {
        orderNumber: order.orderNumber,
        billingStatus: order.billingStatus,
        paidAt: order.payment.paidAt,
        creditsProcessed: order.splits.map(s => ({
          recipient: s.recipientName,
          amount: s.amount
        }))
      }
    });

  } catch (error: any) {
    console.error('❌ Erro ao marcar NF como paga:', error.message);
    res.status(500).json({ message: 'Erro ao processar pagamento' });
  }
};

/**
 * Upload de documento de faturamento
 * POST /api/admin/billing/:orderId/upload-document
 * Body: { type, description } + arquivo (multipart/form-data)
 */
export const uploadBillingDocument = async (req: Request, res: Response) => {
  try {
    const { orderId } = req.params;
    const { type, description } = req.body;
    const file = (req as any).file;

    if (!file) {
      return res.status(400).json({ message: 'Arquivo não enviado' });
    }

    if (!type || !['nota_fiscal', 'comprovante_pagamento', 'boleto', 'outro'].includes(type)) {
      return res.status(400).json({ message: 'Tipo de documento inválido' });
    }

    const order = await Order.findById(orderId);

    if (!order) {
      return res.status(404).json({ message: 'Pedido não encontrado' });
    }

    if (order.payment.method !== 'billing') {
      return res.status(400).json({ message: 'Este pedido não é do tipo faturamento' });
    }

    // Upload do arquivo
    const { uploadFile } = await import('../config/storage');
    const fileUrl = await uploadFile(
      file.buffer,
      file.originalname,
      'billing-documents',
      file.mimetype
    );

    // Adiciona documento ao pedido
    if (!order.billingDocuments) {
      order.billingDocuments = [];
    }

    const userId = (req as any).userId;

    const document = {
      type,
      fileName: file.originalname,
      fileUrl,
      fileSize: file.size,
      uploadedBy: 'admin', // TODO: detectar se é client/admin/broadcaster baseado no req.userId
      uploadedAt: new Date(),
      status: 'approved' as const, // Aprovado automaticamente ao fazer upload
      approvedBy: userId,
      approvedAt: new Date(),
      description: description || ''
    };

    order.billingDocuments.push(document as any);
    await order.save();


    // Pega o último documento adicionado
    const addedDoc = order.billingDocuments[order.billingDocuments.length - 1];

    // Buscar dados do cliente para enviar email de notificação
    try {
      const { User } = await import('../models/User');
      const buyer = await User.findById(order.buyerId);

      if (buyer && buyer.email) {
        const { sendInvoiceIssued } = await import('../services/emailService');

        // Calcula vencimento: 15 dias úteis a partir de hoje
        const dueDate = new Date();
        dueDate.setDate(dueDate.getDate() + 15);
        const dueDateStr = dueDate.toLocaleDateString('pt-BR');

        await sendInvoiceIssued({
          clientName: buyer.companyName || buyer.razaoSocial || buyer.email,
          clientEmail: buyer.email,
          orderNumber: order.orderNumber,
          totalValue: order.payment.totalAmount || 0,
          dueDate: dueDateStr,
          boletoUrl: fileUrl
        });
      }
    } catch (emailError: any) {
      console.error('⚠️ Erro ao enviar email de NF:', emailError.message);
    } res.json({
      message: 'Documento enviado com sucesso',
      document: {
        ...document,
        _id: (addedDoc as any)._id
      }
    });

  } catch (error: any) {
    console.error('❌ Erro ao fazer upload:', error.message);
    res.status(500).json({ message: 'Erro ao fazer upload do documento' });
  }
};

/**
 * Aprovar documento de faturamento
 * POST /api/admin/billing/:orderId/documents/:documentId/approve
 */
export const approveBillingDocument = async (req: Request, res: Response) => {
  try {
    const { orderId, documentId } = req.params;
    const userId = (req as any).userId; // Do middleware de autenticação

    const order = await Order.findById(orderId);

    if (!order) {
      return res.status(404).json({ message: 'Pedido não encontrado' });
    }

    const document = order.billingDocuments?.find((doc: any) => doc._id.toString() === documentId);

    if (!document) {
      return res.status(404).json({ message: 'Documento não encontrado' });
    }

    if (document.status !== 'pending_approval') {
      return res.status(400).json({ message: 'Documento já foi processado' });
    }

    document.status = 'approved';
    document.approvedBy = userId;
    document.approvedAt = new Date();

    await order.save();


    // Buscar dados do cliente para enviar email
    try {
      const buyer = await User.findById(order.buyerId);

      if (buyer && buyer.email) {
        // Enviar email para cliente notificando que NF foi emitida
        await emailService.sendInvoiceIssued({
          clientEmail: buyer.email,
          clientName: buyer.companyName || buyer.email,
          orderNumber: order.orderNumber,
          totalValue: order.payment.totalAmount || 0,
          boletoUrl: document.fileUrl,
          dueDate: 'Conforme boleto'
        });
      }
    } catch (emailError: any) {
      console.error('⚠️ Erro ao enviar email de NF:', emailError.message);
      // Não falha a operação se o email não enviar
    }

    res.json({
      message: 'Documento aprovado com sucesso',
      document
    });

  } catch (error: any) {
    console.error('❌ Erro ao aprovar documento:', error.message);
    res.status(500).json({ message: 'Erro ao aprovar documento' });
  }
};

/**
 * Recusar documento de faturamento
 * POST /api/admin/billing/:orderId/documents/:documentId/reject
 * Body: { reason }
 */
export const rejectBillingDocument = async (req: Request, res: Response) => {
  try {
    const { orderId, documentId } = req.params;
    const { reason } = req.body;
    const userId = (req as any).userId;

    if (!reason) {
      return res.status(400).json({ message: 'Motivo da recusa é obrigatório' });
    }

    const order = await Order.findById(orderId);

    if (!order) {
      return res.status(404).json({ message: 'Pedido não encontrado' });
    }

    const document = order.billingDocuments?.find((doc: any) => doc._id.toString() === documentId);

    if (!document) {
      return res.status(404).json({ message: 'Documento não encontrado' });
    }

    if (document.status !== 'pending_approval') {
      return res.status(400).json({ message: 'Documento já foi processado' });
    }

    document.status = 'rejected';
    document.approvedBy = userId;
    document.approvedAt = new Date();
    document.rejectionReason = reason;

    await order.save();


    res.json({
      message: 'Documento recusado',
      document
    });

  } catch (error: any) {
    console.error('❌ Erro ao recusar documento:', error.message);
    res.status(500).json({ message: 'Erro ao recusar documento' });
  }
};

/**
 * Lista todas as faturas aguardando pagamento do cliente
 * GET /api/admin/billing/awaiting-payment
 */
export const getAwaitingPayment = async (req: Request, res: Response) => {
  try {
    const orders = await Order.find({
      'payment.method': 'billing',
      billingStatus: 'awaiting_payment',
      status: 'awaiting_payment'
    }).sort({ createdAt: -1 });


    res.json(orders);
  } catch (error: any) {
    console.error('❌ Erro ao buscar pedidos aguardando pagamento:', error.message);
    res.status(500).json({ message: 'Erro ao buscar pedidos aguardando pagamento' });
  }
};

/**
 * Lista todas as faturas emitidas (contas a receber)
 * GET /api/admin/billing/receivables
 */
export const getAccountsReceivable = async (req: Request, res: Response) => {
  try {
    const orders = await Order.find({
      'payment.method': 'billing',
      billingStatus: { $in: ['invoiced_client', 'paid_client'] },
      status: { $in: ['completed', 'completed_billing'] }
    }).sort({ createdAt: -1 });

    // Filtra apenas faturas do tipo platform_to_client
    const receivables = orders.map(order => {
      const clientInvoices = order.billingInvoices.filter(inv => inv.type === 'platform_to_client');
      return {
        orderNumber: order.orderNumber,
        clientName: order.buyerName,
        totalValue: order.totalAmount,
        invoices: clientInvoices,
        status: order.billingStatus
      };
    });

    res.json(receivables);
  } catch (error: any) {
    console.error('❌ Erro ao buscar contas a receber:', error.message);
    res.status(500).json({ message: 'Erro ao buscar contas a receber' });
  }
};

/**
 * Lista todas as faturas de emissoras (contas a pagar)
 * GET /api/admin/billing/payables
 */
export const getAccountsPayable = async (req: Request, res: Response) => {
  try {
    const orders = await Order.find({
      'payment.method': 'billing',
      billingStatus: { $in: ['paid_client', 'completed_billing'] },
      status: { $in: ['completed', 'completed_billing'] }
    }).sort({ createdAt: -1 });

    // Filtra apenas faturas do tipo broadcaster_to_platform
    const payables = orders.flatMap(order => {
      const broadcasterInvoices = order.billingInvoices.filter(inv => inv.type === 'broadcaster_to_platform');
      return broadcasterInvoices.map(inv => ({
        orderNumber: order.orderNumber,
        broadcasterName: inv.recipientName,
        amount: inv.amount,
        dueDate: inv.dueDate,
        status: inv.status,
        invoiceUrl: inv.invoiceUrl,
        paidAt: inv.paidAt
      }));
    });

    res.json(payables);
  } catch (error: any) {
    console.error('❌ Erro ao buscar contas a pagar:', error.message);
    res.status(500).json({ message: 'Erro ao buscar contas a pagar' });
  }
};

/**
 * GET /api/billing/my-invoices
 * Cliente visualiza suas NFs emitidas pela plataforma
 * Retorna pedidos com documentos anexados (apenas visualização)
 */
export const getMyInvoices = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;


    // Busca pedidos "A Faturar" do cliente
    const orders = await Order.find({
      buyerId: userId,
      'payment.method': 'billing',
      billingStatus: { $in: ['awaiting_payment', 'paid_client', 'invoiced_client', 'completed_billing'] }
    })
      .sort({ createdAt: -1 })
      .select('orderNumber createdAt billingData billingDocuments billingStatus payment items');


    // Log detalhado para debug


    // Mapeia para formato amigável
    const invoices = orders.map(order => {
      const approvedDocs = order.billingDocuments?.filter((doc: any) => doc.status === 'approved') || [];

      return {
        _id: order._id, // ID do pedido para navegar
        orderNumber: order.orderNumber,
        orderDate: order.createdAt,
        totalAmount: order.payment.totalAmount,
        status: order.billingStatus,
        paymentStatus: order.payment.status,
        paidAt: order.payment.paidAt,
        documents: approvedDocs.map((doc: any) => ({
          id: doc._id,
          type: doc.type,
          fileName: doc.fileName,
          fileUrl: doc.fileUrl,
          fileSize: doc.fileSize,
          uploadedAt: doc.uploadedAt,
          description: doc.description
        })),
        items: order.items
      };
    });

    res.json(invoices);
  } catch (error: any) {
    console.error('❌ Erro ao buscar NFs do cliente:', error.message);
    res.status(500).json({ message: 'Erro ao buscar suas notas fiscais' });
  }
};

/**
 * Emissora faz upload da NF que ela emitiu CONTRA a plataforma
 * POST /api/billing/broadcaster/upload-invoice/:orderId
 * 
 * FLUXO:
 * 1. Admin aprova pedido "A Faturar" e envia dados da plataforma para emissora
 * 2. Emissora emite NF CONTRA a plataforma (tomador = plataforma)
 * 3. Emissora faz upload da NF aqui (documento fica anexado ao pedido)
 * 4. Admin vê a NF no painel e efetua pagamento externo
 */
export const uploadBroadcasterInvoice = async (req: Request, res: Response) => {
  try {
    const { orderId } = req.params;
    const userId = (req as any).userId;
    const file = (req as any).file;
    const { description } = req.body;


    if (!file) {
      return res.status(400).json({ message: 'Arquivo não enviado' });
    }

    // Busca o pedido
    const order = await Order.findById(orderId);

    if (!order) {
      return res.status(404).json({ message: 'Pedido não encontrado' });
    }

    // Valida que é um pedido "A Faturar"
    if (order.payment.method !== 'billing') {
      return res.status(400).json({ message: 'Este pedido não é do tipo "A Faturar"' });
    }

    // Valida que a emissora faz parte do pedido
    const broadcasterInOrder = order.items.some(
      item => item.broadcasterId.toString() === userId
    );

    if (!broadcasterInOrder) {
      return res.status(403).json({ message: 'Você não faz parte deste pedido' });
    }

    // Valida tipo de arquivo (PDF, JPG, PNG)
    const allowedMimeTypes = ['application/pdf', 'image/jpeg', 'image/png'];
    if (!allowedMimeTypes.includes(file.mimetype)) {
      return res.status(400).json({
        message: 'Formato não suportado. Use PDF, JPG ou PNG.'
      });
    }

    // Faz upload para storage
    const { uploadFile } = await import('../config/storage');
    const fileUrl = await uploadFile(
      file.buffer,
      file.originalname,
      'broadcaster-invoices',
      file.mimetype
    );

    // Adiciona documento ao array (tipo específico para NF da emissora)
    if (!order.broadcasterInvoices) {
      order.broadcasterInvoices = [];
    }

    (order.broadcasterInvoices as any).push({
      broadcasterId: userId,
      type: 'broadcaster_nf', // NF emitida pela emissora CONTRA a plataforma
      fileName: file.originalname,
      fileUrl,
      fileSize: file.size,
      uploadedAt: new Date(),
      status: 'pending_payment', // Aguardando pagamento da plataforma
      description: description || 'Nota Fiscal da emissora'
    });

    await order.save();


    // TODO: Enviar email para admin notificando que emissora enviou NF
    // await emailService.sendBroadcasterInvoiceUploaded({
    //   adminEmail: process.env.ADMIN_EMAIL,
    //   orderNumber: order.orderNumber,
    //   broadcasterName: 'Nome da Emissora',
    //   invoiceUrl: fileUrl
    // });

    res.json({
      message: 'Nota Fiscal enviada com sucesso! O pagamento será processado pela plataforma.',
      document: {
        fileName: file.originalname,
        fileUrl,
        fileSize: file.size,
        uploadedAt: new Date()
      }
    });
  } catch (error: any) {
    console.error('❌ Erro ao fazer upload da NF da emissora:', error.message);
    res.status(500).json({ message: 'Erro ao enviar nota fiscal' });
  }
};

/**
 * Lista as NFs que a emissora enviou (para seus próprios pedidos)
 * GET /api/billing/broadcaster/my-invoices
 */
export const getBroadcasterInvoices = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;


    // Busca pedidos "A Faturar" onde a emissora participa
    const orders = await Order.find({
      'payment.method': 'billing',
      'items.broadcasterId': userId,
      billingStatus: { $in: ['awaiting_payment', 'paid_client', 'completed_billing'] }
    })
      .sort({ createdAt: -1 })
      .select('orderNumber createdAt billingStatus broadcasterInvoices items');


    // Mapeia apenas as NFs desta emissora
    const invoices = orders.map(order => {
      // Calcula o valor da emissora (80% do seu gross)
      const myItems = order.items.filter(
        item => item.broadcasterId.toString() === userId
      );
      const myGross = myItems.reduce((sum, item) => sum + (item.totalPrice || 0), 0);
      const myValue = myGross * 0.80;

      // Busca NFs desta emissora
      const myInvoices = (order.broadcasterInvoices || []).filter(
        (inv: any) => inv.broadcasterId?.toString() === userId
      );

      return {
        orderId: order._id,
        orderNumber: order.orderNumber,
        orderDate: order.createdAt,
        myValue, // Valor que a emissora deve faturar
        status: order.billingStatus,
        invoices: myInvoices.map((inv: any) => ({
          id: inv._id,
          fileName: inv.fileName,
          fileUrl: inv.fileUrl,
          fileSize: inv.fileSize,
          uploadedAt: inv.uploadedAt,
          status: inv.status,
          description: inv.description
        })),
        hasInvoice: myInvoices.length > 0
      };
    });

    res.json(invoices);
  } catch (error: any) {
    console.error('❌ Erro ao buscar NFs da emissora:', error.message);
    res.status(500).json({ message: 'Erro ao buscar suas notas fiscais' });
  }
};

