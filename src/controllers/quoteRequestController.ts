import { Request, Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import QuoteRequest from '../models/QuoteRequest';
import { Cart } from '../models/Cart';
import { User } from '../models/User';
import { sendQuoteRequestToAdmin, sendQuoteConfirmationToClient } from '../services/emailService';

/**
 * Controller de Solicitações de Contato Comercial
 * 
 * Sistema simplificado: Cliente "compra" mas na verdade está apenas
 * solicitando contato. Admin recebe notificação e processa manualmente.
 */

/**
 * POST /api/quotes/create
 * Cria uma nova solicitação de contato a partir do carrinho
 */
export const createQuoteRequest = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    const { clientNotes } = req.body;


    // 1. Busca carrinho do usuário
    const cart = await Cart.findOne({ userId }).populate('items.broadcasterId', 'companyName fantasyName');

    if (!cart || !cart.items || cart.items.length === 0) {
      return res.status(400).json({ 
        message: 'Seu carrinho está vazio. Adicione produtos antes de solicitar contato.' 
      });
    }

    // 2. Busca dados do cliente
    const buyer = await User.findById(userId);
    if (!buyer) {
      return res.status(404).json({ message: 'Usuário não encontrado' });
    }

    // 3. Valida que todos os itens têm material anexado
    const itemsWithoutMaterial = cart.items.filter(item => !item.material || !item.material.type);
    if (itemsWithoutMaterial.length > 0) {
      return res.status(400).json({ 
        message: 'Todos os produtos precisam ter material (áudio, roteiro ou texto) anexado.' 
      });
    }

    // 4. Calcula valor total
    const totalValue = cart.items.reduce((sum, item) => sum + (item.price * item.quantity), 0);

    // 5. Monta itens da solicitação
    const quoteItems = cart.items.map(item => ({
      productId: item.productId.toString(),
      productName: item.productName,
      broadcasterName: item.broadcasterName,
      broadcasterId: item.broadcasterId.toString(),
      quantity: item.quantity,
      unitPrice: item.price,
      totalPrice: item.price * item.quantity,
      schedule: item.schedule || {},
      material: {
        type: item.material?.type || 'audio',
        audioUrl: item.material?.audioUrl,
        audioFileName: item.material?.audioFileName,
        audioDuration: item.material?.audioDuration,
        scriptUrl: item.material?.scriptUrl,
        scriptFileName: item.material?.scriptFileName,
        text: item.material?.text,
        textDuration: item.material?.textDuration
      }
    }));

    // 6. Cria solicitação
    const quoteRequest = await QuoteRequest.create({
      buyer: userId,
      buyerName: buyer.name,
      buyerEmail: buyer.email,
      buyerPhone: buyer.phone,
      buyerType: buyer.userType === 'agency' ? 'agency' : 'advertiser',
      items: quoteItems,
      totalValue,
      clientNotes,
      status: 'pending'
    });


    // 7. Limpa carrinho
    cart.items = [];
    await cart.save();

    // 8. Envia e-mails
    try {
      // Para o cliente: confirmação de recebimento
      await sendQuoteConfirmationToClient(
        { email: buyer.email || '', name: buyer.name || '' }, 
        quoteRequest
      );

      // Para o admin: notificação de nova solicitação
      await sendQuoteRequestToAdmin(
        quoteRequest, 
        { 
          name: buyer.name || '', 
          email: buyer.email || '', 
          phone: buyer.phone, 
          userType: buyer.userType 
        }
      );
    } catch (emailError) {
      // Não falha a requisição se o email falhar
    }

    // 9. Retorna sucesso
    return res.status(201).json({
      message: 'Solicitação enviada com sucesso! Nossa equipe entrará em contato em breve.',
      quoteRequest: {
        requestNumber: quoteRequest.requestNumber,
        totalValue: quoteRequest.totalValue,
        itemsCount: quoteRequest.items.length,
        status: quoteRequest.status,
        createdAt: quoteRequest.createdAt
      }
    });

  } catch (error) {
    return res.status(500).json({ 
      message: 'Erro ao processar solicitação. Tente novamente.' 
    });
  }
};

/**
 * GET /api/quotes/my-requests
 * Lista solicitações do cliente logado
 */
export const getMyQuoteRequests = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;

    const requests = await QuoteRequest.find({ buyer: userId })
      .sort({ createdAt: -1 })
      .select('-statusHistory -adminNotes'); // Não expõe notas internas


    return res.json(requests);

  } catch (error) {
    return res.status(500).json({ message: 'Erro ao buscar solicitações' });
  }
};

/**
 * GET /api/quotes/:requestNumber
 * Detalhes de uma solicitação específica
 */
export const getQuoteRequestDetails = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    const { requestNumber } = req.params;

    const request = await QuoteRequest.findOne({ requestNumber });

    if (!request) {
      return res.status(404).json({ message: 'Solicitação não encontrada' });
    }

    // Verifica se o usuário tem permissão (dono ou admin)
    const user = await User.findById(userId);
    const isOwner = request.buyer.toString() === userId;
    const isAdmin = user?.userType === 'admin';

    if (!isOwner && !isAdmin) {
      return res.status(403).json({ message: 'Sem permissão para ver esta solicitação' });
    }

    // Remove notas internas se não for admin
    const response = request.toObject();
    if (!isAdmin) {
      delete response.adminNotes;
    }

    return res.json(response);

  } catch (error) {
    return res.status(500).json({ message: 'Erro ao buscar detalhes' });
  }
};

