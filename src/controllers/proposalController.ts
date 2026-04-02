import { Request, Response } from 'express';
import mongoose from 'mongoose';
import { AuthRequest } from '../middleware/auth';
import Proposal from '../models/Proposal';
import ProposalTemplate from '../models/ProposalTemplate';
import ProposalVersion from '../models/ProposalVersion';
import { Product } from '../models/Product';
import Order from '../models/Order';
import { cacheGet, cacheSet, cacheInvalidate } from '../config/redis';
import { sendOrderReceivedToClient, sendNewOrderToAdmin } from '../services/emailService';
import ExcelJS from 'exceljs';
import { uploadFile } from '../config/storage';
import crypto from 'crypto';

// ─── Helpers ──────────────────────────────────────────────────────────────

function generateId(length = 8): string {
  return crypto.randomBytes(length).toString('base64url').substring(0, length);
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .substring(0, 50);
}

function requireAgency(req: AuthRequest, res: Response): boolean {
  if (req.user?.userType !== 'agency') {
    res.status(403).json({ error: 'Acesso restrito a agências' });
    return false;
  }
  return true;
}

async function invalidateProposalCache(agencyId: string, slug?: string): Promise<void> {
  await cacheInvalidate(`proposals:agency:${agencyId}*`);
  if (slug) {
    await cacheInvalidate(`proposal:public:${slug}`);
  }
}

/** Calcula o valor do desconto global */
function calculateDiscount(grossAmount: number, discount?: { type: string; value: number }): number {
  if (!discount || !discount.value || discount.value <= 0) return 0;
  if (discount.type === 'percentage') {
    return parseFloat((grossAmount * (Math.min(discount.value, 100) / 100)).toFixed(2));
  }
  // fixed
  return parseFloat(Math.min(discount.value, grossAmount).toFixed(2));
}

/** Cria snapshot de versão (limita a 20 por proposta) */
async function createVersion(proposalId: string, userId: string, changeType: 'manual' | 'auto_send' | 'auto_update', proposal: any, changeNote?: string): Promise<void> {
  try {
    const lastVersion = await ProposalVersion.findOne({ proposalId }).sort({ version: -1 }).lean();
    const version = (lastVersion?.version || 0) + 1;

    await ProposalVersion.create({
      proposalId,
      version,
      snapshot: {
        title: proposal.title,
        items: proposal.items,
        grossAmount: proposal.grossAmount,
        techFee: proposal.techFee || 0,
        productionCost: proposal.productionCost || 0,
        agencyCommission: proposal.agencyCommission,
        agencyCommissionAmount: proposal.agencyCommissionAmount,
        monitoringCost: proposal.monitoringCost,
        discount: proposal.discount,
        discountAmount: proposal.discountAmount || 0,
        totalAmount: proposal.totalAmount,
        customization: proposal.customization
      },
      changedBy: userId,
      changeType,
      changeNote
    });

    // Limitar a 20 versões
    const count = await ProposalVersion.countDocuments({ proposalId });
    if (count > 20) {
      const oldest = await ProposalVersion.find({ proposalId }).sort({ createdAt: 1 }).limit(count - 20);
      const idsToDelete = oldest.map(v => v._id);
      await ProposalVersion.deleteMany({ _id: { $in: idsToDelete } });
    }
  } catch (err) {
    console.error('Erro ao criar versão:', err);
  }
}

// ─── CRUD de Propostas ────────────────────────────────────────────────────

/**
 * POST /api/proposals
 * Cria proposta a partir dos dados do marketplace (snapshot).
 */
export const createProposal = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!requireAgency(req, res)) return;

    const { items, clientId: rawClientId, agencyClientId, clientName, title, description, templateId, agencyCommission, isMonitoringEnabled, discount: discountInput } = req.body;
    const clientId = rawClientId || agencyClientId;

    if (!items || !Array.isArray(items) || items.length === 0) {
      res.status(400).json({ error: 'Itens da proposta são obrigatórios' });
      return;
    }

    // Separar itens do marketplace e itens customizados
    const marketplaceItems = items.filter((i: any) => !i.isCustom && i.productId);
    const customItems = items.filter((i: any) => i.isCustom);

    // Validar precos dos itens do marketplace contra o banco
    const productIds = marketplaceItems.map((item: any) => item.productId);
    const products = productIds.length > 0
      ? await Product.find({ _id: { $in: productIds } }).populate('broadcasterId')
      : [];
    const productMap = new Map(products.map(p => [p._id.toString(), p]));

    const proposalItems: any[] = [];
    let productsTotal = 0;

    // Processar itens do marketplace
    for (const item of marketplaceItems) {
      const product = productMap.get(item.productId?.toString());
      if (!product) {
        res.status(400).json({ error: `Produto ${item.productId} não encontrado` });
        return;
      }

      const unitPrice = (product as any).pricePerInsertion;
      const netPrice = (product as any).netPrice || 0;
      const effectivePrice = item.adjustedPrice || unitPrice;
      const totalPrice = parseFloat((effectivePrice * item.quantity).toFixed(2));
      productsTotal += totalPrice;

      const broadcaster: any = product.broadcasterId;

      // Converter schedule
      const scheduleObj: Record<string, number> = {};
      if (item.schedule) {
        if (item.schedule instanceof Map) {
          item.schedule.forEach((val: number, key: string) => { scheduleObj[key] = val; });
        } else {
          Object.assign(scheduleObj, item.schedule);
        }
      }

      // Extrair dados geograficos da emissora (snapshot para mapa)
      const bProfile = broadcaster?.broadcasterProfile;
      const bAddress = broadcaster?.address;

      proposalItems.push({
        productId: product._id.toString(),
        productName: (product as any).spotType || item.productName,
        productType: (product as any).spotType || '',
        duration: (product as any).duration || 0,
        broadcasterId: (item.broadcasterId || broadcaster?._id)?.toString(),
        broadcasterName: broadcaster?.companyName || broadcaster?.fantasyName || item.broadcasterName,
        city: bAddress?.city || item.city || '',
        state: bAddress?.state || item.state || '',
        quantity: item.quantity,
        unitPrice,
        netPrice,
        totalPrice,
        adjustedPrice: item.adjustedPrice || undefined,
        discountReason: item.discountReason || undefined,
        needsRecording: !!item.needsRecording,
        isCustom: false,
        schedule: scheduleObj,
        // Geo snapshot para mapa/tabela na proposta
        lat: bAddress?.latitude || undefined,
        lng: bAddress?.longitude || undefined,
        antennaClass: bProfile?.generalInfo?.antennaClass || undefined,
        broadcasterLogo: bProfile?.logo || undefined,
        dial: bProfile?.generalInfo?.dialFrequency || undefined,
        band: bProfile?.generalInfo?.band || undefined,
        population: bProfile?.coverage?.totalPopulation || undefined,
        pmm: bProfile?.pmm || undefined,
      });
    }

    // Processar itens customizados (sem vinculo com Product)
    for (const item of customItems) {
      const unitPrice = item.unitPrice || 0;
      const totalPrice = parseFloat((unitPrice * (item.quantity || 1)).toFixed(2));
      productsTotal += totalPrice;

      proposalItems.push({
        productName: item.productName || 'Item Personalizado',
        productType: item.productType || 'custom',
        duration: 0,
        quantity: item.quantity || 1,
        unitPrice,
        netPrice: 0,
        totalPrice,
        isCustom: true,
        customDescription: item.customDescription || undefined,
      });
    }

    // Calcular custo de produção (R$50 por item que precisa de gravação)
    const recordingItems = proposalItems.filter((i: any) => i.needsRecording && !i.isCustom && !i.productName?.toLowerCase().startsWith('testemunhal'));
    const productionCost = recordingItems.length * 50;

    // Calcular financeiro (snapshot)
    const grossAmount = parseFloat((productsTotal + productionCost).toFixed(2));
    const agencyCommPct = agencyCommission || 0;
    const agencyCommissionAmount = agencyCommPct
      ? parseFloat((grossAmount * (agencyCommPct / 100)).toFixed(2))
      : 0;

    let monitoringCost = 0;
    if (isMonitoringEnabled) {
      const monitorableBroadcasters = new Set<string>();
      proposalItems.forEach((item: any) => {
        if (!item.isCustom && !item.productName?.toLowerCase().startsWith('testemunhal') && item.broadcasterId) {
          monitorableBroadcasters.add(item.broadcasterId);
        }
      });
      monitoringCost = monitorableBroadcasters.size * 70;
    }

    // Taxa técnica (5% do grossAmount, que já inclui produção)
    const techFee = parseFloat((grossAmount * 0.05).toFixed(2));

    // Calcular desconto global
    const discountAmount = calculateDiscount(grossAmount, discountInput);
    const discount = discountInput?.value > 0 ? { type: discountInput.type, value: discountInput.value, reason: discountInput.reason } : undefined;

    const totalAmount = parseFloat((grossAmount + techFee - discountAmount + agencyCommissionAmount + monitoringCost).toFixed(2));

    // Gerar slug unico
    const slugBase = slugify(title || 'proposta-comercial');
    const slug = `${slugBase}-${generateId(8)}`;

    // Se template foi selecionado, copiar customization
    let customization: any = undefined;
    if (templateId) {
      const template = await ProposalTemplate.findById(templateId);
      if (template) {
        customization = template.customization;
      }
    }

    const proposal = new Proposal({
      agencyId: req.userId,
      clientId: clientId || undefined,
      clientName: clientName || undefined,
      title: title || 'Proposta Comercial',
      description: description || undefined,
      slug,
      items: proposalItems,
      grossAmount,
      techFee,
      productionCost,
      agencyCommission: agencyCommPct,
      agencyCommissionAmount,
      monitoringCost,
      discount,
      discountAmount,
      totalAmount,
      templateId: templateId || undefined,
      ...(customization && { customization }),
      status: 'draft'
    });

    await proposal.save();
    await invalidateProposalCache(req.userId!);

    // Criar versão inicial
    await createVersion(proposal._id.toString(), req.userId!, 'manual', proposal, 'Versão inicial');

    res.status(201).json({ proposal });
  } catch (error) {
    console.error('Erro ao criar proposta:', error);
    res.status(500).json({ error: 'Erro ao criar proposta' });
  }
};

