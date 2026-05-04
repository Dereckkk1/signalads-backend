import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { Cart } from '../models/Cart';
import { Product } from '../models/Product';
import { Sponsorship } from '../models/Sponsorship';
import { User } from '../models/User';
import Order from '../models/Order';
import AgencyClient from '../models/AgencyClient';
import SponsorshipBooking from '../models/SponsorshipBooking';
import { sendOrderReceivedToClient, sendNewOrderToAdmin } from '../services/emailService';
import { shouldSendNotification } from '../services/notificationService';

// Gera schedule automático para patrocínio: cada dia do mês que bate com daysOfWeek
function generateSponsorshipSchedule(selectedMonth: string, daysOfWeek: number[]): Record<string, number> {
  const parts = selectedMonth.split('-').map(Number);
  const year = parts[0]!;
  const month = parts[1]!;
  const daysInMonth = new Date(year, month, 0).getDate();
  const schedule: Record<string, number> = {};
  for (let day = 1; day <= daysInMonth; day++) {
    const date = new Date(year, month - 1, day);
    if (daysOfWeek.includes(date.getDay())) {
      const key = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      schedule[key] = 1;
    }
  }
  return schedule;
}

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

    // Apenas advertiser e agency podem fazer checkout
    const userType = req.user?.userType;
    if (!userType || !['advertiser', 'agency'].includes(userType)) {
      res.status(403).json({ error: 'Apenas anunciantes e agências podem fazer compras' });
      return;
    }

    const { isMonitoringEnabled, agencyCommission: agencyCommPct, clientId } = req.body;

    // Comissao de agencia so permitida para usuarios do tipo agency
    if (agencyCommPct !== undefined && agencyCommPct > 0) {
      if (userType !== 'agency') {
        res.status(403).json({ error: 'Apenas agências podem aplicar comissão' });
        return;
      }
      const pct = Number(agencyCommPct);
      if (!Number.isFinite(pct) || pct < 0 || pct > 30) {
        res.status(400).json({ error: 'Percentual de comissão da agência deve ser entre 0 e 30%' });
        return;
      }
    }

    // Se clientId foi enviado, valida que pertence a este usuario (agencia)
    // Previne anunciantes/agencias atribuirem pedidos a clientes de terceiros.
    if (clientId) {
      // Aceita apenas se for ObjectId valido
      if (!/^[a-f\d]{24}$/i.test(String(clientId))) {
        res.status(400).json({ error: 'clientId inválido' });
        return;
      }
      const exists = await AgencyClient.exists({ _id: clientId, agencyId: userId });
      if (!exists) {
        res.status(400).json({ error: 'Cliente informado não pertence à sua conta' });
        return;
      }
    }

    // 1. Buscar carrinho do banco (dados confiáveis) — atomico para prevenir double checkout
    const cart = await Cart.findOneAndUpdate(
      { userId, items: { $not: { $size: 0 } }, checkedOut: { $ne: true } },
      { $set: { checkedOut: true } },
      { new: true }
    );
    if (!cart || cart.items.length === 0) {
      res.status(400).json({ error: 'Carrinho vazio ou checkout já em andamento' });
      return;
    }

    // 2. Buscar dados do comprador
    const user = await User.findById(userId);
    if (!user) {
      res.status(404).json({ error: 'Usuário não encontrado' });
      return;
    }

    // 3. Separar itens por tipo e buscar do banco
    const productCartItems = cart.items.filter((item: any) => !item.itemType || item.itemType === 'product');
    const sponsorshipCartItems = cart.items.filter((item: any) => item.itemType === 'sponsorship');

    const productIds = productCartItems.map(item => item.productId);
    const products = await Product.find({ _id: { $in: productIds }, isActive: true }).populate('broadcasterId');
    const productMap = new Map(products.map(p => [p._id.toString(), p]));

    const sponsorshipIds = sponsorshipCartItems.map(item => item.productId);
    const sponsorshipsDb = await Sponsorship.find({ _id: { $in: sponsorshipIds }, isActive: true }).populate('broadcasterId');
    const sponsorshipMap = new Map(sponsorshipsDb.map(s => [s._id.toString(), s]));

    // 4. Construir itens do pedido com preços do banco
    const orderItems: any[] = [];
    let productsTotal = 0;

    // ─── Produtos normais ────────────────────────────────────────────────
    for (const cartItem of productCartItems) {
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

    // ─── Patrocínios ─────────────────────────────────────────────────────
    for (const cartItem of sponsorshipCartItems) {
      const sponsorship = sponsorshipMap.get(cartItem.productId.toString());
      if (!sponsorship) {
        res.status(400).json({ error: `Patrocínio ${cartItem.productId} não encontrado ou indisponível` });
        return;
      }

      const selectedMonth = (cartItem as any).selectedMonth;
      if (!selectedMonth) {
        res.status(400).json({ error: `Mês não selecionado para patrocínio ${sponsorship.programName}` });
        return;
      }

      const unitPrice = sponsorship.pricePerMonth;
      const totalPrice = unitPrice; // 1 mês
      productsTotal += totalPrice;

      const broadcaster: any = sponsorship.broadcasterId;

      // Gerar schedule automático
      const scheduleObj = generateSponsorshipSchedule(selectedMonth, sponsorship.daysOfWeek);

      // Montar materiais de patrocínio (por tipo de inserção)
      const sponsorshipMaterials: Record<string, any> = {};
      const cartMaterials: any = (cartItem as any).sponsorshipMaterials;

      for (const ins of sponsorship.insertions) {
        if (ins.requiresMaterial && cartMaterials?.[ins.name]) {
          const mat = cartMaterials[ins.name];
          sponsorshipMaterials[ins.name] = {
            type: mat.type,
            audioUrl: mat.audioUrl,
            audioFileName: mat.audioFileName,
            audioDuration: mat.audioDuration,
            scriptUrl: mat.scriptUrl,
            scriptFileName: mat.scriptFileName,
            text: mat.text,
            textDuration: mat.textDuration,
            script: mat.script,
            phonetic: mat.phonetic,
            voiceGender: mat.voiceGender,
            musicStyle: mat.musicStyle,
            aiGeneration: mat.aiGeneration,
            contentHash: mat.contentHash,
            status: 'pending_broadcaster_review',
            chat: []
          };
        }
      }

      orderItems.push({
        productId: sponsorship._id.toString(),
        productName: sponsorship.programName,
        broadcasterName: broadcaster?.companyName || broadcaster?.fantasyName || cartItem.broadcasterName,
        broadcasterId: (cartItem.broadcasterId || broadcaster?._id)?.toString(),
        quantity: 1,
        unitPrice,
        totalPrice,
        schedule: scheduleObj,
        material: undefined, // Patrocínios usam sponsorshipMaterials
        // Campos específicos de patrocínio
        itemType: 'sponsorship',
        sponsorshipId: sponsorship._id.toString(),
        programName: sponsorship.programName,
        programTimeRange: sponsorship.timeRange,
        programDaysOfWeek: sponsorship.daysOfWeek,
        selectedMonth,
        sponsorshipInsertions: sponsorship.insertions.map(ins => ({
          name: ins.name,
          duration: ins.duration,
          quantityPerDay: ins.quantityPerDay,
          requiresMaterial: ins.requiresMaterial
        })),
        sponsorshipMaterials: Object.keys(sponsorshipMaterials).length > 0 ? sponsorshipMaterials : undefined
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

    // 7.5. Reservar slots de patrocinio (mes-a-mes) ANTES de salvar o pedido.
    // O index parcial unique em SponsorshipBooking impede dupla reserva
    // do mesmo (sponsorshipId, month) com status='reserved'.
    const sponsorshipBookingsCreated: any[] = [];
    try {
      for (const item of orderItems) {
        if (item.itemType === 'sponsorship' && item.sponsorshipId && item.selectedMonth) {
          const booking = await SponsorshipBooking.create({
            sponsorshipId: item.sponsorshipId,
            month: item.selectedMonth,
            orderId: order._id,
            status: 'reserved',
          });
          sponsorshipBookingsCreated.push(booking);
        }
      }
    } catch (bookingErr: any) {
      // Cleanup: liberar reservas ja criadas neste checkout
      if (sponsorshipBookingsCreated.length > 0) {
        const ids = sponsorshipBookingsCreated.map((b) => b._id);
        await SponsorshipBooking.deleteMany({ _id: { $in: ids } }).catch(() => {});
      }
      // Resetar flag de checkout para permitir nova tentativa
      try { await Cart.updateOne({ userId: req.userId }, { $set: { checkedOut: false } }); } catch {}

      // Detecta erro de chave duplicada (E11000)
      if (bookingErr?.code === 11000) {
        const dupItem = orderItems.find(
          (i: any) =>
            i.itemType === 'sponsorship' &&
            i.sponsorshipId &&
            i.selectedMonth &&
            !sponsorshipBookingsCreated.some((b) => String(b.sponsorshipId) === String(i.sponsorshipId) && b.month === i.selectedMonth)
        );
        const monthLabel = dupItem?.selectedMonth || 'selecionado';
        const programLabel = dupItem?.programName || 'este patrocínio';
        res.status(409).json({
          error: `Mês ${monthLabel} já reservado para ${programLabel}. Selecione outro mês.`,
        });
        return;
      }
      console.error('Erro ao criar reservas de patrocínio:', bookingErr);
      res.status(500).json({ error: 'Erro ao reservar slots de patrocínio' });
      return;
    }

    await order.save();

    // 8. Limpar carrinho e resetar flag de checkout
    cart.items = [];
    (cart as any).checkedOut = false;
    await cart.save();

    // 9. Enviar emails — fire-and-forget (nao bloqueia response do checkout)
    if (await shouldSendNotification(req.userId!, 'ownOrderUpdates')) {
      sendOrderReceivedToClient({
        orderNumber: order.orderNumber,
        buyerName: user.name || '',
        buyerEmail: user.email,
        items: orderItems.map(i => ({ productName: i.productName, broadcasterName: i.broadcasterName })),
        totalValue: totalAmount
      }).catch(err => console.error('Email error (client):', err));
    }

    // Notificar admins (fire-and-forget)
    User.find({
      userType: 'admin',
      $or: [
        { 'notificationPreferences.newOrders': { $ne: false } },
        { notificationPreferences: { $exists: false } }
      ]
    }).select('email').then(admins => {
      const adminEmails = admins.map(a => a.email);
      if (adminEmails.length > 0) {
        sendNewOrderToAdmin({
          orderNumber: order.orderNumber,
          buyerName: user.name || '',
          buyerEmail: user.email,
          buyerPhone: user.phone || '',
          totalValue: totalAmount,
          itemsCount: orderItems.length,
          adminEmails,
          isMonitoringEnabled: !!isMonitoringEnabled
        }).catch(err => console.error('Email error (admin):', err));
      }
    }).catch(err => console.error('Admin lookup error:', err));

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
    // Reseta flag de checkout para permitir nova tentativa
    try { await Cart.updateOne({ userId: req.userId }, { $set: { checkedOut: false } }); } catch {}
    console.error('Erro no checkout:', error);
    res.status(500).json({ error: 'Erro ao criar pedido' });
  }
};
