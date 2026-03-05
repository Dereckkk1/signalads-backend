import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { ProductRequest, IProductRequestItem } from '../models/ProductRequest';
import { Product } from '../models/Product';
import { User } from '../models/User';

// ─────────────────────────────────────────────
// EMISSORA: Criar solicitação
// POST /api/product-requests
// ─────────────────────────────────────────────
export const createProductRequest = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const user = req.user;

    if (!user || user.userType !== 'broadcaster') {
      res.status(403).json({ error: 'Acesso restrito a emissoras' });
      return;
    }

    if (user.status !== 'approved') {
      res.status(403).json({ error: 'Emissora não está aprovada na plataforma' });
      return;
    }

    const { type, items, productId, editedFields } = req.body;

    if (!type || !['create', 'edit', 'delete'].includes(type)) {
      res.status(400).json({ error: 'Tipo de solicitação inválido. Use: create, edit ou delete' });
      return;
    }

    // Validações específicas por tipo
    if (type === 'create') {
      if (!items || !Array.isArray(items) || items.length === 0) {
        res.status(400).json({ error: 'Informe pelo menos um produto para criar' });
        return;
      }

      for (const item of items) {
        if (!item.spotType || !item.timeSlot || item.pricePerInsertion === undefined) {
          res.status(400).json({ error: 'Cada produto deve ter spotType, timeSlot e pricePerInsertion' });
          return;
        }
        if (item.pricePerInsertion <= 0) {
          res.status(400).json({ error: 'O preço por inserção deve ser maior que zero' });
          return;
        }
      }
    }

    if (type === 'edit' || type === 'delete') {
      if (!productId) {
        res.status(400).json({ error: 'Informe o productId para solicitações de edição ou exclusão' });
        return;
      }

      // Verificar se o produto pertence à emissora
      const product = await Product.findOne({ _id: productId, broadcasterId: user._id });
      if (!product) {
        res.status(404).json({ error: 'Produto não encontrado ou não pertence a esta emissora' });
        return;
      }

      if (type === 'edit' && (!editedFields || Object.keys(editedFields).length === 0)) {
        res.status(400).json({ error: 'Informe os campos alterados em editedFields' });
        return;
      }
    }

    // Verificar se já existe uma solicitação pendente para o mesmo produto
    if (type === 'edit' || type === 'delete') {
      const existing = await ProductRequest.findOne({
        broadcasterId: user._id,
        productId,
        status: 'pending'
      });

      if (existing) {
        res.status(409).json({ error: 'Já existe uma solicitação pendente para este produto' });
        return;
      }
    }

    const requestData: any = {
      broadcasterId: user._id,
      type,
      status: 'pending'
    };

    if (type === 'create') {
      requestData.items = items;
    } else {
      requestData.productId = productId;
      if (type === 'edit') requestData.editedFields = editedFields;
    }

    const request = new ProductRequest(requestData);
    await request.save();

    res.status(201).json({
      message: 'Solicitação enviada com sucesso! Aguarde a aprovação do administrador.',
      request
    });
  } catch (error) {
    console.error('Erro ao criar solicitação de produto:', error);
    res.status(500).json({ error: 'Erro interno ao criar solicitação' });
  }
};

// ─────────────────────────────────────────────
// EMISSORA: Listar minhas solicitações
// GET /api/product-requests/my-requests
// ─────────────────────────────────────────────
export const getMyRequests = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const user = req.user;

    if (!user || user.userType !== 'broadcaster') {
      res.status(403).json({ error: 'Acesso restrito a emissoras' });
      return;
    }

    const { status, type, page = 1, limit = 20 } = req.query;
    const skip = (Number(page) - 1) * Number(limit);

    const filter: any = { broadcasterId: user._id };
    if (status) filter.status = status;
    if (type) filter.type = type;

    const [requests, total] = await Promise.all([
      ProductRequest.find(filter)
        .populate('productId', 'spotType timeSlot pricePerInsertion broadcasterSharePercent platformSharePercent')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit)),
      ProductRequest.countDocuments(filter)
    ]);

    res.json({
      requests,
      pagination: {
        total,
        page: Number(page),
        limit: Number(limit),
        pages: Math.ceil(total / Number(limit))
      }
    });
  } catch (error) {
    console.error('Erro ao buscar solicitações:', error);
    res.status(500).json({ error: 'Erro interno ao buscar solicitações' });
  }
};

