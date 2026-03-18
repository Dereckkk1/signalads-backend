import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { Cart } from '../models/Cart';
import { Product } from '../models/Product';
import { User } from '../models/User';
import Order from '../models/Order';
import { sendOrderReceivedToClient, sendNewOrderToAdmin } from '../services/emailService';

/**
 * POST /api/payment/checkout
 * Cria um pedido a partir do carrinho do usuario.
 * Modo atual: pending_contact (pagamento feito por fora).
 */
export const checkout = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.userId;
    if (!userId) {
      res.status(401).json({ error: 'Usuário não autenticado' });
      return;
    }

    const { isMonitoringEnabled, agencyCommission: agencyCommPct, clientId } = req.body;

    // 1. Buscar carrinho do banco (dados confiáveis)
    const cart = await Cart.findOne({ userId });
    if (!cart || cart.items.length === 0) {
      res.status(400).json({ error: 'Carrinho vazio' });
      return;
    }

    // 2. Buscar dados do comprador
    const user = await User.findById(userId);
    if (!user) {
      res.status(404).json({ error: 'Usuário não encontrado' });
      return;
    }

    // 3. Buscar produtos do banco para validar preços
    const productIds = cart.items.map(item => item.productId);
    const products = await Product.find({ _id: { $in: productIds } }).populate('broadcasterId');
    const productMap = new Map(products.map(p => [p._id.toString(), p]));

    // 4. Construir itens do pedido com preços do banco
    const orderItems: any[] = [];
    let productsTotal = 0;

    for (const cartItem of cart.items) {
      const product = productMap.get(cartItem.productId.toString());
      if (!product) {
        res.status(400).json({ error: `Produto ${cartItem.productId} não encontrado ou indisponível` });
        return;
      }

      const unitPrice = (product as any).pricePerInsertion;
      const totalPrice = parseFloat((unitPrice * cartItem.quantity).toFixed(2));
      productsTotal += totalPrice;

      const broadcaster: any = product.broadcasterId;

      // Converter schedule de Map para objeto para o Order
      const scheduleObj: Record<string, number> = {};
      if (cartItem.schedule) {
        if (cartItem.schedule instanceof Map) {
          cartItem.schedule.forEach((val: number, key: string) => { scheduleObj[key] = val; });
        } else {
          Object.assign(scheduleObj, cartItem.schedule);
        }
      }

      // Montar material do pedido
      let orderMaterial: any = undefined;
      if (cartItem.material) {
        orderMaterial = {
          type: cartItem.material.type,
          audioUrl: cartItem.material.audioUrl,
          audioFileName: cartItem.material.audioFileName,
          audioDuration: cartItem.material.audioDuration,
          scriptUrl: cartItem.material.scriptUrl,
          scriptFileName: cartItem.material.scriptFileName,
          text: cartItem.material.text,
          textDuration: cartItem.material.textDuration,
          script: cartItem.material.script,
          phonetic: cartItem.material.phonetic,
          voiceGender: cartItem.material.voiceGender,
          musicStyle: cartItem.material.musicStyle,
          aiGeneration: cartItem.material.aiGeneration,
          contentHash: cartItem.material.contentHash,
          status: 'pending_broadcaster_review',
          chat: []
        };
      }

      orderItems.push({
        productId: product._id.toString(),
        productName: (product as any).spotType || cartItem.productName,
        broadcasterName: broadcaster?.companyName || broadcaster?.fantasyName || cartItem.broadcasterName,
        broadcasterId: (cartItem.broadcasterId || broadcaster?._id)?.toString(),
        quantity: cartItem.quantity,
        unitPrice,
        totalPrice,
        schedule: scheduleObj,
        material: orderMaterial
      });
    }

    // 5. Calcular custo de produção (R$50 por gravação única)
    let productionCost = 0;
    const uniqueRecordings = new Set<string>();
    for (const item of orderItems) {
      if (item.material?.type === 'recording') {
        const hash = item.material.contentHash || item.material.script?.trim() || '';
        if (hash) uniqueRecordings.add(hash);
      }
    }
    productionCost = uniqueRecordings.size * 50;

    // 6. Calcular valores financeiros
    const grossAmount = parseFloat((productsTotal + productionCost).toFixed(2));
    const broadcasterAmount = parseFloat((grossAmount * 0.75).toFixed(2));
    const platformSplit = parseFloat((grossAmount * 0.20).toFixed(2));
    const techFee = parseFloat((grossAmount * 0.05).toFixed(2));

    const agencyCommission = agencyCommPct
      ? parseFloat((grossAmount * (agencyCommPct / 100)).toFixed(2))
      : 0;

    // Monitoramento: R$70 por emissora (emissoras com apenas testemunhal não contam)
    let monitoringCost = 0;
    if (isMonitoringEnabled) {
      const monitorableBroadcasters = new Set<string>();
      orderItems.forEach((item: any) => {
        if (!item.productName?.toLowerCase().startsWith('testemunhal')) {
          monitorableBroadcasters.add(item.broadcasterId);
        }
      });
      monitoringCost = monitorableBroadcasters.size * 70;
    }

    const totalAmount = parseFloat((grossAmount + techFee + agencyCommission + monitoringCost).toFixed(2));

    // 7. Criar pedido
    const order = new Order({
      buyerId: user._id,
      buyerName: user.name,
      buyerEmail: user.email,
      buyerPhone: user.phone || '',
      buyerDocument: user.cpfOrCnpj || user.cpf || '',
      items: orderItems,
      clientId: clientId || undefined,
      payment: {
        method: 'pending_contact',
        status: 'pending',
        walletAmountUsed: 0,
        chargedAmount: totalAmount,
        totalAmount: totalAmount
      },
      splits: [],
      status: 'pending_contact',
      grossAmount,
      broadcasterAmount,
      platformSplit,
      techFee,
      agencyCommission,
      monitoringCost,
      isMonitoringEnabled: !!isMonitoringEnabled,
      totalAmount,
      subtotal: productsTotal,
      platformFee: techFee,
      billingInvoices: [],
      billingDocuments: [],
      broadcasterInvoices: [],
      opecs: [],
      notifications: [],
      webhookLogs: []
    });

    await order.save();

    // 8. Limpar carrinho
    cart.items = [];
    await cart.save();

    // 9. Enviar emails (fire-and-forget)
    try {
      await sendOrderReceivedToClient({
        orderNumber: order.orderNumber,
        buyerName: user.name || '',
        buyerEmail: user.email,
        items: orderItems.map(i => ({ productName: i.productName, broadcasterName: i.broadcasterName })),
        totalValue: totalAmount
      });

      // Notificar admins
      const admins = await User.find({ userType: 'admin' }).select('email');
      const adminEmails = admins.map(a => a.email);
      if (adminEmails.length > 0) {
        await sendNewOrderToAdmin({
          orderNumber: order.orderNumber,
          buyerName: user.name || '',
          buyerEmail: user.email,
          buyerPhone: user.phone || '',
          totalValue: totalAmount,
          itemsCount: orderItems.length,
          adminEmails,
          isMonitoringEnabled: !!isMonitoringEnabled
        });
      }
    } catch (emailError) {
      console.error('Erro ao enviar emails de confirmação:', emailError);
      // Não falha o checkout por causa de email
    }

    res.status(201).json({
      order: {
        _id: order._id,
        orderNumber: order.orderNumber,
        status: order.status,
        totalAmount: order.totalAmount,
        items: order.items,
        createdAt: order.createdAt
      }
    });
  } catch (error) {
    console.error('Erro no checkout:', error);
    res.status(500).json({ error: 'Erro ao criar pedido' });
  }
};
