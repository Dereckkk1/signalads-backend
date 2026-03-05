import { Request, Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import Order from '../models/Order';
import Wallet, { IWallet } from '../models/Wallet';
import { Cart, ICartItem } from '../models/Cart';
import asaasService from '../services/asaasService';
import { sendNewOrderToBroadcaster, sendOrderConfirmationToClient, sendOrderReceivedToClient, sendNewOrderToAdmin } from '../services/emailService';
import { User } from '../models/User';
import { createConversationFromOrder } from './chatController';
import { processAutoApprovalForCatalogItems } from './campaignController';
import mongoose from 'mongoose';

/**
 * Controller de Pagamentos
 * Gerencia checkout, processamento de pagamentos e webhooks Asaas
 */

/**
 * Garante que a wallet da plataforma existe
 * Usa variável de ambiente PLATFORM_USER_ID (padrão: 'platform')
 */
export async function ensurePlatformWallet(): Promise<IWallet> {
  const platformUserId = process.env.PLATFORM_USER_ID || 'platform';

  let platformWallet = await Wallet.findOne({
    userId: platformUserId
  });

  if (!platformWallet) {
    platformWallet = await Wallet.create({
      userId: platformUserId,
      balance: 0,
      blockedBalance: 0,
      totalEarned: 0,
      totalSpent: 0,
      transactions: []
    });
  }

  return platformWallet;
}

/**
 * Calcula valores financeiros do pedido
 * 
 * Sistema de divisão:
 * - Valor do produto (bruto): 100%
 * 
 * PARA EMISSORAS COM CONTA (isCatalogOnly: false):
 * - Emissora recebe: 80%
 * - Plataforma recebe: 20%
 * - Tech Fee (adicional): 5%
 * - Cliente paga: Valor bruto + Tech Fee (105%)
 * 
 * PARA EMISSORAS CATÁLOGO (isCatalogOnly: true):
 * - Plataforma recebe: 100% (emissora é paga por fora)
 * - Tech Fee (adicional): 5%
 * - Cliente paga: Valor bruto + Tech Fee (105%)
 */
interface FinancialCalculation {
  grossAmount: number; // Valor bruto total dos produtos
  broadcasterAmount: number; // 80% para emissoras (apenas com conta)
  platformSplit: number; // 20% para plataforma (ou 100% se catálogo)
  techFee: number; // 5% taxa técnica
  agencyCommission: number; // 12% se for agência
  monitoringCost: number; // Custo de monitoramento de mídia
  totalAmount: number; // O que o cliente paga
  splits: Array<{
    recipientId: string;
    recipientName: string;
    recipientType: 'broadcaster' | 'platform' | 'agency';
    amount: number;
    percentage: number;
    description: string;
  }>;
  broadcasterBreakdown: Map<string, {
    broadcasterId: string;
    broadcasterName: string;
    grossAmount: number;
    broadcasterAmount: number;
    isCatalogOnly: boolean;
  }>;
}

/**
 * Calcula splits considerando emissoras catálogo
 * @param broadcasterCatalogStatus - Map<broadcasterId, isCatalogOnly>
 */
async function calculateOrderFinancialsWithCatalog(
  cartItems: ICartItem[],
  buyerUserType: string,
  buyerId: string,
  buyerName: string,
  isMonitoringEnabled: boolean = true,
  agencyCommissionPercent: number = 0 // Comissão definida pela agência (em %)
): Promise<FinancialCalculation> {
  // 0. Busca status de catálogo de todas as emissoras no carrinho
  const broadcasterIds = [...new Set(cartItems.map(item => item.broadcasterId.toString()))];
  const broadcasters = await User.find({
    _id: { $in: broadcasterIds }
  }).select('_id isCatalogOnly companyName fantasyName').lean();

  const catalogStatus = new Map<string, boolean>();
  broadcasters.forEach(b => {
    catalogStatus.set(b._id.toString(), b.isCatalogOnly || false);
  });


  // 1. Agrupa por emissora e calcula valores
  const broadcasterMap = new Map<string, {
    broadcasterId: string;
    broadcasterName: string;
    grossAmount: number;
    broadcasterAmount: number;
    isCatalogOnly: boolean;
  }>();

  cartItems.forEach(item => {
    const itemGross = item.price * item.quantity;
    const broadcasterId = item.broadcasterId.toString();
    const isCatalog = catalogStatus.get(broadcasterId) || false;

    if (!broadcasterMap.has(broadcasterId)) {
      broadcasterMap.set(broadcasterId, {
        broadcasterId,
        broadcasterName: item.broadcasterName,
        grossAmount: 0,
        broadcasterAmount: 0,
        isCatalogOnly: isCatalog
      });
    }

    const current = broadcasterMap.get(broadcasterId)!;
    current.grossAmount += itemGross;

    // SE CATÁLOGO: emissora não recebe nada (0%)
    // SE COM CONTA: emissora recebe 80%
    current.broadcasterAmount += isCatalog ? 0 : (itemGross * 0.80);
  });

  // 2. Soma totais
  const grossAmount = Math.round(Array.from(broadcasterMap.values())
    .reduce((sum, b) => sum + b.grossAmount, 0) * 100) / 100;

  const broadcasterAmount = Math.round(Array.from(broadcasterMap.values())
    .reduce((sum, b) => sum + b.broadcasterAmount, 0) * 100) / 100;

  // --- CÁLCULO DE CUSTOS DE PRODUÇÃO (NOVO) ---
  // R$ 50,00 por material único do tipo 'recording'
  const recordingMaterials = cartItems
    .map(item => item.material)
    .filter(m => m && m.type === 'recording');

  // Identifica únicos pelo hash ou script
  const uniqueRecordings = new Set(
    recordingMaterials.map(m => m?.contentHash || m?.script?.trim() || '')
  );

  // Remove scripts vazios/inválidos
  const uniqueCount = Array.from(uniqueRecordings).filter(h => h).length;
  const productionCost = uniqueCount * 50;


  // Plataforma recebe: 20% das emissoras com conta + 100% das catálogo
  let platformFromRegular = 0;
  let platformFromCatalog = 0;

  broadcasterMap.forEach(b => {
    if (b.isCatalogOnly) {
      platformFromCatalog += b.grossAmount; // 100% do catálogo
    } else {
      platformFromRegular += b.grossAmount * 0.20; // 20% das regulares
    }
  });

  const platformSplit = Math.round((platformFromRegular + platformFromCatalog) * 100) / 100;

  const techFee = Math.round(((grossAmount + productionCost) * 0.05) * 100) / 100;

  const agencyCommission = (buyerUserType === 'agency' && agencyCommissionPercent > 0)
    ? Math.round(((grossAmount + productionCost) * (agencyCommissionPercent / 100)) * 100) / 100
    : 0;

  // --- CÁLCULO DE MONITORAMENTO DE MÍDIA ---
  const monitorableItemsCount = cartItems
    .filter(item => !item.productName?.toLowerCase().startsWith('testemunhal'))
    .reduce((sum, item) => sum + item.quantity, 0);
  const monitoringCost = isMonitoringEnabled ? monitorableItemsCount * 2 : 0;

  // 3. Total que o cliente paga
  const totalAmount = Math.round((grossAmount + productionCost + techFee + agencyCommission + monitoringCost) * 100) / 100;

  // 4. Monta splits
  const splits: any[] = [];

  // Splits por emissora (apenas para emissoras COM CONTA)
  broadcasterMap.forEach(broadcaster => {
    if (!broadcaster.isCatalogOnly && broadcaster.broadcasterAmount > 0) {
      splits.push({
        recipientId: broadcaster.broadcasterId,
        recipientName: broadcaster.broadcasterName,
        recipientType: 'broadcaster',
        amount: broadcaster.broadcasterAmount,
        percentage: 80,
        description: 'Crédito de campanha aprovada'
      });
    }
  });

  // Split da plataforma (20% das regulares + 100% das catálogo)
  if (platformFromRegular > 0) {
    splits.push({
      recipientId: 'platform',
      recipientName: 'E-rádios Platform',
      recipientType: 'platform',
      amount: platformFromRegular,
      percentage: 20,
      description: 'Taxa de intermediação'
    });
  }

  // Split da plataforma para emissoras catálogo (100%)
  if (platformFromCatalog > 0) {
    splits.push({
      recipientId: 'platform',
      recipientName: 'E-rádios Platform (Catálogo)',
      recipientType: 'platform',
      amount: platformFromCatalog,
      percentage: 100,
      description: 'Venda via catálogo (emissora externa)'
    });
  }

  // Split de Produção (Audio Studio) - Vai para a plataforma por enquanto
  if (productionCost > 0) {
    splits.push({
      recipientId: 'platform',
      recipientName: 'E-rádios Audio Studio',
      recipientType: 'platform',
      amount: productionCost,
      percentage: 0, // Valor fixo
      description: 'Serviços de Gravação e Produção'
    });
  }

  // Split de Radio Analytics - Vai para a plataforma
  if (monitoringCost > 0) {
    splits.push({
      recipientId: 'platform',
      recipientName: 'E-rádios Auditoria',
      recipientType: 'platform',
      amount: monitoringCost,
      percentage: 0, // Valor fixo
      description: 'Serviço de Monitoramento de Mídia'
    });
  }

  // Tech Fee (5%)
  splits.push({
    recipientId: 'platform',
    recipientName: 'E-rádios Tech Fee',
    recipientType: 'platform',
    amount: techFee,
    percentage: 5,
    description: 'Taxa técnica'
  });

  // Comissão de agência (% definida pela agência)
  if (agencyCommission > 0) {
    splits.push({
      recipientId: buyerId,
      recipientName: buyerName,
      recipientType: 'agency',
      amount: agencyCommission,
      percentage: agencyCommissionPercent,
      description: `Comissão de agência (${agencyCommissionPercent}%)`
    });
  }



  return {
    grossAmount,
    broadcasterAmount,
    platformSplit,
    techFee,
    agencyCommission,
    monitoringCost, // novo
    totalAmount,
    splits,
    broadcasterBreakdown: broadcasterMap
  };
}

// Mantém função original para compatibilidade (deprecated)
function calculateOrderFinancials(
  cartItems: ICartItem[],
  buyerUserType: string,
  buyerId: string,
  buyerName: string
): FinancialCalculation {
  // 1. Agrupa por emissora e calcula valores
  const broadcasterMap = new Map<string, {
    broadcasterId: string;
    broadcasterName: string;
    grossAmount: number;
    broadcasterAmount: number;
    isCatalogOnly: boolean;
  }>();

  cartItems.forEach(item => {
    const itemGross = item.price * item.quantity;
    const broadcasterId = item.broadcasterId.toString();

    if (!broadcasterMap.has(broadcasterId)) {
      broadcasterMap.set(broadcasterId, {
        broadcasterId,
        broadcasterName: item.broadcasterName,
        grossAmount: 0,
        broadcasterAmount: 0,
        isCatalogOnly: false
      });
    }

    const current = broadcasterMap.get(broadcasterId)!;
    current.grossAmount += itemGross;
    current.broadcasterAmount += itemGross * 0.80; // 80% para emissora
  });

  // 2. Soma totais
  const grossAmount = Array.from(broadcasterMap.values())
    .reduce((sum, b) => sum + b.grossAmount, 0);

  const broadcasterAmount = Array.from(broadcasterMap.values())
    .reduce((sum, b) => sum + b.broadcasterAmount, 0);

  const platformSplit = grossAmount * 0.20; // 20% para plataforma
  const techFee = grossAmount * 0.05; // 5% taxa técnica
  const agencyCommission = (buyerUserType === 'agency') ? grossAmount * 0.12 : 0;

  // 3. Total que o cliente paga
  const totalAmount = grossAmount + techFee + agencyCommission;

  // 4. Monta splits
  const splits: any[] = [];

  // Splits por emissora (80%)
  broadcasterMap.forEach(broadcaster => {
    splits.push({
      recipientId: broadcaster.broadcasterId,
      recipientName: broadcaster.broadcasterName,
      recipientType: 'broadcaster',
      amount: broadcaster.broadcasterAmount,
      percentage: 80,
      description: 'Crédito de campanha aprovada'
    });
  });

  // Split da plataforma (20%)
  splits.push({
    recipientId: 'platform',
    recipientName: 'E-rádios Platform',
    recipientType: 'platform',
    amount: platformSplit,
    percentage: 20,
    description: 'Taxa de intermediação'
  });

  // Tech Fee (5%)
  splits.push({
    recipientId: 'platform',
    recipientName: 'E-rádios Tech Fee',
    recipientType: 'platform',
    amount: techFee,
    percentage: 5,
    description: 'Taxa técnica'
  });

  // Comissão de agência (12%)
  if (agencyCommission > 0) {
    splits.push({
      recipientId: buyerId,
      recipientName: buyerName,
      recipientType: 'agency',
      amount: agencyCommission,
      percentage: 12,
      description: 'Comissão de agência'
    });
  }



  return {
    grossAmount,
    broadcasterAmount,
    platformSplit,
    techFee,
    agencyCommission,
    monitoringCost: 0, // deprecado, default para zero
    totalAmount,
    splits,
    broadcasterBreakdown: broadcasterMap
  };
}

/**
 * Gera número único de pedido
 */
const generateOrderNumber = async (): Promise<string> => {
  const date = new Date();
  const dateStr = date.toISOString().split('T')[0]?.replace(/-/g, '') || '';

  const count = await Order.countDocuments({
    createdAt: { $gte: new Date(date.setHours(0, 0, 0, 0)) }
  });

  const orderNumber = `ORD-${dateStr}-${String(count + 1).padStart(4, '0')}`;

  return orderNumber;
};

/**
 * POST /api/payment/checkout
 * Processa checkout do carrinho
 */
export const processCheckout = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) {
      return res.status(401).json({ message: 'Usuário não autenticado' });
    }
    const {
      paymentMethod, // 'credit_card' | 'pix' | 'wallet' | 'billing' | 'pending_contact'
      useWallet, // boolean - usar saldo disponível
      billingInfo, // Dados de cobrança
      billingData, // Dados específicos de faturamento (se method = billing)
      creditCardData, // Dados do cartão (se método = credit_card)
      installments, // Número de parcelas (1-12)
      skipPayment, // Flag para pular pagamento (pending_contact)
      isMonitoringEnabled, // Flag para monitoramento
      clientId, // (Agência) ID do cliente anunciante
      agencyCommission: reqAgencyCommission // (Agência) % de comissão definida
    } = req.body;


    // Validações de entrada
    if (!paymentMethod) {
      return res.status(400).json({ message: 'Método de pagamento não especificado' });
    }

    // Se for pending_contact, não exige dados de cobrança
    if (paymentMethod !== 'pending_contact') {
      if (!billingInfo || !billingInfo.name || !billingInfo.email || !billingInfo.cpfCnpj) {
        return res.status(400).json({ message: 'Dados de cobrança incompletos' });
      }
    }

    // Validação específica para faturamento
    if (paymentMethod === 'billing') {
      if (!billingData || !billingData.razaoSocial || !billingData.cnpj || !billingData.phone || !billingData.billingEmail) {
        return res.status(400).json({
          message: 'Dados de faturamento incompletos. Razão Social, CNPJ, Telefone e E-mail Financeiro são obrigatórios.'
        });
      }

      if (!billingData.address || !billingData.address.cep || !billingData.address.street || !billingData.address.city || !billingData.address.state) {
        return res.status(400).json({
          message: 'Endereço completo é obrigatório para faturamento.'
        });
      }
    }

    // 1. Carrega carrinho do usuário
    const cart = await Cart.findOne({ userId }).populate('userId');
    if (!cart || cart.items.length === 0) {
      return res.status(400).json({ message: 'Carrinho vazio' });
    }


    // 2. Valida que todos os itens têm schedules e materials
    const invalidItems = cart.items.filter((item: ICartItem) => {
      // Converte schedule (que pode ser Map ou objeto) para array de valores
      let scheduleValues: number[] = [];
      if (item.schedule instanceof Map) {
        scheduleValues = Array.from(item.schedule.values());
      } else if (item.schedule && typeof item.schedule === 'object') {
        scheduleValues = Object.values(item.schedule);
      }

      const scheduleTotal = scheduleValues.reduce((sum: number, qty: number) => sum + qty, 0);
      const isValid = scheduleTotal === item.quantity && !!item.material;



      return !isValid;
    });



    if (invalidItems.length > 0) {
      return res.status(400).json({
        message: 'Carrinho incompleto. Certifique-se que todos os itens estão agendados e possuem materiais.',
        invalidItems: invalidItems.map((i: ICartItem) => {
          let scheduleValues: number[] = [];
          if (i.schedule instanceof Map) {
            scheduleValues = Array.from(i.schedule.values());
          } else if (i.schedule && typeof i.schedule === 'object') {
            scheduleValues = Object.values(i.schedule);
          }
          const scheduleTotal = scheduleValues.reduce((sum: number, qty: number) => sum + qty, 0);

          return {
            productId: i.productId,
            productName: i.productName,
            quantity: i.quantity,
            scheduleTotal,
            hasMaterial: !!i.material
          };
        })
      });
    }

    // 3. Calcula valores usando novo sistema (com suporte a catálogo)
    const buyer = await User.findById(userId);
    if (!buyer) {
      return res.status(404).json({ message: 'Usuário não encontrado' });
    }

    // Usa função que considera emissoras catálogo
    const agencyCommPercent = buyer.userType === 'agency' && reqAgencyCommission ? Number(reqAgencyCommission) : 0;
    const financials = await calculateOrderFinancialsWithCatalog(
      cart.items,
      buyer.userType,
      userId.toString(),
      buyer.fantasyName || buyer.companyName || buyer.email,
      isMonitoringEnabled !== undefined ? isMonitoringEnabled : true,
      agencyCommPercent
    );

    const {
      grossAmount,
      broadcasterAmount,
      platformSplit,
      techFee,
      agencyCommission,
      monitoringCost,
      totalAmount,
      splits
    } = financials;

    // Validação de threshold para faturamento (R$ 5.000)
    if (paymentMethod === 'billing' && grossAmount < 5000) {
      return res.status(400).json({
        message: 'O faturamento está disponível apenas para campanhas com valor total igual ou superior a R$ 5.000,00',
        currentAmount: grossAmount,
        requiredAmount: 5000
      });
    }

    // ===== FLUXO PENDING_CONTACT: Pedido sem pagamento =====
    // Equipe comercial entrará em contato para negociação
    if (paymentMethod === 'pending_contact') {

      const orderNumber = await generateOrderNumber();

      // Cria pedido com status especial
      const order = await Order.create({
        orderNumber,
        buyerId: userId,
        buyerName: buyer.fantasyName || buyer.companyName || buyer.email,
        buyerEmail: buyer.email,
        buyerPhone: buyer.phone || '',
        buyerDocument: buyer.cpfOrCnpj || buyer.cnpj || '',
        items: cart.items.map((item: ICartItem) => ({
          productId: item.productId.toString(),
          productName: item.productName,
          broadcasterName: item.broadcasterName,
          broadcasterId: item.broadcasterId.toString(),
          quantity: item.quantity,
          unitPrice: item.price,
          totalPrice: item.price * item.quantity,
          schedule: item.schedule,
          material: item.material
        })),
        payment: {
          method: 'pending_contact',
          status: 'pending',
          walletAmountUsed: 0,
          chargedAmount: 0,
          totalAmount
        },
        splits,
        status: 'pending_contact', // Novo status especial
        grossAmount,
        broadcasterAmount,
        platformSplit,
        techFee,
        agencyCommission,
        monitoringCost,
        isMonitoringEnabled: isMonitoringEnabled !== undefined ? isMonitoringEnabled : true,
        totalAmount,
        subtotal: grossAmount,
        platformFee: techFee,
        ...(buyer.userType === 'agency' && clientId ? { clientId } : {})
      });

      // Limpa carrinho
      await Cart.findByIdAndDelete(cart._id);


      // Criar conversa automaticamente
      await createConversationFromOrder(order._id.toString());

      // 📧 Envia email de notificação
      try {

        // 1. Envia para o Cliente
        await sendOrderReceivedToClient({
          orderNumber: order.orderNumber,
          buyerName: order.buyerName,
          buyerEmail: order.buyerEmail,
          items: order.items.map(i => ({
            productName: i.productName,
            broadcasterName: i.broadcasterName
          })),
          totalValue: order.totalAmount
        });

        // 2. Envia para Admins
        // Busca emails de admins
        const admins = await User.find({ userType: 'admin' }).select('email');
        const adminEmails = admins.map(a => a.email);

        if (adminEmails.length > 0) {
          await sendNewOrderToAdmin({
            orderNumber: order.orderNumber,
            buyerName: order.buyerName,
            buyerEmail: order.buyerEmail,
            buyerPhone: order.buyerPhone,
            totalValue: order.totalAmount,
            itemsCount: order.items.length,
            adminEmails,
            isMonitoringEnabled: order.isMonitoringEnabled
          });
        }

      } catch (emailErr) {
        console.error(`❌ Erro ao enviar notificação:`, emailErr);
      }

      return res.status(200).json({
        success: true,
        order: {
          orderNumber: order.orderNumber,
          status: order.status,
          totalAmount: order.totalAmount,
          itemsCount: order.items.length
        },
        message: 'Pedido confirmado! Nossa equipe comercial entrará em contato em breve.'
      });
    }
    // ===== FIM FLUXO PENDING_CONTACT =====

    // 4. Verifica saldo da wallet
    let wallet = await Wallet.findOne({ userId });
    if (!wallet) {
      wallet = await Wallet.create({ userId, balance: 0 });
    }

    const walletAmountToUse = useWallet ? Math.min(wallet.balance, totalAmount) : 0;
    const chargeAmount = totalAmount - walletAmountToUse;


    // 5. Se wallet cobre tudo E método é PIX ou Cartão, processa direto
    if (chargeAmount === 0 && (paymentMethod === 'pix' || paymentMethod === 'credit_card')) {
      // Debita da wallet
      await wallet.debit(totalAmount, `Pedido - Carrinho completo`);

      // Gera orderNumber
      const orderNumber = await generateOrderNumber();

      // Cria pedido
      const order = await Order.create({
        orderNumber,
        buyerId: userId,
        buyerName: buyer.fantasyName || buyer.companyName || buyer.email,
        buyerEmail: buyer.email,
        buyerPhone: billingInfo.phone,
        buyerDocument: billingInfo.cpfCnpj,
        items: cart.items.map((item: ICartItem) => ({
          productId: item.productId.toString(),
          productName: item.productName,
          broadcasterName: item.broadcasterName,
          broadcasterId: item.broadcasterId.toString(),
          quantity: item.quantity,
          unitPrice: item.price,
          totalPrice: item.price * item.quantity,
          schedule: item.schedule,
          material: item.material
        })),
        payment: {
          method: paymentMethod, // Registra PIX ou Cartão, não 'wallet'
          status: 'confirmed',
          walletAmountUsed: totalAmount,
          chargedAmount: 0,
          totalAmount,
          paidAt: new Date()
        },
        splits,
        status: 'pending_approval',
        grossAmount,
        broadcasterAmount,
        platformSplit,
        techFee,
        agencyCommission,
        monitoringCost,
        isMonitoringEnabled: isMonitoringEnabled !== undefined ? isMonitoringEnabled : true,
        totalAmount,
        // Manter campos deprecated
        subtotal: grossAmount,
        platformFee: techFee,
        paidAt: new Date()
      });

      // Limpa carrinho
      await Cart.findByIdAndDelete(cart._id);


      // Criar conversa automaticamente
      await createConversationFromOrder(order._id.toString());

      // 📧 Envia email de confirmação para o cliente
      try {
        await sendOrderConfirmationToClient({
          orderNumber: order.orderNumber,
          buyerName: order.buyerName,
          buyerEmail: order.buyerEmail,
          items: cart.items.map((item: ICartItem) => ({
            productName: item.productName,
            broadcasterName: item.broadcasterName,
            quantity: item.quantity,
            unitPrice: item.price,
            totalPrice: item.price * item.quantity
          })),
          subtotal: grossAmount,
          techFee: techFee,
          totalAmount: totalAmount,
          paymentMethod: 'wallet',
          createdAt: new Date()
        });
      } catch (emailErr) {
        console.error(`❌ Erro ao enviar email de confirmação:`, emailErr);
      }

      return res.status(200).json({
        success: true,
        order: order,
        message: 'Pedido confirmado! Pagamento realizado via créditos.'
      });
    }

    // 6. Cria/atualiza cliente no Asaas
    const asaasCustomer = await asaasService.createOrUpdateCustomer({
      name: billingInfo.name,
      email: billingInfo.email,
      phone: billingInfo.phone,
      cpfCnpj: billingInfo.cpfCnpj,
      postalCode: billingInfo.postalCode,
      address: billingInfo.address,
      addressNumber: billingInfo.addressNumber,
      complement: billingInfo.complement,
      province: billingInfo.province,
      externalReference: userId.toString()
    });

    // 7. Processa pagamento conforme método
    let asaasPayment;
    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + 3); // Vencimento em 3 dias

    if (paymentMethod === 'credit_card') {
      // Pagamento com cartão de crédito
      asaasPayment = await asaasService.createCreditCardPayment({
        customer: asaasCustomer.id,
        billingType: 'CREDIT_CARD',
        value: chargeAmount,
        dueDate: dueDate.toISOString().split('T')[0] as string,
        description: `Pedido E-rádios - ${cart.items.length} item(s)`,
        externalReference: userId.toString(),
        installmentCount: installments || 1,
        installmentValue: chargeAmount / (installments || 1),
        creditCard: {
          holderName: creditCardData.holderName,
          number: creditCardData.number,
          expiryMonth: creditCardData.expiryMonth,
          expiryYear: creditCardData.expiryYear,
          ccv: creditCardData.ccv
        },
        creditCardHolderInfo: {
          name: creditCardData.holderName,
          email: billingInfo.email,
          cpfCnpj: creditCardData.holderCpfCnpj,
          postalCode: billingInfo.postalCode,
          addressNumber: billingInfo.addressNumber,
          addressComplement: billingInfo.complement,
          phone: billingInfo.phone
        }
        // TODO: Adicionar splits quando emissoras tiverem subcontas
      });

    } else if (paymentMethod === 'pix') {
      // Pagamento com PIX
      asaasPayment = await asaasService.createPixPayment({
        customer: asaasCustomer.id,
        value: chargeAmount,
        dueDate: dueDate.toISOString().split('T')[0] as string,
        description: `Pedido E-rádios - ${cart.items.length} item(s)`,
        externalReference: userId.toString()
        // TODO: Adicionar splits
      });
    } else if (paymentMethod === 'billing') {
      // Faturamento - NÃO cria cobrança agora, apenas registra pedido
      // Cobrança será criada APÓS veiculação (vencimento dia 15 do mês seguinte)
      asaasPayment = null; // Não há pagamento Asaas ainda
    }

    // 8. Debita wallet se usou créditos
    if (walletAmountToUse > 0) {
      await wallet.debit(walletAmountToUse, `Pedido - Créditos aplicados`, undefined);
    }

    // 9. Determina status inicial baseado no resultado do pagamento
    // Cartão de crédito: se status = CONFIRMED ou RECEIVED, já está pago
    // PIX: sempre começa como pending_payment até receber webhook
    // Billing: começa como pending_billing_validation até admin aprovar
    let orderStatus: 'pending_payment' | 'pending_approval' | 'pending_billing_validation' = 'pending_payment';
    let paymentStatus: 'pending' | 'confirmed' | 'received' | 'failed' | 'refunded' = 'pending';
    let paidAt: Date | undefined = undefined;

    if (paymentMethod === 'billing') {
      orderStatus = 'pending_billing_validation';
      paymentStatus = 'pending';
    } else if (paymentMethod === 'credit_card' && asaasPayment?.status) {
      const confirmedStatuses = ['CONFIRMED', 'RECEIVED', 'RECEIVED_IN_CASH'];
      if (confirmedStatuses.includes(asaasPayment.status)) {
        orderStatus = 'pending_approval'; // Pagamento confirmado, aguarda aprovação da emissora
        paymentStatus = 'confirmed';
        paidAt = new Date();
      }
    }

    // 10. Cria pedido no MongoDB
    const orderNumber = await generateOrderNumber();

    const order = await Order.create({
      orderNumber,
      buyerId: userId,
      buyerName: billingInfo.name,
      buyerEmail: billingInfo.email,
      buyerPhone: billingInfo.phone,
      buyerDocument: billingInfo.cpfCnpj,
      items: cart.items.map((item: ICartItem) => ({
        productId: item.productId.toString(),
        productName: item.productName,
        broadcasterName: item.broadcasterName,
        broadcasterId: item.broadcasterId.toString(),
        quantity: item.quantity,
        unitPrice: item.price,
        totalPrice: item.price * item.quantity,
        schedule: item.schedule,
        material: item.material
      })),

      // Dados de faturamento (se applicable)
      ...(paymentMethod === 'billing' && billingData ? {
        billingData: {
          razaoSocial: billingData.razaoSocial,
          cnpj: billingData.cnpj,
          address: billingData.address,
          phone: billingData.phone,
          billingEmail: billingData.billingEmail
        },
        billingStatus: 'pending_validation',
        billingInvoices: []
      } : {}),

      payment: {
        method: paymentMethod,
        status: paymentStatus,
        asaasPaymentId: asaasPayment?.id,
        asaasInvoiceUrl: asaasPayment?.invoiceUrl,
        pixQrCode: asaasPayment?.pixQrCode,
        pixCopyPaste: asaasPayment?.pixCopyPaste,
        cardBrand: asaasPayment?.creditCard?.creditCardBrand,
        cardLastDigits: asaasPayment?.creditCard?.creditCardNumber?.slice(-4),
        installments: installments || 1,
        walletAmountUsed: walletAmountToUse,
        chargedAmount: chargeAmount,
        totalAmount,
        paidAt
      },
      splits,
      status: orderStatus,
      grossAmount,
      broadcasterAmount,
      platformSplit,
      techFee,
      agencyCommission,
      monitoringCost,
      isMonitoringEnabled: isMonitoringEnabled !== undefined ? isMonitoringEnabled : true,
      totalAmount,
      // Manter campos deprecated
      subtotal: grossAmount,
      platformFee: techFee,
      paidAt
    });

    // 11. Limpa carrinho
    await Cart.findByIdAndDelete(cart._id);


    // Criar conversa automaticamente
    await createConversationFromOrder(order._id.toString());

    // 12. Se pagamento já foi aprovado (cartão), processa aprovação
    if (orderStatus === 'pending_approval') {
      // 🤖 PRIMEIRO: Verifica se deve auto-aprovar (emissoras catálogo)
      try {
        const autoApprovalResult = await processAutoApprovalForCatalogItems(order._id.toString());
        if (autoApprovalResult.autoApproved) {
          // Não precisa enviar emails para emissoras (já foi tratado na função)
        } else {
          // Enviar emails apenas para emissoras que NÃO são catálogo
          const broadcasterItemsMap: { [key: string]: any[] } = {};
          cart.items.forEach((item: any) => {
            const bid = item.broadcasterId.toString();
            // Pula emissoras catálogo
            if (!autoApprovalResult.catalogItems.includes(bid)) {
              if (!broadcasterItemsMap[bid]) {
                broadcasterItemsMap[bid] = [];
              }
              broadcasterItemsMap[bid].push(item);
            }
          });

          // Envia emails para emissoras REGULARES
          for (const [broadcasterId, items] of Object.entries(broadcasterItemsMap)) {
            try {
              const broadcaster = await User.findById(broadcasterId);
              if (broadcaster?.email) {
                const totalValue = items.reduce((sum: number, i: any) => sum + i.price * i.quantity, 0);
                const itemsCount = items.reduce((sum: number, i: any) => sum + i.quantity, 0);

                sendNewOrderToBroadcaster({
                  orderNumber: order.orderNumber,
                  buyerName: billingInfo.name,
                  buyerEmail: billingInfo.email,
                  broadcasterName: broadcaster.fantasyName || broadcaster.companyName || 'Emissora',
                  broadcasterEmail: broadcaster.email,
                  totalValue,
                  itemsCount,
                  createdAt: new Date()
                }).catch(err => console.error(`❌ Erro ao enviar email para emissora ${broadcasterId}:`, err));
              }
            } catch (emailErr) {
              console.error(`❌ Erro ao processar email para emissora ${broadcasterId}:`, emailErr);
            }
          }
        }
      } catch (autoApprovalErr) {
        console.error(`❌ Erro ao processar auto-aprovação:`, autoApprovalErr);
        // Fallback: envia para todas emissoras
        const broadcasterItemsMap: { [key: string]: any[] } = {};
        cart.items.forEach((item: any) => {
          const bid = item.broadcasterId.toString();
          if (!broadcasterItemsMap[bid]) {
            broadcasterItemsMap[bid] = [];
          }
          broadcasterItemsMap[bid].push(item);
        });

        for (const [broadcasterId, items] of Object.entries(broadcasterItemsMap)) {
          try {
            const broadcaster = await User.findById(broadcasterId);
            if (broadcaster?.email) {
              const totalValue = items.reduce((sum: number, i: any) => sum + i.price * i.quantity, 0);
              const itemsCount = items.reduce((sum: number, i: any) => sum + i.quantity, 0);

              sendNewOrderToBroadcaster({
                orderNumber: order.orderNumber,
                buyerName: billingInfo.name,
                buyerEmail: billingInfo.email,
                broadcasterName: broadcaster.fantasyName || broadcaster.companyName || 'Emissora',
                broadcasterEmail: broadcaster.email,
                totalValue,
                itemsCount,
                createdAt: new Date()
              }).catch(err => console.error(`❌ Erro ao enviar email para emissora ${broadcasterId}:`, err));
            }
          } catch (emailErr) {
            console.error(`❌ Erro ao processar email para emissora ${broadcasterId}:`, emailErr);
          }
        }
      }

      // 📧 Envia email de confirmação para o CLIENTE
      try {
        await sendOrderConfirmationToClient({
          orderNumber: order.orderNumber,
          buyerName: billingInfo.name,
          buyerEmail: billingInfo.email,
          items: cart.items.map((item: ICartItem) => ({
            productName: item.productName,
            broadcasterName: item.broadcasterName,
            quantity: item.quantity,
            unitPrice: item.price,
            totalPrice: item.price * item.quantity
          })),
          subtotal: grossAmount,
          techFee: techFee,
          totalAmount: totalAmount,
          paymentMethod: paymentMethod,
          createdAt: new Date()
        });
      } catch (clientEmailErr) {
        console.error(`❌ Erro ao enviar email de confirmação para cliente:`, clientEmailErr);
      }
    }

    // 13. Se método é billing, envia e-mails de validação
    if (paymentMethod === 'billing') {
      // E-mail para cliente
      const emailService = require('../services/emailService');
      await emailService.sendBillingPendingValidation({
        clientEmail: billingInfo.email,
        clientName: billingInfo.name,
        orderNumber: order.orderNumber,
        totalValue: totalAmount
      }).catch((err: Error) => console.error('❌ Erro ao enviar email para cliente:', err));

      // E-mail para admin (dereck.conink@gmail.com)
      await emailService.sendBillingAdminNotification({
        orderNumber: order.orderNumber,
        clientName: billingInfo.name,
        totalValue: totalAmount,
        adminEmail: 'dereck.conink@gmail.com'
      }).catch((err: Error) => console.error('❌ Erro ao enviar email para admin:', err));

    }

    res.status(200).json({
      success: true,
      order: order,
      paymentInfo: {
        asaasPaymentId: asaasPayment?.id,
        invoiceUrl: asaasPayment?.invoiceUrl,
        pixQrCode: asaasPayment?.pixQrCode,
        pixCopyPaste: asaasPayment?.pixCopyPaste,
        status: asaasPayment?.status
      },
      message: paymentMethod === 'pix'
        ? 'QR Code PIX gerado! Pague para confirmar o pedido.'
        : orderStatus === 'pending_approval'
          ? 'Pagamento confirmado! Aguardando aprovação das emissoras.'
          : 'Pagamento em processamento. Aguarde a confirmação.'
    });

  } catch (error: any) {
    console.error('❌ Erro no checkout:', error);
    console.error('Stack trace:', error.stack);
    console.error('Request body:', JSON.stringify(req.body, null, 2));
    res.status(500).json({
      message: 'Erro ao processar pagamento',
      error: error.message,
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
};

/**
 * POST /api/payment/webhook
 * Recebe notificações de status do Asaas
 */
export const handleWebhook = async (req: Request, res: Response) => {
  try {
    const { event, payment } = req.body;


    // Registra webhook log
    const order = await Order.findOne({ 'payment.asaasPaymentId': payment.id });

    if (!order) {
      console.warn(`⚠️ Pedido não encontrado para payment ID: ${payment.id}`);
      return res.status(404).json({ message: 'Pedido não encontrado' });
    }

    // Adiciona log do webhook
    order.webhookLogs.push({
      event,
      receivedAt: new Date(),
      payload: req.body
    });

    // Processa eventos
    switch (event) {
      case 'PAYMENT_CONFIRMED':
      case 'PAYMENT_RECEIVED':
        // Pagamento confirmado (cartão aprovado ou PIX recebido)
        order.payment.status = 'confirmed';
        order.payment.paidAt = new Date();
        order.status = 'pending_approval'; // Muda para aguardando aprovação da emissora
        order.paidAt = new Date();


        // 📄 EMISSÃO AUTOMÁTICA DE NOTA FISCAL
        // Verificar flag de ambiente (pode ser desabilitada durante testes)
        const enableAutoInvoice = process.env.ENABLE_AUTO_INVOICE !== 'false';

        if (enableAutoInvoice) {
          try {

            const nfData = await asaasService.emitirNotaFiscal({
              paymentId: payment.id,
              serviceDescription: `Veiculação de campanha publicitária - Pedido ${order.orderNumber}`,
              observations: `Campanha de ${order.buyerName}. Total de ${order.items.length} item(ns).`,
              externalReference: order.orderNumber
            });

            // Salva dados da NF no pedido
            order.payment.asaasInvoiceId = nfData.id;
            order.payment.asaasInvoiceUrl = nfData.pdfUrl || '';

          } catch (nfError: any) {
            console.error(`❌ ERRO ao emitir NF automaticamente: ${nfError.message}`);
            console.error(`⚠️ ATENÇÃO: Emissão manual necessária no painel Asaas`);
            console.error(`   Pedido: ${order.orderNumber}`);
            console.error(`   Payment ID: ${payment.id}`);
            console.error(`   Acesse: https://sandbox.asaas.com → Notas Fiscais → Nova NF`);
            // NÃO bloqueia o fluxo se NF falhar - apenas registra o erro
            // ⚠️ NOTA: Problema conhecido com subcontas - API não reconhece config do painel
            // Solução temporária: Emitir NF manualmente pelo painel Asaas
          }
        } else {
        }

        // ⚠️ Para pedidos BILLING: Emissoras NÃO são notificadas aqui!
        // Elas só receberão email após admin aprovar o pedido (billingController.approveBillingOrder)
        if (order.payment.method !== 'billing') {
          // Envia email para as emissoras notificando do novo pedido (pagamento normal)
          const broadcasterItems: { [key: string]: any[] } = {};
          order.items.forEach((item: any) => {
            const bid = item.broadcasterId;
            if (!broadcasterItems[bid]) {
              broadcasterItems[bid] = [];
            }
            broadcasterItems[bid].push(item);
          });

          for (const [broadcasterId, items] of Object.entries(broadcasterItems)) {
            try {
              const broadcaster = await User.findById(broadcasterId);
              if (broadcaster?.email) {
                const totalValue = items.reduce((sum: number, i: any) => sum + i.totalPrice, 0);
                const itemsCount = items.reduce((sum: number, i: any) => sum + i.quantity, 0);

                sendNewOrderToBroadcaster({
                  orderNumber: order.orderNumber,
                  buyerName: order.buyerName,
                  buyerEmail: order.buyerEmail,
                  broadcasterName: broadcaster.fantasyName || broadcaster.companyName || 'Emissora',
                  broadcasterEmail: broadcaster.email,
                  totalValue,
                  itemsCount,
                  createdAt: order.createdAt
                }).catch(err => console.error(`❌ Erro ao enviar email para emissora ${broadcasterId}:`, err));
              }
            } catch (emailErr) {
              console.error(`❌ Erro ao processar email para emissora ${broadcasterId}:`, emailErr);
            }
          }
        } else {
        }

        // 🤖 PROCESSA AUTO-APROVAÇÃO PARA EMISSORAS CATÁLOGO
        // Se TODOS os itens forem de emissoras catálogo, o pedido é aprovado automaticamente
        try {
          const autoApprovalResult = await processAutoApprovalForCatalogItems(order._id.toString());
          if (autoApprovalResult.autoApproved) {
            // O status já foi atualizado na função, não precisa fazer mais nada
          } else if (autoApprovalResult.catalogItems.length > 0) {
          }
        } catch (autoApprovalErr) {
          console.error(`❌ Erro no auto-approval:`, autoApprovalErr);
          // Não bloqueia o fluxo se falhar
        }

        // 📧 Envia email de confirmação para o CLIENTE
        try {
          await sendOrderConfirmationToClient({
            orderNumber: order.orderNumber,
            buyerName: order.buyerName,
            buyerEmail: order.buyerEmail,
            items: order.items.map((item: any) => ({
              productName: item.productName,
              broadcasterName: item.broadcasterName,
              quantity: item.quantity,
              unitPrice: item.unitPrice,
              totalPrice: item.totalPrice
            })),
            subtotal: order.grossAmount,
            techFee: order.techFee,
            totalAmount: order.payment.totalAmount || order.totalAmount,
            paymentMethod: order.payment.method,
            createdAt: order.createdAt
          });
        } catch (clientEmailErr) {
          console.error(`❌ Erro ao enviar email de confirmação para cliente:`, clientEmailErr);
        }
        break;

      case 'PAYMENT_CREDIT_CARD_CAPTURE_REFUSED':
      case 'PAYMENT_REPROVED':
        // Pagamento recusado
        order.payment.status = 'failed';
        order.payment.failureReason = payment.description;
        order.status = 'cancelled';

        // Devolve créditos da wallet se foram usados
        if (order.payment.walletAmountUsed > 0) {
          const wallet = await Wallet.findOne({ userId: order.buyerId });
          if (wallet) {
            await wallet.addCredit(
              order.payment.walletAmountUsed,
              `Estorno - Pedido ${order.orderNumber} (pagamento recusado)`,
              order._id
            );
          }
        }

        break;

      case 'PAYMENT_REFUNDED':
        // Pagamento estornado
        order.payment.status = 'refunded';
        order.status = 'refunded';

        // Credita valor total na wallet
        const wallet = await Wallet.findOne({ userId: order.buyerId });
        if (wallet) {
          await wallet.addCredit(
            order.totalAmount,
            `Estorno - Pedido ${order.orderNumber}`,
            order._id
          );
        }

        break;
    }

    await order.save();

    res.status(200).json({ received: true });

  } catch (error: any) {
    console.error('❌ Erro ao processar webhook:', error);
    res.status(500).json({ message: 'Erro ao processar webhook' });
  }
};

/**
 * GET /api/payment/:orderId
 * Consulta status de um pedido
 */
export const getOrderStatus = async (req: Request, res: Response) => {
  try {
    const { orderId } = req.params;
    const userId = (req as any).user.userId;

    const order = await Order.findById(orderId);

    if (!order) {
      return res.status(404).json({ message: 'Pedido não encontrado' });
    }

    // Verifica se o usuário é dono do pedido
    if (order.buyerId.toString() !== userId) {
      return res.status(403).json({ message: 'Acesso negado' });
    }

    // Se tem ID Asaas, consulta status atualizado
    if (order.payment.asaasPaymentId) {
      try {
        const asaasStatus = await asaasService.getPaymentStatus(order.payment.asaasPaymentId);

        // Atualiza status se mudou
        if (asaasStatus.status === 'RECEIVED' && order.payment.status !== 'confirmed') {
          order.payment.status = 'confirmed';
          order.status = 'paid';
          order.paidAt = new Date();
          await order.save();
        }
      } catch (error) {
        console.warn('⚠️ Erro ao consultar status no Asaas:', error);
      }
    }

    res.status(200).json({ order });

  } catch (error: any) {
    console.error('❌ Erro ao consultar pedido:', error);
    res.status(500).json({ message: 'Erro ao consultar pedido' });
  }
};

/**
 * GET /api/payment/orders
 * Lista pedidos do usuário
 */
export const getUserOrders = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) {
      return res.status(401).json({ message: 'Usuário não autenticado' });
    }
    if (!userId) {
      return res.status(401).json({ message: 'Usuário não autenticado' });
    }
    const { status, limit = 20, page = 1 } = req.query;

    const query: any = { buyerId: userId };
    if (status) {
      query.status = status;
    }

    const orders = await Order.find(query)
      .sort({ createdAt: -1 })
      .limit(Number(limit))
      .skip((Number(page) - 1) * Number(limit));

    const total = await Order.countDocuments(query);

    res.status(200).json({
      orders,
      pagination: {
        total,
        page: Number(page),
        limit: Number(limit),
        pages: Math.ceil(total / Number(limit))
      }
    });

  } catch (error: any) {
    console.error('❌ Erro ao listar pedidos:', error);
    res.status(500).json({ message: 'Erro ao listar pedidos' });
  }
};