/**
 * GET /api/proposals
 * Lista propostas da agencia autenticada.
 */
export const getProposals = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!requireAgency(req, res)) return;

    const { status, search, page = '1', limit = '20' } = req.query;
    const pageNum = Math.max(1, parseInt(page as string));
    const limitNum = Math.min(50, Math.max(1, parseInt(limit as string)));

    const filter: any = { agencyId: req.userId };
    if (status && status !== 'all') {
      filter.status = status;
    }
    if (search) {
      filter.$or = [
        { title: { $regex: search, $options: 'i' } },
        { clientName: { $regex: search, $options: 'i' } },
        { proposalNumber: { $regex: search, $options: 'i' } }
      ];
    }

    const [proposals, total] = await Promise.all([
      Proposal.find(filter)
        .populate('clientId', 'name documentNumber')
        .sort({ createdAt: -1 })
        .skip((pageNum - 1) * limitNum)
        .limit(limitNum)
        .lean(),
      Proposal.countDocuments(filter)
    ]);

    res.json({
      proposals,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        pages: Math.ceil(total / limitNum)
      }
    });
  } catch (error) {
    console.error('Erro ao listar propostas:', error);
    res.status(500).json({ error: 'Erro ao listar propostas' });
  }
};

/**
 * GET /api/proposals/:id
 * Detalhe de uma proposta (apenas owner).
 */
export const getProposal = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!requireAgency(req, res)) return;

    const proposal = await Proposal.findOne({
      _id: req.params.id,
      agencyId: req.userId
    }).populate('clientId', 'name documentNumber email phone');

    if (!proposal) {
      res.status(404).json({ error: 'Proposta não encontrada' });
      return;
    }

    res.json({ proposal });
  } catch (error) {
    console.error('Erro ao buscar proposta:', error);
    res.status(500).json({ error: 'Erro ao buscar proposta' });
  }
};

/**
 * PUT /api/proposals/:id
 * Edita proposta (items, dados gerais, customizacao).
 */
export const updateProposal = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!requireAgency(req, res)) return;

    const proposal = await Proposal.findOne({
      _id: req.params.id,
      agencyId: req.userId
    });

    if (!proposal) {
      res.status(404).json({ error: 'Proposta não encontrada' });
      return;
    }

    const { title, description, clientId: rawClientId, agencyClientId, clientName, items, customization, validUntil, agencyCommission, isMonitoringEnabled, discount: discountInput } = req.body;
    const clientId = rawClientId || agencyClientId;

    // Atualizar campos basicos
    if (title !== undefined) proposal.title = title;
    if (description !== undefined) proposal.description = description;
    if (clientId !== undefined) proposal.clientId = clientId || undefined;
    if (clientName !== undefined) proposal.clientName = clientName;
    if (validUntil !== undefined) proposal.validUntil = validUntil ? new Date(validUntil) : undefined;

    // Atualizar customizacao
    if (customization) {
      proposal.customization = { ...proposal.customization, ...customization };
    }

    // Atualizar desconto global
    if (discountInput !== undefined) {
      if (discountInput && discountInput.value > 0) {
        proposal.discount = { type: discountInput.type, value: discountInput.value, reason: discountInput.reason };
      } else {
        proposal.discount = undefined;
      }
    }

    // Atualizar itens e recalcular financeiro
    if (items && Array.isArray(items) && items.length > 0) {
      proposal.items = items;

      let productsTotal = 0;
      items.forEach((item: any) => {
        const effectivePrice = item.adjustedPrice || item.unitPrice;
        productsTotal += item.totalPrice || (effectivePrice * item.quantity);
      });

      // Custo de produção
      const recordingItems = items.filter((i: any) => i.needsRecording && !i.isCustom && !i.productName?.toLowerCase().startsWith('testemunhal'));
      const prodCost = recordingItems.length * 50;

      const grossAmount = parseFloat((productsTotal + prodCost).toFixed(2));
      const commPct = agencyCommission !== undefined ? agencyCommission : proposal.agencyCommission;
      const commAmount = commPct ? parseFloat((grossAmount * (commPct / 100)).toFixed(2)) : 0;

      let monitoringCost = 0;
      if (isMonitoringEnabled) {
        const monitorable = new Set<string>();
        items.forEach((item: any) => {
          if (!item.isCustom && !item.productName?.toLowerCase().startsWith('testemunhal') && item.broadcasterId) {
            monitorable.add(item.broadcasterId);
          }
        });
        monitoringCost = monitorable.size * 70;
      }

      const techFee = parseFloat((grossAmount * 0.05).toFixed(2));
      const discountAmt = calculateDiscount(grossAmount, proposal.discount);

      proposal.grossAmount = grossAmount;
      proposal.techFee = techFee;
      proposal.productionCost = prodCost;
      proposal.agencyCommission = commPct;
      proposal.agencyCommissionAmount = commAmount;
      proposal.monitoringCost = monitoringCost;
      proposal.discountAmount = discountAmt;
      proposal.totalAmount = parseFloat((grossAmount + techFee - discountAmt + commAmount + monitoringCost).toFixed(2));
    } else if (agencyCommission !== undefined || discountInput !== undefined) {
      // Recalcular sem alterar items
      const commPct = agencyCommission !== undefined ? agencyCommission : proposal.agencyCommission;
      proposal.agencyCommission = commPct;
      proposal.agencyCommissionAmount = parseFloat((proposal.grossAmount * (commPct / 100)).toFixed(2));
      const techFee = parseFloat((proposal.grossAmount * 0.05).toFixed(2));
      proposal.techFee = techFee;
      const discountAmt = calculateDiscount(proposal.grossAmount, proposal.discount);
      proposal.discountAmount = discountAmt;
      proposal.totalAmount = parseFloat((proposal.grossAmount + techFee - discountAmt + proposal.agencyCommissionAmount + proposal.monitoringCost).toFixed(2));
    }

    await proposal.save();
    await invalidateProposalCache(req.userId!, proposal.slug);

    // Criar versão automática
    await createVersion(proposal._id.toString(), req.userId!, 'auto_update', proposal);

    res.json({ proposal });
  } catch (error) {
    console.error('Erro ao atualizar proposta:', error);
    res.status(500).json({ error: 'Erro ao atualizar proposta' });
  }
};

/**
 * PUT /api/proposals/:id/customization
 * Atualiza apenas a customizacao visual (autosave do editor).
 */
export const updateCustomization = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!requireAgency(req, res)) return;

    const { customization } = req.body;
    if (!customization) {
      res.status(400).json({ error: 'Dados de customização são obrigatórios' });
      return;
    }

    const proposal = await Proposal.findOneAndUpdate(
      { _id: req.params.id, agencyId: req.userId },
      { $set: { customization } },
      { new: true }
    );

    if (!proposal) {
      res.status(404).json({ error: 'Proposta não encontrada' });
      return;
    }

    await invalidateProposalCache(req.userId!, proposal.slug);

    res.json({ proposal });
  } catch (error) {
    console.error('Erro ao atualizar customização:', error);
    res.status(500).json({ error: 'Erro ao atualizar customização' });
  }
};

/**
 * DELETE /api/proposals/:id
 * Exclui proposta permanentemente.
 */
export const deleteProposal = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!requireAgency(req, res)) return;

    const proposal = await Proposal.findOneAndDelete({
      _id: req.params.id,
      agencyId: req.userId
    });

    if (!proposal) {
      res.status(404).json({ error: 'Proposta não encontrada' });
      return;
    }

    await invalidateProposalCache(req.userId!, proposal.slug);

    res.json({ message: 'Proposta excluída com sucesso' });
  } catch (error) {
    console.error('Erro ao excluir proposta:', error);
    res.status(500).json({ error: 'Erro ao excluir proposta' });
  }
};

/**
 * POST /api/proposals/:id/duplicate
 * Duplica proposta existente como rascunho.
 */