/**
 * GET /api/admin/quotes
 * Lista TODAS as solicitações (apenas admin)
 */
export const getAllQuoteRequests = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;

    // Verifica se é admin
    const user = await User.findById(userId);
    if (user?.userType !== 'admin') {
      return res.status(403).json({ message: 'Acesso negado. Apenas administradores.' });
    }

    const { status, sortBy = 'createdAt', order = 'desc' } = req.query;

    // Whitelist de campos permitidos para ordenacao (previne sort field injection)
    const allowedSortFields = ['createdAt', 'updatedAt', 'status', 'requestNumber', 'totalPrice'];
    const safeSortBy = allowedSortFields.includes(sortBy as string) ? (sortBy as string) : 'createdAt';
    const safeOrder = order === 'asc' ? 1 : -1;

    // Monta filtro
    const filter: any = {};
    if (status && status !== 'all') {
      filter.status = status;
    }

    // Busca solicitações
    const requests = await QuoteRequest.find(filter)
      .sort({ [safeSortBy]: safeOrder })
      .lean();


    return res.json(requests);

  } catch (error) {
    return res.status(500).json({ message: 'Erro ao buscar solicitações' });
  }
};

/**
 * PATCH /api/admin/quotes/:requestNumber/status
 * Atualiza status da solicitação (apenas admin)
 */
export const updateQuoteRequestStatus = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    const { requestNumber } = req.params;
    const { status, notes } = req.body;

    // Verifica se é admin
    const user = await User.findById(userId);
    if (user?.userType !== 'admin') {
      return res.status(403).json({ message: 'Acesso negado.' });
    }

    const request = await QuoteRequest.findOne({ requestNumber });
    if (!request) {
      return res.status(404).json({ message: 'Solicitação não encontrada' });
    }

    // Valida status
    const validStatuses = ['pending', 'contacted', 'negotiating', 'converted', 'rejected'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ message: 'Status inválido' });
    }

    // Atualiza status
    const oldStatus = request.status;
    request.status = status;

    // Adiciona ao histórico
    request.statusHistory.push({
      status,
      changedBy: userId as any,
      changedAt: new Date(),
      notes
    });

    // Atualiza campos de data conforme status
    if (status === 'contacted' && !request.contactedAt) {
      request.contactedAt = new Date();
    }
    if (status === 'converted' && !request.convertedAt) {
      request.convertedAt = new Date();
    }
    if (status === 'rejected' && !request.rejectedAt) {
      request.rejectedAt = new Date();
    }

    await request.save();


    return res.json({
      message: 'Status atualizado com sucesso',
      request: {
        requestNumber: request.requestNumber,
        status: request.status,
        updatedAt: request.updatedAt
      }
    });

  } catch (error) {
    return res.status(500).json({ message: 'Erro ao atualizar status' });
  }
};

/**
 * PATCH /api/admin/quotes/:requestNumber/notes
 * Adiciona/atualiza notas internas (apenas admin)
 */
export const updateAdminNotes = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    const { requestNumber } = req.params;
    const { adminNotes } = req.body;

    const user = await User.findById(userId);
    if (user?.userType !== 'admin') {
      return res.status(403).json({ message: 'Acesso negado.' });
    }

    const request = await QuoteRequest.findOne({ requestNumber });
    if (!request) {
      return res.status(404).json({ message: 'Solicitação não encontrada' });
    }

    request.adminNotes = adminNotes;
    await request.save();


    return res.json({ message: 'Notas atualizadas com sucesso' });

  } catch (error) {
    return res.status(500).json({ message: 'Erro ao atualizar notas' });
  }
};

/**
 * GET /api/admin/quotes/stats
 * Estatísticas para dashboard admin
 */
export const getQuoteRequestStats = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;

    const user = await User.findById(userId);
    if (user?.userType !== 'admin') {
      return res.status(403).json({ message: 'Acesso negado.' });
    }

    // Uma unica aggregation com $facet em vez de 8 queries separadas
    const [stats] = await QuoteRequest.aggregate([
      {
        $facet: {
          byStatus: [
            { $group: { _id: '$status', count: { $sum: 1 } } }
          ],
          totalPendingValue: [
            { $match: { status: { $in: ['pending', 'contacted', 'negotiating'] } } },
            { $group: { _id: null, sum: { $sum: '$totalValue' } } }
          ],
          totalConvertedValue: [
            { $match: { status: 'converted' } },
            { $group: { _id: null, sum: { $sum: '$totalValue' } } }
          ],
          total: [
            { $count: 'n' }
          ]
        }
      }
    ]);

    // Monta resposta no mesmo formato da API anterior
    const statusCounts: Record<string, number> = { pending: 0, contacted: 0, negotiating: 0, converted: 0, rejected: 0 };
    for (const s of stats.byStatus) {
      if (s._id in statusCounts) statusCounts[s._id] = s.count;
    }

    return res.json({
      byStatus: statusCounts,
      total: stats.total[0]?.n || 0,
      values: {
        totalPending: stats.totalPendingValue[0]?.sum || 0,
        totalConverted: stats.totalConvertedValue[0]?.sum || 0
      }
    });

  } catch (error) {
    return res.status(500).json({ message: 'Erro ao buscar estatísticas' });
  }
};