// ─────────────────────────────────────────────
// ADMIN: Listar todas as solicitações
// GET /api/product-requests
// ─────────────────────────────────────────────
export const getAllRequests = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const user = req.user;

    if (!user || user.userType !== 'admin') {
      res.status(403).json({ error: 'Acesso restrito ao administrador' });
      return;
    }

    const { status, type, broadcasterId, page = 1, limit = 20 } = req.query;
    const skip = (Number(page) - 1) * Number(limit);

    const filter: any = {};
    if (status) filter.status = status;
    if (type) filter.type = type;
    if (broadcasterId) filter.broadcasterId = broadcasterId;

    const [requests, total] = await Promise.all([
      ProductRequest.find(filter)
        .populate('broadcasterId', 'companyName fantasyName email broadcasterProfile')
        .populate('productId', 'spotType timeSlot pricePerInsertion broadcasterSharePercent platformSharePercent isActive')
        .populate('reviewedBy', 'companyName email')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit)),
      ProductRequest.countDocuments(filter)
    ]);

    res.json({
      requests,
      pagination: {
        total,
        page: Number(page),
        limit: Number(limit),
        pages: Math.ceil(total / Number(limit))
      }
    });
  } catch (error) {
    console.error('Erro ao buscar solicitações:', error);
    res.status(500).json({ error: 'Erro interno ao buscar solicitações' });
  }
};

// ─────────────────────────────────────────────
// ADMIN: Listar solicitações pendentes
// GET /api/product-requests/pending
// ─────────────────────────────────────────────
export const getPendingRequests = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const user = req.user;

    if (!user || user.userType !== 'admin') {
      res.status(403).json({ error: 'Acesso restrito ao administrador' });
      return;
    }

    const { type } = req.query;
    const filter: any = { status: 'pending' };
    if (type) filter.type = type;

    const requests = await ProductRequest.find(filter)
      .populate('broadcasterId', 'companyName fantasyName email broadcasterProfile')
      .populate('productId', 'spotType timeSlot pricePerInsertion broadcasterSharePercent platformSharePercent isActive')
      .sort({ createdAt: -1 });

    res.json({ requests, total: requests.length });
  } catch (error) {
    console.error('Erro ao buscar solicitações pendentes:', error);
    res.status(500).json({ error: 'Erro interno ao buscar solicitações pendentes' });
  }
};