export const duplicateProposal = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!requireAgency(req, res)) return;

    const original = await Proposal.findOne({
      _id: req.params.id,
      agencyId: req.userId
    }).lean();

    if (!original) {
      res.status(404).json({ error: 'Proposta não encontrada' });
      return;
    }

    const slugBase = slugify(`copia-${original.title}`);
    const slug = `${slugBase}-${generateId(8)}`;

    const duplicate = new Proposal({
      agencyId: original.agencyId,
      clientId: original.clientId,
      clientName: original.clientName,
      title: `Cópia de ${original.title}`,
      description: original.description,
      slug,
      items: original.items,
      grossAmount: original.grossAmount,
      techFee: original.techFee || parseFloat((original.grossAmount * 0.05).toFixed(2)),
      agencyCommission: original.agencyCommission,
      agencyCommissionAmount: original.agencyCommissionAmount,
      monitoringCost: original.monitoringCost,
      totalAmount: original.totalAmount,
      customization: original.customization,
      templateId: original.templateId,
      status: 'draft'
    });

    await duplicate.save();
    await invalidateProposalCache(req.userId!);

    res.status(201).json({ proposal: duplicate });
  } catch (error) {
    console.error('Erro ao duplicar proposta:', error);
    res.status(500).json({ error: 'Erro ao duplicar proposta' });
  }
};

/**
 * POST /api/proposals/:id/send
 * Marca proposta como enviada.
 */
