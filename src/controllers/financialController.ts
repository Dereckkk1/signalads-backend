import { Request, Response } from 'express';
import Order, { IOrder } from '../models/Order';
import Wallet, { IWallet } from '../models/Wallet';
import { User, IUser } from '../models/User';
import mongoose from 'mongoose';

/**
 * GET /api/admin/financial/transactions
 * Retorna TODAS as transações da plataforma consolidadas
 */
export const getAllTransactions = async (req: Request, res: Response): Promise<void> => {
  try {
    const {
      startDate,
      endDate,
      type, // 'payment' | 'wallet' | 'split' | 'billing' | 'all'
      paymentMethod, // 'credit_card' | 'pix' | 'wallet' | 'billing'
      status,
      userId,
      page = 1,
      limit = 50
    } = req.query;



    const transactions: any[] = [];

    // 1. TRANSAÇÕES DE PEDIDOS (Pagamentos recebidos)
    if (!type || type === 'payment' || type === 'all') {
      const orderFilters: any = {
        status: { $nin: ['pending_payment', 'cancelled'] } // Apenas pedidos pagos
      };

      if (startDate || endDate) {
        orderFilters.paidAt = {};
        if (startDate) orderFilters.paidAt.$gte = new Date(startDate as string);
        if (endDate) orderFilters.paidAt.$lte = new Date(endDate as string);
      }

      if (paymentMethod) {
        orderFilters['payment.method'] = paymentMethod;
      }

      if (status) {
        orderFilters['payment.status'] = status;
      }

      if (userId) {
        orderFilters.buyerId = userId;
      }

      const orders = await Order.find(orderFilters)
        .select('orderNumber buyerName buyerDocument payment totalAmount grossAmount splits paidAt createdAt billingStatus')
        .sort({ paidAt: -1 })
        .limit(Number(limit) * 2); // Pegar mais para compensar outros filtros

      orders.forEach((order: any) => {
        transactions.push({
          id: order._id,
          type: 'payment',
          category: 'Pagamento de Cliente',
          orderNumber: order.orderNumber,
          amount: order.payment.totalAmount,
          grossAmount: order.grossAmount,
          paymentMethod: order.payment.method === 'credit_card' ? 'Cartão de Crédito' :
            order.payment.method === 'pix' ? 'PIX' :
              order.payment.method === 'wallet' ? 'Carteira' :
                order.payment.method === 'billing' ? 'Faturamento' : 'Outro',
          paymentStatus: order.payment.status,
          billingStatus: order.billingStatus || null,
          walletUsed: order.payment.walletAmountUsed || 0,
          chargedAmount: order.payment.chargedAmount || 0,

          // Detalhes do cliente
          clientId: order.buyerId,
          clientName: order.buyerName,
          clientDocument: order.buyerDocument,

          // Splits envolvidos
          splits: order.splits?.map((split: any) => ({
            recipientName: split.recipientName,
            recipientType: split.recipientType,
            amount: split.amount,
            percentage: split.percentage
          })),

          date: order.paidAt || order.createdAt,
          createdAt: order.createdAt,

          // Dados para exportação
          asaasPaymentId: order.payment.asaasPaymentId,
          cardBrand: order.payment.cardBrand,
          cardLastDigits: order.payment.cardLastDigits,
          installments: order.payment.installments,
          pixQrCode: order.payment.pixQrCode
        });
      });
    }

    // 2. TRANSAÇÕES DE WALLET (Créditos/Débitos)
    if (!type || type === 'wallet' || type === 'all') {
      const walletFilters: any = {};

      if (userId) {
        walletFilters.userId = userId;
      }

      const wallets = await Wallet.find(walletFilters)
        .select('userId transactions balance')
        .lean();

      for (const wallet of wallets) {
        let walletTransactions = wallet.transactions || [];

        // Filtrar por data
        if (startDate || endDate) {
          walletTransactions = walletTransactions.filter((t: any) => {
            const tDate = new Date(t.createdAt);
            if (startDate && tDate < new Date(startDate as string)) return false;
            if (endDate && tDate > new Date(endDate as string)) return false;
            return true;
          });
        }

        // Buscar nome do usuário
        let userName = 'Desconhecido';
        let userDocument = '';

        if (wallet.userId === 'platform') {
          userName = 'E-rádios Platform';
          userDocument = 'PLATAFORMA';
        } else {
          const user = await User.findById(wallet.userId).select('name email cpf cnpj companyName').lean();
          if (user) {
            userName = (user as any).companyName || (user as any).name || 'N/A';
            userDocument = (user as any).cnpj || (user as any).cpf || '';
          }
        }

        walletTransactions.forEach((transaction: any) => {
          transactions.push({
            id: transaction._id,
            type: 'wallet',
            category: transaction.type === 'credit' ? 'Crédito em Carteira' : 'Débito de Carteira',
            orderNumber: null,
            amount: transaction.amount,
            grossAmount: transaction.amount,
            paymentMethod: 'Carteira',
            paymentStatus: transaction.status,
            billingStatus: null,
            walletUsed: transaction.type === 'debit' ? transaction.amount : 0,
            chargedAmount: 0,

            // Detalhes do usuário
            clientId: wallet.userId,
            clientName: userName,
            clientDocument: userDocument,

            // Descrição da transação
            description: transaction.description,
            relatedOrderId: transaction.relatedOrderId,
            transactionType: transaction.type,

            splits: null,

            date: transaction.createdAt,
            createdAt: transaction.createdAt,

            asaasPaymentId: transaction.relatedPaymentId,
            cardBrand: null,
            cardLastDigits: null,
            installments: null,
            pixQrCode: null
          });
        });
      }
    }

    // 3. SPLITS (Distribuições de receita)
    if (!type || type === 'split' || type === 'all') {
      const splitFilters: any = {
        splits: { $exists: true, $ne: [] }
      };

      if (startDate || endDate) {
        splitFilters.paidAt = {};
        if (startDate) splitFilters.paidAt.$gte = new Date(startDate as string);
        if (endDate) splitFilters.paidAt.$lte = new Date(endDate as string);
      }

      const ordersWithSplits = await Order.find(splitFilters)
        .select('orderNumber buyerName splits paidAt createdAt')
        .sort({ paidAt: -1 })
        .limit(Number(limit) * 2);

      ordersWithSplits.forEach((order: any) => {
        order.splits?.forEach((split: any) => {
          // Filtro por usuário (se for split para esse usuário)
          if (userId && split.recipientId !== userId) return;

          transactions.push({
            id: `${order._id}_split_${split.recipientId}`,
            type: 'split',
            category: 'Distribuição de Receita (Split)',
            orderNumber: order.orderNumber,
            amount: split.amount,
            grossAmount: split.amount,
            paymentMethod: 'Split Automático',
            paymentStatus: 'completed',
            billingStatus: null,
            walletUsed: 0,
            chargedAmount: 0,

            // Detalhes do beneficiário
            clientId: split.recipientId,
            clientName: split.recipientName,
            clientDocument: '',

            // Detalhes do split
            description: split.description,
            recipientType: split.recipientType,
            percentage: split.percentage,

            // Origem do split
            originClientName: order.buyerName,

            splits: null,

            date: order.paidAt,
            createdAt: order.createdAt,

            asaasPaymentId: null,
            cardBrand: null,
            cardLastDigits: null,
            installments: null,
            pixQrCode: null
          });
        });
      });
    }

    // 4. FATURAMENTO (A Faturar)
    if (!type || type === 'billing' || type === 'all') {
      const billingFilters: any = {
        'payment.method': 'billing'
      };

      if (startDate || endDate) {
        billingFilters.createdAt = {};
        if (startDate) billingFilters.createdAt.$gte = new Date(startDate as string);
        if (endDate) billingFilters.createdAt.$lte = new Date(endDate as string);
      }

      if (userId) {
        billingFilters.buyerId = userId;
      }

      const billingOrders = await Order.find(billingFilters)
        .select('orderNumber buyerName buyerDocument billingData billingStatus billingInvoices billingDocuments payment totalAmount createdAt')
        .sort({ createdAt: -1 })
        .limit(Number(limit) * 2);

      billingOrders.forEach((order: any) => {
        transactions.push({
          id: order._id,
          type: 'billing',
          category: 'Faturamento (A Faturar)',
          orderNumber: order.orderNumber,
          amount: order.payment.totalAmount,
          grossAmount: order.payment.totalAmount,
          paymentMethod: 'Faturamento',
          paymentStatus: order.payment.status,
          billingStatus: order.billingStatus,
          walletUsed: 0,
          chargedAmount: 0,

          // Detalhes do cliente
          clientId: order.buyerId,
          clientName: order.buyerName,
          clientDocument: order.buyerDocument,

          // Dados de faturamento
          razaoSocial: order.billingData?.razaoSocial,
          cnpj: order.billingData?.cnpj,
          billingEmail: order.billingData?.billingEmail,

          // Documentos e faturas
          invoices: order.billingInvoices?.map((inv: any) => ({
            type: inv.type,
            amount: inv.amount,
            status: inv.status,
            dueDate: inv.dueDate,
            paidAt: inv.paidAt
          })),

          documents: order.billingDocuments?.map((doc: any) => ({
            type: doc.type,
            fileName: doc.fileName,
            status: doc.status,
            uploadedAt: doc.uploadedAt
          })),

          splits: null,

          date: order.createdAt,
          createdAt: order.createdAt,

          asaasPaymentId: order.payment.asaasPaymentId,
          asaasInvoiceId: order.payment.asaasInvoiceId,
          asaasInvoiceUrl: order.payment.asaasInvoiceUrl,
          asaasBoletoUrl: order.payment.asaasBoletoUrl,
          cardBrand: null,
          cardLastDigits: null,
          installments: null,
          pixQrCode: null
        });
      });
    }

    // Ordenar por data (mais recente primeiro)
    transactions.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    // Paginação
    const startIndex = (Number(page) - 1) * Number(limit);
    const endIndex = startIndex + Number(limit);
    const paginatedTransactions = transactions.slice(startIndex, endIndex);

    // Calcular totais
    const totals = {
      totalTransactions: transactions.length,
      totalAmount: transactions.reduce((sum, t) => sum + (t.amount || 0), 0),
      totalPayments: transactions.filter(t => t.type === 'payment').length,
      totalPaymentsAmount: transactions.filter(t => t.type === 'payment').reduce((sum, t) => sum + (t.amount || 0), 0),
      totalWalletTransactions: transactions.filter(t => t.type === 'wallet').length,
      totalWalletAmount: transactions.filter(t => t.type === 'wallet').reduce((sum, t) => sum + (t.amount || 0), 0),
      totalSplits: transactions.filter(t => t.type === 'split').length,
      totalSplitsAmount: transactions.filter(t => t.type === 'split').reduce((sum, t) => sum + (t.amount || 0), 0),
      totalBilling: transactions.filter(t => t.type === 'billing').length,
      totalBillingAmount: transactions.filter(t => t.type === 'billing').reduce((sum, t) => sum + (t.amount || 0), 0),

      // Por método de pagamento
      byPaymentMethod: {
        creditCard: transactions.filter(t => t.paymentMethod === 'Cartão de Crédito').reduce((sum, t) => sum + (t.amount || 0), 0),
        pix: transactions.filter(t => t.paymentMethod === 'PIX').reduce((sum, t) => sum + (t.amount || 0), 0),
        wallet: transactions.filter(t => t.paymentMethod === 'Carteira').reduce((sum, t) => sum + (t.amount || 0), 0),
        billing: transactions.filter(t => t.paymentMethod === 'Faturamento').reduce((sum, t) => sum + (t.amount || 0), 0)
      }
    };



    res.json({
      transactions: paginatedTransactions,
      pagination: {
        currentPage: Number(page),
        totalPages: Math.ceil(transactions.length / Number(limit)),
        totalItems: transactions.length,
        itemsPerPage: Number(limit)
      },
      totals
    });

  } catch (error) {
    console.error('❌ Erro ao buscar transações financeiras:', error);
    res.status(500).json({
      message: 'Erro ao buscar transações financeiras',
      error: error instanceof Error ? error.message : 'Erro desconhecido'
    });
  }
};