// ─────────────────────────────────────────────
// ADMIN: Aprovar solicitação
// POST /api/product-requests/:id/approve
// ─────────────────────────────────────────────
export const approveRequest = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const user = req.user;

    if (!user || user.userType !== 'admin') {
      res.status(403).json({ error: 'Acesso restrito ao administrador' });
      return;
    }

    const { id } = req.params;
    const { adminNotes, adminEditMessage, items: adminItems } = req.body;

    const request = await ProductRequest.findById(id);
    if (!request) {
      res.status(404).json({ error: 'Solicitação não encontrada' });
      return;
    }

    if (request.status !== 'pending') {
      res.status(400).json({ error: 'Esta solicitação já foi processada' });
      return;
    }

    // Detectar se o admin editou algum valor
    let adminEdited = false;

    if (request.type === 'create') {
      // Criar os produtos no banco
      const productsToCreate: any[] = [];

      // Verificar se admin editou algum item
      if (adminItems) {
        for (let i = 0; i < Math.min(adminItems.length, request.items.length); i++) {
          const adm = adminItems[i];
          if (
            adm.adminPrice !== undefined ||
            adm.broadcasterShare !== undefined ||
            adm.platformShare !== undefined
          ) {
            adminEdited = true;
          }
        }
      }

      // Criar produtos usando items originais + dados do admin
      for (let idx = 0; idx < request.items.length; idx++) {
        const origItem = request.items[idx];
        if (!origItem) continue;

        const adminItem = adminItems?.[idx];

        const finalPrice = adminItem?.adminPrice ?? origItem.pricePerInsertion;
        const bShare = adminItem?.broadcasterShare ?? 80;
        const pShare = adminItem?.platformShare ?? 20;

        // Extrair duração do spotType
        const match = origItem.spotType.match(/(\d+)s/);
        const duration = match?.[1] ? parseInt(match[1], 10) : 30;

        productsToCreate.push({
          broadcasterId: request.broadcasterId,
          spotType: origItem.spotType,
          timeSlot: origItem.timeSlot,
          duration,
          pricePerInsertion: finalPrice,
          broadcasterSharePercent: bShare,
          platformSharePercent: pShare,
          isActive: true,
          manuallyEdited: adminEdited
        });
      }

      await Product.insertMany(productsToCreate);

    } else if (request.type === 'edit' && request.productId) {
      // Editar produto existente
      const product = await Product.findById(request.productId);
      if (!product) {
        res.status(404).json({ error: 'Produto original não encontrado' });
        return;
      }

      const fields = request.editedFields || {};
      const adminField = adminItems?.[0]; // Para edição, vem como array com 1 item

      if (adminField) {
        if (adminField.adminPrice !== undefined) {
          adminEdited = true;
          fields.adminPrice = adminField.adminPrice;
        }
        if (adminField.broadcasterShare !== undefined) fields.broadcasterShare = adminField.broadcasterShare;
        if (adminField.platformShare !== undefined) fields.platformShare = adminField.platformShare;
      }

      const updateData: any = {};
      if (fields.spotType) updateData.spotType = fields.spotType;
      if (fields.timeSlot) updateData.timeSlot = fields.timeSlot;
      if (fields.pricePerInsertion !== undefined) updateData.pricePerInsertion = fields.adminPrice ?? fields.pricePerInsertion;
      if (fields.broadcasterShare !== undefined) updateData.broadcasterSharePercent = fields.broadcasterShare;
      if (fields.platformShare !== undefined) updateData.platformSharePercent = fields.platformShare;
      updateData.manuallyEdited = true;

      await Product.findByIdAndUpdate(request.productId, updateData);

    } else if (request.type === 'delete' && request.productId) {
      // Excluir (desativar) produto
      await Product.findByIdAndUpdate(request.productId, { isActive: false });
    }

    // Atualizar a solicitação
    request.status = 'approved';
    request.reviewedBy = user._id;
    request.reviewedAt = new Date();
    request.adminEdited = adminEdited;
    if (adminNotes) request.adminNotes = adminNotes;
    if (adminEditMessage) request.adminEditMessage = adminEditMessage;

    await request.save();

    res.json({
      message: 'Solicitação aprovada com sucesso',
      request
    });
  } catch (error) {
    console.error('Erro ao aprovar solicitação:', error);
    res.status(500).json({ error: 'Erro interno ao aprovar solicitação' });
  }
};

// ─────────────────────────────────────────────
// ADMIN: Recusar solicitação
// POST /api/product-requests/:id/reject
// ─────────────────────────────────────────────
export const rejectRequest = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const user = req.user;

    if (!user || user.userType !== 'admin') {
      res.status(403).json({ error: 'Acesso restrito ao administrador' });
      return;
    }

    const { id } = req.params;
    const { rejectionReason } = req.body;

    if (!rejectionReason || rejectionReason.trim().length < 10) {
      res.status(400).json({ error: 'Informe um motivo de recusa com pelo menos 10 caracteres' });
      return;
    }

    const request = await ProductRequest.findById(id);
    if (!request) {
      res.status(404).json({ error: 'Solicitação não encontrada' });
      return;
    }

    if (request.status !== 'pending') {
      res.status(400).json({ error: 'Esta solicitação já foi processada' });
      return;
    }

    request.status = 'rejected';
    request.rejectionReason = rejectionReason.trim();
    request.reviewedBy = user._id;
    request.reviewedAt = new Date();

    await request.save();

    res.json({
      message: 'Solicitação recusada',
      request
    });
  } catch (error) {
    console.error('Erro ao recusar solicitação:', error);
    res.status(500).json({ error: 'Erro interno ao recusar solicitação' });
  }
};
// ─────────────────────────────────────────────
// ADMIN: Contar solicitações pendentes
// GET /api/product-requests/count-pending
// ─────────────────────────────────────────────
export const countPendingRequests = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const user = req.user;
    if (!user || user.userType !== 'admin') {
      res.status(403).json({ error: 'Acesso negado' });
      return;
    }

    const count = await ProductRequest.countDocuments({ status: 'pending' });
    res.json({ count });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao contar solicitações' });
  }
};