export const sendProposal = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!requireAgency(req, res)) return;

    const proposal = await Proposal.findOne({
      _id: req.params.id,
      agencyId: req.userId
    });

    if (!proposal) {
      res.status(404).json({ error: 'Proposta não encontrada' });
      return;
    }

    if (proposal.status !== 'draft' && proposal.status !== 'sent') {
      res.status(400).json({ error: 'Apenas propostas em rascunho podem ser enviadas' });
      return;
    }

    proposal.status = 'sent';
    proposal.sentAt = new Date();
    await proposal.save();
    await invalidateProposalCache(req.userId!, proposal.slug);

    // Criar versão ao enviar
    await createVersion(proposal._id.toString(), req.userId!, 'auto_send', proposal, 'Proposta enviada');

    const publicUrl = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/p/${proposal.slug}`;

    res.json({ proposal, publicUrl });
  } catch (error) {
    console.error('Erro ao enviar proposta:', error);
    res.status(500).json({ error: 'Erro ao enviar proposta' });
  }
};

// ─── Upload de Imagens ────────────────────────────────────────────────────

/**
 * POST /api/proposals/:id/upload
 * Upload de logo ou cover image para a proposta.
 * Expects multipart/form-data com campo 'file' e query ?type=logo|cover
 */
export const uploadProposalImage = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!requireAgency(req, res)) return;

    const proposal = await Proposal.findOne({
      _id: req.params.id,
      agencyId: req.userId
    });

    if (!proposal) {
      res.status(404).json({ error: 'Proposta não encontrada' });
      return;
    }

    if (!req.file) {
      res.status(400).json({ error: 'Arquivo não enviado' });
      return;
    }

    const imageType = req.query.type as string;
    if (imageType !== 'logo' && imageType !== 'cover') {
      res.status(400).json({ error: 'Tipo deve ser "logo" ou "cover"' });
      return;
    }

    const url = await uploadFile(
      req.file.buffer,
      req.file.originalname,
      `proposals/${proposal._id}`,
      req.file.mimetype
    );

    if (imageType === 'logo') {
      proposal.customization.logo = url;
    } else {
      proposal.customization.coverImage = url;
    }

    await proposal.save();
    await invalidateProposalCache(req.userId!, proposal.slug);

    res.json({ url });
  } catch (error) {
    console.error('Erro ao fazer upload:', error);
    res.status(500).json({ error: 'Erro ao fazer upload da imagem' });
  }
};

// ─── Página Pública ───────────────────────────────────────────────────────

/**
 * GET /api/proposals/public/:slug
 * Retorna dados da proposta para a pagina publica (sem auth).
 */
export const getPublicProposal = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { slug } = req.params;

    // Cache de 5min para pagina publica
    const cacheKey = `proposal:public:${slug}`;
    const cached = await cacheGet<any>(cacheKey);
    if (cached) {
      res.json(cached);
      return;
    }

    const proposal = await Proposal.findOne({ slug })
      .populate('agencyId', 'companyName fantasyName name email phone')
      .populate('clientId', 'name')
      .lean();

    if (!proposal) {
      res.status(404).json({ error: 'Proposta não encontrada' });
      return;
    }

    if (proposal.status === 'expired') {
      res.status(410).json({ error: 'Esta proposta expirou', proposal: { title: proposal.title, status: 'expired' } });
      return;
    }

    // Verificar proteção por PIN
    if (proposal.protection?.enabled) {
      // Retornar indicação de proteção (sem dados da proposta)
      res.json({
        proposal: null,
        protected: true,
        proposalNumber: proposal.proposalNumber,
        title: proposal.title
      });
      return;
    }

    // Montar resposta publica (sem dados internos sensiveis)
    const publicData = {
      proposal: {
        proposalNumber: proposal.proposalNumber,
        title: proposal.title,
        description: proposal.description,
        items: proposal.items,
        grossAmount: proposal.grossAmount,
        techFee: proposal.techFee || 0,
        agencyCommission: proposal.agencyCommission,
        agencyCommissionAmount: proposal.agencyCommissionAmount,
        productionCost: proposal.productionCost || 0,
        monitoringCost: proposal.monitoringCost,
        discount: proposal.discount ? { type: proposal.discount.type, value: proposal.discount.value } : undefined,
        discountAmount: proposal.discountAmount || 0,
        totalAmount: proposal.totalAmount,
        customization: proposal.customization,
        status: proposal.status,
        validUntil: proposal.validUntil,
        respondedAt: proposal.respondedAt,
        responseNote: proposal.responseNote,
        createdAt: proposal.createdAt,
        agency: proposal.agencyId, // populated
        client: proposal.clientId, // populated (nome apenas)
        comments: proposal.comments || [],
        approval: proposal.approval ? { name: proposal.approval.name, approvedAt: proposal.approval.approvedAt } : undefined,
      }
    };

    await cacheSet(cacheKey, publicData, 300); // 5min

    res.json(publicData);
  } catch (error) {
    console.error('Erro ao buscar proposta pública:', error);
    res.status(500).json({ error: 'Erro ao buscar proposta' });
  }
};

/**
 * POST /api/proposals/public/:slug/view
 * Registra visualizacao da proposta (fire-and-forget no frontend).
 */
export const trackProposalView = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { slug } = req.params;

    const update: any = {
      $inc: { viewCount: 1 },
      $set: { lastViewedAt: new Date() }
    };

    // Marca como 'viewed' apenas na primeira visualizacao se status for 'sent'
    const proposal = await Proposal.findOne({ slug });
    if (proposal && proposal.status === 'sent') {
      update.$set.status = 'viewed';
      update.$set.viewedAt = new Date();

      // Notificar agência que proposta foi visualizada pela primeira vez
      try {
        const { User } = await import('../models/User');
        const agency = await User.findById(proposal.agencyId).lean();
        if ((agency as any)?.email) {
          const emailSvc = (await import('../services/emailService')).default;
          const html = emailSvc.createEmailTemplate({
            title: 'Proposta visualizada!',
            icon: '👀',
            content: `<p>O cliente abriu a proposta <strong>${proposal.proposalNumber}</strong> — "${proposal.title}".</p><p>Agora é um bom momento para acompanhar se há dúvidas ou negociações.</p>`,
            buttonText: 'Ver Proposta',
            buttonUrl: `${process.env.FRONTEND_URL || 'http://localhost:3000'}/proposals/${proposal._id}`,
          });
          emailSvc.sendEmail?.({ to: (agency as any).email, subject: `Proposta ${proposal.proposalNumber} foi visualizada`, html });
        }
      } catch { /* silent - email não deve bloquear tracking */ }
    }

    await Proposal.updateOne({ slug }, update);

    res.json({ ok: true });
  } catch (error) {
    // Nao quebrar a experiencia do cliente por erro de tracking
    res.json({ ok: true });
  }
};

/**
 * POST /api/proposals/public/:slug/respond
 * Cliente aprova ou recusa a proposta.
 */
export const respondToProposal = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { slug } = req.params;
    const { action, note, approvalName, approvalEmail } = req.body;

    if (action !== 'approve' && action !== 'reject') {
      res.status(400).json({ error: 'Ação deve ser "approve" ou "reject"' });
      return;
    }

    const proposal = await Proposal.findOne({ slug });
    if (!proposal) {
      res.status(404).json({ error: 'Proposta não encontrada' });
      return;
    }

    if (proposal.status === 'approved' || proposal.status === 'rejected') {
      res.status(400).json({ error: 'Esta proposta já foi respondida' });
      return;
    }

    if (proposal.status === 'expired') {
      res.status(410).json({ error: 'Esta proposta expirou' });
      return;
    }

    proposal.status = action === 'approve' ? 'approved' : 'rejected';
    proposal.respondedAt = new Date();
    proposal.responseNote = note || undefined;

    // Capturar dados de aprovação formal (assinatura digital)
    if (action === 'approve') {
      proposal.approval = {
        name: approvalName || undefined,
        email: approvalEmail || undefined,
        ip: (req as any).ip || (req as any).connection?.remoteAddress || undefined,
        userAgent: req.headers['user-agent'] || undefined,
        approvedAt: new Date()
      };
    }

    await proposal.save();
    await invalidateProposalCache(proposal.agencyId.toString(), slug);

    // Enviar email para agência notificando resposta
    try {
      const { User } = await import('../models/User');
      const agency = await User.findById(proposal.agencyId).lean();
      if (agency?.email) {
        const emailSvc = (await import('../services/emailService')).default;
        const statusText = action === 'approve' ? 'aprovada' : 'recusada';
        const html = emailSvc.createEmailTemplate({
          title: `Proposta ${statusText}!`,
          icon: action === 'approve' ? '✅' : '❌',
          content: `
            <p>O cliente <strong>${proposal.clientName || 'Anônimo'}</strong> <strong>${statusText}</strong> a proposta <strong>${proposal.proposalNumber}</strong> — "${proposal.title}".</p>
            ${note ? `<p><strong>Observação do cliente:</strong> ${note}</p>` : ''}
            <p>Valor total: <strong>R$ ${proposal.totalAmount.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</strong></p>
          `,
          buttonText: 'Ver Proposta',
          buttonUrl: `${process.env.FRONTEND_URL || 'http://localhost:3000'}/proposals/${proposal._id}`,
        });
        await emailSvc.sendEmail?.({ to: agency.email, subject: `Proposta ${proposal.proposalNumber} ${statusText}`, html })
          || console.log(`[DEV] Email de resposta: proposta ${statusText}`);
      }
    } catch (emailErr) {
      console.error('Erro ao enviar email de resposta:', emailErr);
    }

    res.json({ message: action === 'approve' ? 'Proposta aprovada com sucesso' : 'Proposta recusada', status: proposal.status });
  } catch (error) {
    console.error('Erro ao responder proposta:', error);
    res.status(500).json({ error: 'Erro ao responder proposta' });
  }
};

// ─── Templates ────────────────────────────────────────────────────────────

/**
 * GET /api/proposals/templates
 * Lista templates da agencia + templates padrao da plataforma.
 */
export const getTemplates = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!requireAgency(req, res)) return;

    const templates = await ProposalTemplate.find({
      $or: [
        { agencyId: req.userId },
        { isDefault: true }
      ]
    }).sort({ isDefault: -1, createdAt: -1 }).lean();

    res.json({ templates });
  } catch (error) {
    console.error('Erro ao listar templates:', error);
    res.status(500).json({ error: 'Erro ao listar templates' });
  }
};

/**
 * POST /api/proposals/templates
 * Cria template a partir da customizacao atual.
 */
export const createTemplate = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!requireAgency(req, res)) return;

    const { name, customization, category } = req.body;

    if (!name) {
      res.status(400).json({ error: 'Nome do template é obrigatório' });
      return;
    }

    if (!customization) {
      res.status(400).json({ error: 'Dados de customização são obrigatórios' });
      return;
    }

    const template = new ProposalTemplate({
      name,
      agencyId: req.userId,
      customization,
      ...(category && { category }),
    });

    await template.save();

    res.status(201).json({ template });
  } catch (error) {
    console.error('Erro ao criar template:', error);
    res.status(500).json({ error: 'Erro ao criar template' });
  }
};

/**
 * PUT /api/proposals/templates/:id
 * Edita template (apenas owner).
 */
export const updateTemplate = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!requireAgency(req, res)) return;

    const { name, customization, category } = req.body;

    const template = await ProposalTemplate.findOne({
      _id: req.params.id,
      agencyId: req.userId,
      isDefault: false // nao pode editar templates padrao
    });

    if (!template) {
      res.status(404).json({ error: 'Template não encontrado' });
      return;
    }

    if (name) template.name = name;
    if (customization) template.customization = customization;
    if (category !== undefined) template.category = category || null;

    await template.save();

    res.json({ template });
  } catch (error) {
    console.error('Erro ao atualizar template:', error);
    res.status(500).json({ error: 'Erro ao atualizar template' });
  }
};

/**
 * DELETE /api/proposals/templates/:id
 * Exclui template (apenas owner, nao padrao).
 */
export const deleteTemplate = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!requireAgency(req, res)) return;

    const template = await ProposalTemplate.findOneAndDelete({
      _id: req.params.id,
      agencyId: req.userId,
      isDefault: false
    });

    if (!template) {
      res.status(404).json({ error: 'Template não encontrado' });
      return;
    }

    res.json({ message: 'Template excluído com sucesso' });
  } catch (error) {
    console.error('Erro ao excluir template:', error);
    res.status(500).json({ error: 'Erro ao excluir template' });
  }
};

// ─── Conversão Proposta → Pedido ─────────────────────────────────────────

/**
 * POST /api/proposals/:id/convert
 * Converte proposta aprovada em pedido.
 */
export const convertToOrder = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!requireAgency(req, res)) return;

    const proposal = await Proposal.findOne({
      _id: req.params.id,
      agencyId: req.userId
    });

    if (!proposal) {
      res.status(404).json({ error: 'Proposta não encontrada' });
      return;
    }

    if (proposal.status !== 'approved') {
      res.status(400).json({ error: 'Apenas propostas aprovadas podem ser convertidas em pedido' });
      return;
    }

    if (proposal.convertedOrderId) {
      res.status(400).json({ error: 'Esta proposta já foi convertida em pedido' });
      return;
    }

    // Buscar dados do comprador (agência)
    const { User } = await import('../models/User');
    const buyer = await User.findById(req.userId).lean();
    if (!buyer) {
      res.status(404).json({ error: 'Usuário não encontrado' });
      return;
    }

    // Criar pedido a partir dos itens da proposta (apenas itens de marketplace)
    const orderItems = proposal.items
      .filter(item => !item.isCustom && item.productId && item.broadcasterId)
      .map(item => ({
        productId: item.productId,
        productName: item.productName,
        broadcasterName: item.broadcasterName,
        broadcasterId: item.broadcasterId,
        quantity: item.quantity,
        unitPrice: item.adjustedPrice || item.unitPrice,
        totalPrice: (item.adjustedPrice || item.unitPrice) * item.quantity,
        schedule: item.schedule || new Map(),
        material: { type: 'text' as const, text: '', status: 'pending_broadcaster_review' as const, chat: [] }
      }));

    if (orderItems.length === 0) {
      res.status(400).json({ error: 'Proposta não contém itens válidos para conversão' });
      return;
    }

    // Calcular valores financeiros
    const grossAmount = proposal.grossAmount;
    const broadcasterAmount = parseFloat((grossAmount * 0.75).toFixed(2));
    const platformSplit = parseFloat((grossAmount * 0.20).toFixed(2));
    const techFee = parseFloat((grossAmount * 0.05).toFixed(2));
    const agencyCommission = proposal.agencyCommissionAmount || 0;
    const monitoringCost = proposal.monitoringCost || 0;
    const totalAmount = parseFloat((grossAmount + techFee + agencyCommission + monitoringCost).toFixed(2));

    const order = new Order({
      buyerId: (buyer as any)._id,
      buyerName: (buyer as any).name || (buyer as any).companyName || (buyer as any).fantasyName || '',
      buyerEmail: (buyer as any).email,
      buyerPhone: (buyer as any).phone || '',
      buyerDocument: (buyer as any).cpfOrCnpj || (buyer as any).cpf || '',
      clientId: proposal.clientId,
      items: orderItems,
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
      isMonitoringEnabled: monitoringCost > 0,
      totalAmount,
      subtotal: grossAmount,
      platformFee: techFee,
      billingInvoices: [],
      billingDocuments: [],
      broadcasterInvoices: [],
      opecs: [],
      notifications: [],
      webhookLogs: []
    });

    await order.save();

    // Atualizar proposta
    proposal.status = 'converted';
    proposal.convertedOrderId = order._id;
    await proposal.save();
    await invalidateProposalCache(req.userId!, proposal.slug);

    // Enviar emails — fire-and-forget
    sendOrderReceivedToClient({
      orderNumber: order.orderNumber,
      buyerName: (buyer as any).name || '',
      buyerEmail: (buyer as any).email,
      items: orderItems.map(i => ({ productName: i.productName, broadcasterName: i.broadcasterName || '' })),
      totalValue: totalAmount
    }).catch(err => console.error('Email error (client):', err));

    User.find({ userType: 'admin' }).select('email').then(admins => {
      const adminEmails = admins.map(a => a.email);
      if (adminEmails.length > 0) {
        sendNewOrderToAdmin({
          orderNumber: order.orderNumber,
          buyerName: (buyer as any).name || '',
          buyerEmail: (buyer as any).email,
          buyerPhone: (buyer as any).phone || '',
          totalValue: totalAmount,
          itemsCount: orderItems.length,
          adminEmails,
          isMonitoringEnabled: monitoringCost > 0
        }).catch(err => console.error('Email error (admin):', err));
      }
    }).catch(err => console.error('Admin lookup error:', err));

    res.json({ order, proposal });
  } catch (error) {
    console.error('Erro ao converter proposta em pedido:', error);
    res.status(500).json({ error: 'Erro ao converter proposta em pedido' });
  }
};

// ─── Comentários ─────────────────────────────────────────────────────────

/**
 * POST /api/proposals/:id/comments
 * Adiciona comentário a uma seção (agency).
 */
export const addComment = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!requireAgency(req, res)) return;

    const { sectionId, text } = req.body;
    if (!sectionId || !text) {
      res.status(400).json({ error: 'Seção e texto são obrigatórios' });
      return;
    }

    const proposal = await Proposal.findOne({
      _id: req.params.id,
      agencyId: req.userId
    });

    if (!proposal) {
      res.status(404).json({ error: 'Proposta não encontrada' });
      return;
    }

    const { User } = await import('../models/User');
    const user = await User.findById(req.userId).lean();

    proposal.comments.push({
      sectionId,
      author: (user as any)?.companyName || (user as any)?.fantasyName || 'Agência',
      authorEmail: (user as any)?.email,
      authorType: 'agency',
      text,
      createdAt: new Date()
    });

    await proposal.save();
    await invalidateProposalCache(req.userId!, proposal.slug);

    res.json({ comments: proposal.comments });
  } catch (error) {
    console.error('Erro ao adicionar comentário:', error);
    res.status(500).json({ error: 'Erro ao adicionar comentário' });
  }
};

/**
 * POST /api/proposals/public/:slug/comments
 * Adiciona comentário do cliente (público).
 */
export const addPublicComment = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { slug } = req.params;
    const { sectionId, text, author, authorEmail } = req.body;

    if (!sectionId || !text || !author) {
      res.status(400).json({ error: 'Seção, texto e nome são obrigatórios' });
      return;
    }

    const proposal = await Proposal.findOne({ slug });
    if (!proposal) {
      res.status(404).json({ error: 'Proposta não encontrada' });
      return;
    }

    proposal.comments.push({
      sectionId,
      author,
      authorEmail: authorEmail || undefined,
      authorType: 'client',
      text,
      createdAt: new Date()
    });

    await proposal.save();
    await invalidateProposalCache(proposal.agencyId.toString(), slug);

    // Notificar agência sobre novo comentário
    try {
      const { User } = await import('../models/User');
      const agency = await User.findById(proposal.agencyId).lean();
      if ((agency as any)?.email) {
        const emailSvc = (await import('../services/emailService')).default;
        const html = emailSvc.createEmailTemplate({
          title: 'Novo comentário na proposta',
          icon: '💬',
          content: `<p><strong>${author}</strong> comentou na proposta <strong>${proposal.proposalNumber}</strong>:</p><blockquote>${text}</blockquote>`,
          buttonText: 'Ver Proposta',
          buttonUrl: `${process.env.FRONTEND_URL || 'http://localhost:3000'}/proposals/${proposal._id}`,
        });
        emailSvc.sendEmail?.({ to: (agency as any).email, subject: `Novo comentário — ${proposal.proposalNumber}`, html });
      }
    } catch { /* silent */ }

    res.json({ comments: proposal.comments });
  } catch (error) {
    console.error('Erro ao adicionar comentário público:', error);
    res.status(500).json({ error: 'Erro ao adicionar comentário' });
  }
};

// ─── Versionamento ───────────────────────────────────────────────────────

/**
 * GET /api/proposals/:id/versions
 * Lista versões de uma proposta.
 */
export const getVersions = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!requireAgency(req, res)) return;

    const proposal = await Proposal.findOne({ _id: req.params.id, agencyId: req.userId });
    if (!proposal) {
      res.status(404).json({ error: 'Proposta não encontrada' });
      return;
    }

    const versions = await ProposalVersion.find({ proposalId: req.params.id })
      .sort({ version: -1 })
      .lean();

    res.json({ versions });
  } catch (error) {
    console.error('Erro ao listar versões:', error);
    res.status(500).json({ error: 'Erro ao listar versões' });
  }
};

/**
 * POST /api/proposals/:id/versions/:versionId/restore
 * Restaura uma versão anterior.
 */
export const restoreVersion = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!requireAgency(req, res)) return;

    const proposal = await Proposal.findOne({ _id: req.params.id, agencyId: req.userId });
    if (!proposal) {
      res.status(404).json({ error: 'Proposta não encontrada' });
      return;
    }

    const version = await ProposalVersion.findOne({ _id: req.params.versionId, proposalId: req.params.id });
    if (!version) {
      res.status(404).json({ error: 'Versão não encontrada' });
      return;
    }

    // Salvar versão atual antes de restaurar
    await createVersion(proposal._id.toString(), req.userId!, 'manual', proposal, 'Antes de restaurar');

    // Aplicar snapshot
    const snap = version.snapshot;
    proposal.title = snap.title;
    proposal.items = snap.items;
    proposal.grossAmount = snap.grossAmount;
    proposal.techFee = snap.techFee || parseFloat((snap.grossAmount * 0.05).toFixed(2));
    proposal.agencyCommission = snap.agencyCommission;
    proposal.agencyCommissionAmount = snap.agencyCommissionAmount;
    proposal.monitoringCost = snap.monitoringCost;
    proposal.discount = snap.discount as any;
    proposal.discountAmount = snap.discountAmount || 0;
    proposal.totalAmount = snap.totalAmount;
    proposal.customization = snap.customization;

    await proposal.save();
    await invalidateProposalCache(req.userId!, proposal.slug);

    res.json({ proposal });
  } catch (error) {
    console.error('Erro ao restaurar versão:', error);
    res.status(500).json({ error: 'Erro ao restaurar versão' });
  }
};

// ─── Analytics ───────────────────────────────────────────────────────────

/**
 * GET /api/proposals/analytics
 * Dashboard de analytics de propostas da agência.
 */
export const getAnalytics = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!requireAgency(req, res)) return;

    const agencyId = req.userId;
    const agencyOid = new mongoose.Types.ObjectId(agencyId);
    const { period = '30' } = req.query; // dias
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - parseInt(period as string));

    const [
      totalCount,
      statusCounts,
      recentProposals,
      approvedAgg,
      rejectedAgg,
      totalValueAgg,
      avgResponseTime
    ] = await Promise.all([
      Proposal.countDocuments({ agencyId }),
      Proposal.aggregate([
        { $match: { agencyId: agencyOid, createdAt: { $gte: startDate } } },
        { $group: { _id: '$status', count: { $sum: 1 }, value: { $sum: '$totalAmount' } } }
      ]),
      Proposal.find({ agencyId, createdAt: { $gte: startDate } })
        .select('status totalAmount createdAt sentAt viewedAt respondedAt')
        .sort({ createdAt: -1 })
        .limit(50)
        .lean(),
      Proposal.aggregate([
        { $match: { agencyId: agencyOid, status: { $in: ['approved', 'converted'] } } },
        { $group: { _id: null, total: { $sum: '$totalAmount' }, count: { $sum: 1 } } }
      ]),
      Proposal.aggregate([
        { $match: { agencyId: agencyOid, status: { $in: ['rejected', 'expired'] } } },
        { $group: { _id: null, total: { $sum: '$totalAmount' } } }
      ]),
      Proposal.aggregate([
        { $match: { agencyId: agencyOid, createdAt: { $gte: startDate } } },
        { $group: { _id: null, total: { $sum: '$totalAmount' } } }
      ]),
      Proposal.aggregate([
        { $match: { agencyId: agencyOid, respondedAt: { $exists: true }, sentAt: { $exists: true } } },
        { $project: { responseTime: { $subtract: ['$respondedAt', '$sentAt'] } } },
        { $group: { _id: null, avg: { $avg: '$responseTime' } } }
      ])
    ]);

    // byStatus (objeto { draft: N, sent: N, ... })
    const byStatus: Record<string, number> = {};
    statusCounts.forEach((s: any) => { byStatus[s._id] = s.count; });

    // Contagem de ciclo de vida (propostas que passaram por cada etapa)
    const lifecycleSent = (byStatus.sent || 0) + (byStatus.viewed || 0) + (byStatus.approved || 0) + (byStatus.rejected || 0) + (byStatus.expired || 0) + (byStatus.converted || 0);
    const lifecycleApproved = (byStatus.approved || 0) + (byStatus.converted || 0);

    // Funnel
    const viewedCount = (byStatus.viewed || 0) + (byStatus.approved || 0) + (byStatus.rejected || 0) + (byStatus.converted || 0);
    const respondedCount = (byStatus.approved || 0) + (byStatus.rejected || 0) + (byStatus.converted || 0);

    const approvedStats = approvedAgg[0] || { total: 0, count: 0 };
    const rejectedTotal = rejectedAgg[0]?.total || 0;
    const totalValue = totalValueAgg[0]?.total || 0;
    const avgResponse = avgResponseTime[0]?.avg || 0;

    const conversionRate = lifecycleSent > 0
      ? parseFloat((lifecycleApproved / lifecycleSent * 100).toFixed(1))
      : 0;

    res.json({
      analytics: {
        total: totalCount,
        period: parseInt(period as string),
        byStatus,
        // Contagem de ciclo de vida para o hero card
        lifecycle: {
          sent: lifecycleSent,
          approved: lifecycleApproved,
          rejected: byStatus.rejected || 0
        },
        funnel: {
          sent: lifecycleSent,
          viewed: viewedCount,
          responded: respondedCount
        },
        totalValue,
        approvedValue: approvedStats.total,
        rejectedValue: rejectedTotal,
        approvedCount: approvedStats.count,
        avgResponseTime: avgResponse > 0 ? Math.round(avgResponse / (1000 * 60 * 60)) : 0,
        conversionRate,
        recentActivity: recentProposals
      }
    });
  } catch (error) {
    console.error('Erro ao buscar analytics:', error);
    res.status(500).json({ error: 'Erro ao buscar analytics' });
  }
};

// ─── Tracking de Sessão ──────────────────────────────────────────────────

/**
 * POST /api/proposals/public/:slug/session
 * Registra sessão de visualização (duração, scroll depth).
 */
export const trackViewSession = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { slug } = req.params;
    const { duration, scrollDepth } = req.body;

    if (!duration || duration <= 0) {
      res.json({ ok: true });
      return;
    }

    await Proposal.updateOne(
      { slug },
      {
        $push: {
          viewSessions: {
            $each: [{ startedAt: new Date(), duration: Math.min(duration, 3600), scrollDepth: Math.min(scrollDepth || 0, 100) }],
            $slice: -100 // Máximo 100 sessões
          }
        }
      }
    );

    res.json({ ok: true });
  } catch {
    res.json({ ok: true }); // Fire-and-forget
  }
};

// ─── Proteção por PIN ────────────────────────────────────────────────────

/**
 * POST /api/proposals/:id/protection
 * Ativa ou desativa proteção por PIN.
 */
export const setProtection = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!requireAgency(req, res)) return;

    const { enabled, email } = req.body;

    const proposal = await Proposal.findOne({ _id: req.params.id, agencyId: req.userId });
    if (!proposal) {
      res.status(404).json({ error: 'Proposta não encontrada' });
      return;
    }

    if (enabled) {
      const pin = String(Math.floor(100000 + Math.random() * 900000)); // 6 dígitos
      proposal.protection = {
        enabled: true,
        pin,
        email: email || undefined,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) // 24h
      };

      // Enviar PIN por email se email fornecido
      if (email) {
        try {
          const emailSvc = (await import('../services/emailService')).default;
          const html = emailSvc.createEmailTemplate({
            title: 'Código de Acesso à Proposta',
            icon: '🔒',
            content: `<p>Use o código abaixo para acessar a proposta <strong>${proposal.proposalNumber}</strong>:</p><div style="text-align:center;padding:20px;font-size:32px;letter-spacing:8px;font-weight:700;color:#1a1a2e;">${pin}</div><p>Este código expira em 24 horas.</p>`,
          });
          emailSvc.sendEmail?.({ to: email, subject: `Código de acesso — ${proposal.proposalNumber}`, html });
        } catch { /* silent */ }
      }
    } else {
      proposal.protection = { enabled: false };
    }

    await proposal.save();
    res.json({ protection: { enabled: proposal.protection.enabled, email: proposal.protection.email } });
  } catch (error) {
    console.error('Erro ao configurar proteção:', error);
    res.status(500).json({ error: 'Erro ao configurar proteção' });
  }
};

/**
 * POST /api/proposals/public/:slug/verify-pin
 * Verifica PIN para acessar proposta protegida.
 */
export const verifyPin = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { slug } = req.params;
    const { pin } = req.body;

    const proposal = await Proposal.findOne({ slug }).select('protection').lean();
    if (!proposal) {
      res.status(404).json({ error: 'Proposta não encontrada' });
      return;
    }

    if (!proposal.protection?.enabled) {
      res.json({ verified: true });
      return;
    }

    if (proposal.protection.expiresAt && new Date(proposal.protection.expiresAt) < new Date()) {
      res.status(410).json({ error: 'Código expirado. Solicite um novo à agência.' });
      return;
    }

    if (proposal.protection.pin !== pin) {
      res.status(401).json({ error: 'Código incorreto' });
      return;
    }

    res.json({ verified: true });
  } catch (error) {
    console.error('Erro ao verificar PIN:', error);
    res.status(500).json({ error: 'Erro ao verificar código' });
  }
};

// ─── Exportar Proposta XLSX ──────────────────────────────────────────────

const STATUS_LABELS: Record<string, string> = {
  draft: 'Rascunho', sent: 'Enviada', viewed: 'Visualizada',
  approved: 'Aprovada', rejected: 'Recusada', expired: 'Expirada', converted: 'Convertida'
};

/**
 * Gera workbook XLSX a partir de uma proposta (usado por rota autenticada e pública).
 */
async function buildProposalWorkbook(proposal: any): Promise<ExcelJS.Workbook> {
    const wb = new ExcelJS.Workbook();
    wb.creator = 'SignalAds';
    wb.created = new Date();

    const BRAND = '1B2A4A';
    const BRAND_LIGHT = 'E8EDF5';
    const GREEN = '16A34A';
    const GREEN_LIGHT = 'DCFCE7';
    const GRAY_BG = 'F8FAFC';
    const BORDER_COLOR = 'D1D5DB';
    const WHITE = 'FFFFFF';

    const thinBorder: Partial<ExcelJS.Borders> = {
      top: { style: 'thin', color: { argb: BORDER_COLOR } },
      bottom: { style: 'thin', color: { argb: BORDER_COLOR } },
      left: { style: 'thin', color: { argb: BORDER_COLOR } },
      right: { style: 'thin', color: { argb: BORDER_COLOR } }
    };

    const currencyFmt = '#.##0,00;-#.##0,00';
    const pctFmt = '0,00"%"';

    const fmtCurrency = (v: number) => `R$ ${(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
    const fmtDate = (d: any) => d ? new Date(d).toLocaleDateString('pt-BR') : '—';
    const fmtDateTime = (d: any) => d ? new Date(d).toLocaleString('pt-BR') : '—';

    // ═══════════════════════════════════════════════════════════════════════
    // ABA 1: RESUMO
    // ═══════════════════════════════════════════════════════════════════════
    const ws1 = wb.addWorksheet('Resumo', { properties: { defaultColWidth: 20 } });
    ws1.columns = [
      { width: 28 }, { width: 35 }, { width: 22 }, { width: 22 }
    ];

    // Header
    ws1.mergeCells('A1:D1');
    const titleCell = ws1.getCell('A1');
    titleCell.value = proposal.title || 'Proposta Comercial';
    titleCell.font = { name: 'Calibri', size: 16, bold: true, color: { argb: WHITE } };
    titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND } };
    titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
    ws1.getRow(1).height = 40;

    ws1.mergeCells('A2:D2');
    const subCell = ws1.getCell('A2');
    subCell.value = `${proposal.proposalNumber}  •  Status: ${STATUS_LABELS[proposal.status] || proposal.status}  •  Gerado em: ${fmtDateTime(new Date())}`;
    subCell.font = { name: 'Calibri', size: 10, color: { argb: BRAND } };
    subCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND_LIGHT } };
    subCell.alignment = { horizontal: 'center', vertical: 'middle' };
    ws1.getRow(2).height = 24;

    // Seção: Dados Gerais
    let row = 4;
    const addSectionHeader = (sheet: ExcelJS.Worksheet, r: number, title: string, cols = 4) => {
      sheet.mergeCells(r, 1, r, cols);
      const c = sheet.getCell(r, 1);
      c.value = title;
      c.font = { name: 'Calibri', size: 12, bold: true, color: { argb: WHITE } };
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND } };
      c.alignment = { vertical: 'middle' };
      sheet.getRow(r).height = 26;
      return r + 1;
    };

    const addKeyValue = (sheet: ExcelJS.Worksheet, r: number, label: string, value: string, colStart = 1) => {
      const lc = sheet.getCell(r, colStart);
      lc.value = label;
      lc.font = { name: 'Calibri', size: 10, bold: true, color: { argb: '6B7280' } };
      const vc = sheet.getCell(r, colStart + 1);
      vc.value = value;
      vc.font = { name: 'Calibri', size: 11 };
      return r;
    };

    row = addSectionHeader(ws1, row, 'DADOS GERAIS');
    const client: any = proposal.clientId;
    addKeyValue(ws1, row, 'Cliente', (client?.name || (proposal as any).clientName || '—'));
    addKeyValue(ws1, row, 'Documento', client?.documentNumber || '—', 3);
    row++;
    addKeyValue(ws1, row, 'E-mail', client?.email || '—');
    addKeyValue(ws1, row, 'Telefone', client?.phone || '—', 3);
    row++;
    addKeyValue(ws1, row, 'Válida até', fmtDate(proposal.validUntil));
    addKeyValue(ws1, row, 'Criada em', fmtDateTime(proposal.createdAt), 3);
    row++;
    if (proposal.sentAt) {
      addKeyValue(ws1, row, 'Enviada em', fmtDateTime(proposal.sentAt));
      addKeyValue(ws1, row, 'Visualizações', String(proposal.viewCount || 0), 3);
      row++;
    }
    if (proposal.respondedAt) {
      addKeyValue(ws1, row, 'Respondida em', fmtDateTime(proposal.respondedAt));
      row++;
    }

    // Seção: Resumo Financeiro
    row += 1;
    row = addSectionHeader(ws1, row, 'RESUMO FINANCEIRO');

    const items: any[] = proposal.items || [];
    const broadcasterCount = new Set(items.filter((i: any) => !i.isCustom).map((i: any) => i.broadcasterId)).size;
    const totalInsertions = items.reduce((sum: number, i: any) => sum + (i.quantity || 0), 0);

    const finRows: [string, string][] = [
      ['Emissoras', String(broadcasterCount)],
      ['Itens / Inserções', `${items.length} itens  •  ${totalInsertions} inserções`],
      ['Subtotal (bruto)', fmtCurrency(proposal.grossAmount)],
    ];

    if (proposal.productionCost > 0) {
      const recCount = items.filter((i: any) => i.needsRecording).length;
      finRows.push([`Produção (${recCount} gravação${recCount > 1 ? 'ões' : ''})`, fmtCurrency(proposal.productionCost)]);
    }

    finRows.push(['Taxa de Serviço (5%)', fmtCurrency(proposal.techFee || 0)]);

    if (proposal.agencyCommission > 0) {
      finRows.push([`Comissão Agência (${proposal.agencyCommission}%)`, fmtCurrency(proposal.agencyCommissionAmount)]);
    }
    if (proposal.monitoringCost > 0) {
      finRows.push(['Radio Analytics', fmtCurrency(proposal.monitoringCost)]);
    }
    if (proposal.discountAmount > 0) {
      const discLabel = proposal.discount?.type === 'percentage'
        ? `Desconto (${proposal.discount.value}%)`
        : 'Desconto';
      finRows.push([discLabel, `- ${fmtCurrency(proposal.discountAmount)}`]);
      if (proposal.discount?.reason) {
        finRows.push(['Motivo do desconto', proposal.discount.reason]);
      }
    }

    finRows.forEach(([label, value]) => {
      const lc = ws1.getCell(row, 1);
      lc.value = label;
      lc.font = { name: 'Calibri', size: 11 };
      lc.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GRAY_BG } };
      lc.border = thinBorder;

      ws1.mergeCells(row, 2, row, 4);
      const vc = ws1.getCell(row, 2);
      vc.value = value;
      vc.font = { name: 'Calibri', size: 11 };
      vc.alignment = { horizontal: 'right' };
      vc.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GRAY_BG } };
      vc.border = thinBorder;
      row++;
    });

    // Total destaque
    const tlc = ws1.getCell(row, 1);
    tlc.value = 'VALOR TOTAL';
    tlc.font = { name: 'Calibri', size: 13, bold: true, color: { argb: WHITE } };
    tlc.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GREEN } };
    tlc.border = thinBorder;

    ws1.mergeCells(row, 2, row, 4);
    const tvc = ws1.getCell(row, 2);
    tvc.value = fmtCurrency(proposal.totalAmount);
    tvc.font = { name: 'Calibri', size: 13, bold: true, color: { argb: WHITE } };
    tvc.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GREEN } };
    tvc.alignment = { horizontal: 'right' };
    tvc.border = thinBorder;
    ws1.getRow(row).height = 30;

    // Aprovação (se existir)
    if (proposal.approval?.approvedAt) {
      row += 2;
      row = addSectionHeader(ws1, row, 'APROVAÇÃO');
      addKeyValue(ws1, row, 'Aprovado por', proposal.approval.name || '—');
      addKeyValue(ws1, row, 'E-mail', proposal.approval.email || '—', 3);
      row++;
      addKeyValue(ws1, row, 'Data', fmtDateTime(proposal.approval.approvedAt));
      addKeyValue(ws1, row, 'IP', proposal.approval.ip || '—', 3);
    }

    // ═══════════════════════════════════════════════════════════════════════
    // ABA 2: ITENS DETALHADOS
    // ═══════════════════════════════════════════════════════════════════════
    const ws2 = wb.addWorksheet('Itens', { properties: { defaultColWidth: 16 } });

    const itemHeaders = [
      'Emissora', 'Cidade/UF', 'Dial', 'Produto', 'Duração',
      'Qtd.', 'Preço Unit.', 'Preço Ajustado', 'Total', 'Tipo'
    ];
    const itemColWidths = [24, 20, 10, 20, 10, 8, 16, 16, 16, 10];

    ws2.columns = itemColWidths.map(w => ({ width: w }));

    // Header row
    ws2.mergeCells('A1:J1');
    const h2 = ws2.getCell('A1');
    h2.value = `ITENS DA PROPOSTA  —  ${proposal.proposalNumber}`;
    h2.font = { name: 'Calibri', size: 14, bold: true, color: { argb: WHITE } };
    h2.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND } };
    h2.alignment = { horizontal: 'center', vertical: 'middle' };
    ws2.getRow(1).height = 36;

    // Column headers
    const headerRow = ws2.getRow(2);
    itemHeaders.forEach((h, i) => {
      const c = headerRow.getCell(i + 1);
      c.value = h;
      c.font = { name: 'Calibri', size: 10, bold: true, color: { argb: WHITE } };
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: '475569' } };
      c.alignment = { horizontal: i >= 5 ? 'center' : 'left', vertical: 'middle' };
      c.border = thinBorder;
    });
    headerRow.height = 24;

    // Data rows
    const sortedItems = [...items].sort((a, b) => (a.broadcasterName || '').localeCompare(b.broadcasterName || ''));
    let prevBroadcaster = '';

    sortedItems.forEach((item, idx) => {
      const r = ws2.getRow(idx + 3);
      const isBroadcasterChange = item.broadcasterName !== prevBroadcaster;
      prevBroadcaster = item.broadcasterName || '';

      const rowBg = idx % 2 === 0 ? WHITE : GRAY_BG;

      const values = [
        item.broadcasterName || (item.isCustom ? 'Item Manual' : '—'),
        item.city && item.state ? `${item.city}/${item.state}` : (item.city || item.state || '—'),
        item.dial || '—',
        item.productName || item.customDescription || '—',
        item.duration ? `${item.duration}s` : '—',
        item.quantity || 0,
        item.unitPrice || 0,
        item.adjustedPrice && item.adjustedPrice !== item.unitPrice ? item.adjustedPrice : null,
        item.totalPrice || 0,
        item.isCustom ? 'Manual' : 'Marketplace'
      ];

      values.forEach((v, ci) => {
        const cell = r.getCell(ci + 1);
        // Monetary columns: 6 (unitPrice), 7 (adjustedPrice), 8 (totalPrice) → index 6,7,8
        if ((ci === 6 || ci === 7 || ci === 8) && typeof v === 'number') {
          cell.value = v;
          cell.numFmt = `"R$ "${currencyFmt}`;
        } else if (ci === 7 && v === null) {
          cell.value = '—';
        } else {
          cell.value = v;
        }
        cell.font = { name: 'Calibri', size: 10 };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: rowBg } };
        cell.border = thinBorder;
        if (ci >= 5 && ci <= 8) cell.alignment = { horizontal: 'center' };
      });
    });

    // Total row
    const totalR = ws2.getRow(items.length + 3);
    ws2.mergeCells(items.length + 3, 1, items.length + 3, 5);
    const tLabel = totalR.getCell(1);
    tLabel.value = 'TOTAL';
    tLabel.font = { name: 'Calibri', size: 11, bold: true };
    tLabel.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND_LIGHT } };
    tLabel.border = thinBorder;

    const tQty = totalR.getCell(6);
    tQty.value = totalInsertions;
    tQty.font = { name: 'Calibri', size: 11, bold: true };
    tQty.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND_LIGHT } };
    tQty.alignment = { horizontal: 'center' };
    tQty.border = thinBorder;

    [7, 8].forEach(ci => {
      const c = totalR.getCell(ci);
      c.value = '';
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND_LIGHT } };
      c.border = thinBorder;
    });

    const tTotal = totalR.getCell(9);
    tTotal.value = proposal.grossAmount || 0;
    tTotal.numFmt = `"R$ "${currencyFmt}`;
    tTotal.font = { name: 'Calibri', size: 11, bold: true };
    tTotal.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND_LIGHT } };
    tTotal.alignment = { horizontal: 'center' };
    tTotal.border = thinBorder;

    const tType = totalR.getCell(10);
    tType.value = '';
    tType.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND_LIGHT } };
    tType.border = thinBorder;

    // ═══════════════════════════════════════════════════════════════════════
    // ABA 3: DISTRIBUIÇÃO
    // ═══════════════════════════════════════════════════════════════════════
    const ws3 = wb.addWorksheet('Distribuição', { properties: { defaultColWidth: 18 } });
    ws3.columns = [
      { width: 26 }, { width: 20 }, { width: 12 }, { width: 12 },
      { width: 14 }, { width: 16 }, { width: 14 }
    ];

    ws3.mergeCells('A1:G1');
    const h3 = ws3.getCell('A1');
    h3.value = 'DISTRIBUIÇÃO POR EMISSORA';
    h3.font = { name: 'Calibri', size: 14, bold: true, color: { argb: WHITE } };
    h3.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND } };
    h3.alignment = { horizontal: 'center', vertical: 'middle' };
    ws3.getRow(1).height = 36;

    // Agrupa por emissora
    const broadcasterMap: Record<string, { name: string; city: string; state: string; dial: string; items: number; insertions: number; total: number; population: number }> = {};
    items.filter((i: any) => !i.isCustom).forEach((item: any) => {
      const key = item.broadcasterId || item.broadcasterName || 'unknown';
      if (!broadcasterMap[key]) {
        broadcasterMap[key] = {
          name: item.broadcasterName || '—',
          city: item.city || '—',
          state: item.state || '—',
          dial: item.dial || '—',
          items: 0,
          insertions: 0,
          total: 0,
          population: item.population || 0
        };
      }
      broadcasterMap[key].items++;
      broadcasterMap[key].insertions += item.quantity || 0;
      broadcasterMap[key].total += item.totalPrice || 0;
    });

    const distHeaders = ['Emissora', 'Cidade/UF', 'Dial', 'Produtos', 'Inserções', 'Valor', '% do Total'];
    const distHeaderRow = ws3.getRow(2);
    distHeaders.forEach((h, i) => {
      const c = distHeaderRow.getCell(i + 1);
      c.value = h;
      c.font = { name: 'Calibri', size: 10, bold: true, color: { argb: WHITE } };
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: '475569' } };
      c.alignment = { horizontal: i >= 3 ? 'center' : 'left', vertical: 'middle' };
      c.border = thinBorder;
    });
    distHeaderRow.height = 24;

    const broadcasters = Object.values(broadcasterMap).sort((a, b) => b.total - a.total);
    const grossTotal = proposal.grossAmount || 1;

    broadcasters.forEach((b, idx) => {
      const r = ws3.getRow(idx + 3);
      const rowBg = idx % 2 === 0 ? WHITE : GRAY_BG;
      const pct = ((b.total / grossTotal) * 100).toFixed(1);

      const vals: (string | number)[] = [
        b.name, `${b.city}/${b.state}`, b.dial,
        b.items, b.insertions, b.total, `${pct}%`
      ];

      vals.forEach((v, ci) => {
        const cell = r.getCell(ci + 1);
        if (ci === 5 && typeof v === 'number') {
          cell.value = v;
          cell.numFmt = `"R$ "${currencyFmt}`;
        } else {
          cell.value = v;
        }
        cell.font = { name: 'Calibri', size: 10 };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: rowBg } };
        cell.border = thinBorder;
        if (ci >= 3) cell.alignment = { horizontal: 'center' };
      });
    });

    // Distribuição por Estado
    const stateRow = broadcasters.length + 4;
    ws3.mergeCells(stateRow, 1, stateRow, 7);
    const stateH = ws3.getCell(stateRow, 1);
    stateH.value = 'DISTRIBUIÇÃO POR ESTADO';
    stateH.font = { name: 'Calibri', size: 12, bold: true, color: { argb: WHITE } };
    stateH.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND } };
    ws3.getRow(stateRow).height = 26;

    const stateHeaders = ['Estado', 'Emissoras', 'Inserções', 'Valor', '% do Total'];
    const stateHRow = ws3.getRow(stateRow + 1);
    stateHeaders.forEach((h, i) => {
      const c = stateHRow.getCell(i + 1);
      c.value = h;
      c.font = { name: 'Calibri', size: 10, bold: true, color: { argb: WHITE } };
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: '475569' } };
      c.alignment = { horizontal: i >= 1 ? 'center' : 'left', vertical: 'middle' };
      c.border = thinBorder;
    });

    const stateMap: Record<string, { emissoras: Set<string>; insertions: number; total: number }> = {};
    items.filter((i: any) => !i.isCustom).forEach((item: any) => {
      const st = item.state || 'N/I';
      if (!stateMap[st]) stateMap[st] = { emissoras: new Set(), insertions: 0, total: 0 };
      stateMap[st].emissoras.add(item.broadcasterId || item.broadcasterName || '');
      stateMap[st].insertions += item.quantity || 0;
      stateMap[st].total += item.totalPrice || 0;
    });

    const states = Object.entries(stateMap).sort((a, b) => b[1].total - a[1].total);
    states.forEach(([st, data], idx) => {
      const r = ws3.getRow(stateRow + 2 + idx);
      const rowBg = idx % 2 === 0 ? WHITE : GRAY_BG;
      const pct = ((data.total / grossTotal) * 100).toFixed(1);

      const vals: (string | number)[] = [st, data.emissoras.size, data.insertions, data.total, `${pct}%`];
      vals.forEach((v, ci) => {
        const cell = r.getCell(ci + 1);
        if (ci === 3 && typeof v === 'number') {
          cell.value = v;
          cell.numFmt = `"R$ "${currencyFmt}`;
        } else {
          cell.value = v;
        }
        cell.font = { name: 'Calibri', size: 10 };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: rowBg } };
        cell.border = thinBorder;
        if (ci >= 1) cell.alignment = { horizontal: 'center' };
      });
    });

    // ═══════════════════════════════════════════════════════════════════════
    // ABA 4: CRONOGRAMA
    // ═══════════════════════════════════════════════════════════════════════
    // Verifica se há schedule data
    const itemsWithSchedule = items.filter((i: any) => {
      const sched = i.schedule;
      if (!sched) return false;
      if (sched instanceof Map) return sched.size > 0;
      return Object.keys(sched).length > 0;
    });

    if (itemsWithSchedule.length > 0) {
      // Coleta todas as datas
      const allDates = new Set<string>();
      itemsWithSchedule.forEach((item: any) => {
        const sched = item.schedule;
        if (sched instanceof Map) {
          sched.forEach((_: number, key: string) => allDates.add(key));
        } else if (sched) {
          Object.keys(sched).forEach(key => allDates.add(key));
        }
      });

      const sortedDates = Array.from(allDates).sort();
      if (sortedDates.length > 0) {
        const ws4 = wb.addWorksheet('Cronograma', { properties: { defaultColWidth: 12 } });
        const schedCols = [{ width: 24 }, { width: 18 }, ...sortedDates.map(() => ({ width: 12 }))];
        ws4.columns = schedCols;

        const totalCols = 2 + sortedDates.length;
        ws4.mergeCells(1, 1, 1, totalCols);
        const h4 = ws4.getCell('A1');
        h4.value = 'CRONOGRAMA DE VEICULAÇÃO';
        h4.font = { name: 'Calibri', size: 14, bold: true, color: { argb: WHITE } };
        h4.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND } };
        h4.alignment = { horizontal: 'center', vertical: 'middle' };
        ws4.getRow(1).height = 36;

        // Headers
        const schedHeaderRow = ws4.getRow(2);
        ['Emissora', 'Produto', ...sortedDates.map(d => {
          const [y, m, day] = d.split('-');
          return `${day}/${m}`;
        })].forEach((h, i) => {
          const c = schedHeaderRow.getCell(i + 1);
          c.value = h;
          c.font = { name: 'Calibri', size: 9, bold: true, color: { argb: WHITE } };
          c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: '475569' } };
          c.alignment = { horizontal: 'center', vertical: 'middle' };
          c.border = thinBorder;
        });
        schedHeaderRow.height = 22;

        itemsWithSchedule.forEach((item, idx) => {
          const r = ws4.getRow(idx + 3);
          const rowBg = idx % 2 === 0 ? WHITE : GRAY_BG;

          r.getCell(1).value = item.broadcasterName || '—';
          r.getCell(1).font = { name: 'Calibri', size: 9 };
          r.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: rowBg } };
          r.getCell(1).border = thinBorder;

          r.getCell(2).value = item.productName || '—';
          r.getCell(2).font = { name: 'Calibri', size: 9 };
          r.getCell(2).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: rowBg } };
          r.getCell(2).border = thinBorder;

          const sched = item.schedule;
          sortedDates.forEach((date, di) => {
            const cell = r.getCell(di + 3);
            let qty = 0;
            if (sched instanceof Map) {
              qty = sched.get(date) || 0;
            } else if (sched) {
              qty = (sched as any)[date] || 0;
            }
            cell.value = qty > 0 ? qty : '';
            cell.font = { name: 'Calibri', size: 9 };
            cell.alignment = { horizontal: 'center' };
            cell.border = thinBorder;
            if (qty > 0) {
              cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GREEN_LIGHT } };
              cell.font = { name: 'Calibri', size: 9, bold: true, color: { argb: GREEN } };
            } else {
              cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: rowBg } };
            }
          });
        });
      }
    }

    return wb;
}