/**
 * GET /api/admin/financial/summary
 * Retorna resumo financeiro da plataforma
 */
export const getFinancialSummary = async (req: Request, res: Response): Promise<void> => {
  try {
    const { startDate, endDate } = req.query;

    const dateFilter: any = {};
    if (startDate || endDate) {
      dateFilter.paidAt = {};
      if (startDate) dateFilter.paidAt.$gte = new Date(startDate as string);
      if (endDate) dateFilter.paidAt.$lte = new Date(endDate as string);
    }

    // Total de pedidos pagos
    const paidOrders = await Order.find({
      ...dateFilter,
      status: { $nin: ['pending_payment', 'cancelled'] }
    }).select('payment totalAmount platformSplit techFee agencyCommission broadcasterAmount');

    // Wallets
    const platformWallet = await Wallet.findOne({ userId: 'platform' }).select('balance totalEarned');
    const allWallets = await Wallet.find({ userId: { $ne: 'platform' } }).select('balance totalEarned totalSpent');

    // Calcular totais
    const totalRevenue = paidOrders.reduce((sum: number, order: any) => sum + (order.payment.totalAmount || 0), 0);
    const platformEarnings = paidOrders.reduce((sum: number, order: any) => sum + (order.platformSplit || 0) + (order.techFee || 0), 0);
    const broadcastersEarnings = paidOrders.reduce((sum: number, order: any) => sum + (order.broadcasterAmount || 0), 0);
    const agenciesCommissions = paidOrders.reduce((sum: number, order: any) => sum + (order.agencyCommission || 0), 0);

    const summary = {
      totalRevenue, // Receita bruta total
      platformEarnings, // Ganhos da plataforma (20% + 5%)
      broadcastersEarnings, // Ganhos das emissoras (80%)
      agenciesCommissions, // Comissões de agências (12%)

      platformWalletBalance: platformWallet?.balance || 0,
      platformWalletTotal: platformWallet?.totalEarned || 0,

      totalWalletBalance: allWallets.reduce((sum: number, w: any) => sum + (w.balance || 0), 0),
      totalWalletEarned: allWallets.reduce((sum: number, w: any) => sum + (w.totalEarned || 0), 0),
      totalWalletSpent: allWallets.reduce((sum: number, w: any) => sum + (w.totalSpent || 0), 0),

      totalOrders: paidOrders.length,

      averageOrderValue: paidOrders.length > 0 ? totalRevenue / paidOrders.length : 0
    };

    res.json(summary);

  } catch (error) {
    console.error('❌ Erro ao buscar resumo financeiro:', error);
    res.status(500).json({
      message: 'Erro ao buscar resumo financeiro',
      error: error instanceof Error ? error.message : 'Erro desconhecido'
    });
  }
};

/**
 * POST /api/admin/financial/export
 * Exporta transações em CSV
 */
export const exportTransactions = async (req: Request, res: Response): Promise<void> => {
  try {
    const { filters } = req.body; // Mesmos filtros da listagem

    // Reusar lógica de getAllTransactions mas sem paginação
    const tempReq = { query: { ...filters, limit: 999999 } } as Request;
    const tempRes = {
      json: (data: any) => data
    } as any;

    // Chamar getAllTransactions internamente
    // (Simplificado - na prática, extrair a lógica para função auxiliar)

    res.json({
      message: 'Export em desenvolvimento',
      note: 'Use a rota GET /api/admin/financial/transactions com os filtros desejados'
    });

  } catch (error) {
    console.error('❌ Erro ao exportar transações:', error);
    res.status(500).json({
      message: 'Erro ao exportar transações',
      error: error instanceof Error ? error.message : 'Erro desconhecido'
    });
  }
};