async function sendWorkbook(res: Response, wb: ExcelJS.Workbook, filename: string): Promise<void> {
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  await wb.xlsx.write(res);
  res.end();
}

/**
 * GET /api/proposals/:id/export
 * Exporta XLSX (rota autenticada — agency).
 */
export const exportProposalXlsx = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!requireAgency(req, res)) return;

    const proposal = await Proposal.findOne({ _id: req.params.id, agencyId: req.userId })
      .populate('clientId', 'name documentNumber email phone')
      .lean();

    if (!proposal) {
      res.status(404).json({ error: 'Proposta não encontrada' });
      return;
    }

    const wb = await buildProposalWorkbook(proposal);
    await sendWorkbook(res, wb, `${proposal.proposalNumber || 'proposta'}.xlsx`);
  } catch (error) {
    console.error('Erro ao exportar proposta XLSX:', error);
    res.status(500).json({ error: 'Erro ao gerar planilha' });
  }
};

/**
 * GET /api/proposals/public/:slug/export
 * Exporta XLSX (rota pública — cliente via link).
 */
export const exportPublicProposalXlsx = async (req: Request, res: Response): Promise<void> => {
  try {
    const proposal = await Proposal.findOne({
      slug: req.params.slug,
      status: { $in: ['sent', 'viewed', 'approved', 'rejected', 'converted'] }
    })
      .populate('clientId', 'name documentNumber email phone')
      .lean();

    if (!proposal) {
      res.status(404).json({ error: 'Proposta não encontrada' });
      return;
    }

    const wb = await buildProposalWorkbook(proposal);
    await sendWorkbook(res, wb, `${proposal.proposalNumber || 'proposta'}.xlsx`);
  } catch (error) {
    console.error('Erro ao exportar proposta XLSX (público):', error);
    res.status(500).json({ error: 'Erro ao gerar planilha' });
  }
};
