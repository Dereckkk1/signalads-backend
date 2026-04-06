import { Request, Response } from 'express';
import mongoose from 'mongoose';
import { AuthRequest } from '../middleware/auth';
import Proposal from '../models/Proposal';
import ProposalTemplate from '../models/ProposalTemplate';
import ProposalVersion from '../models/ProposalVersion';
import { Product } from '../models/Product';
import { cacheGet, cacheSet, cacheInvalidate } from '../config/redis';
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

function requireBroadcaster(req: AuthRequest, res: Response): boolean {
  if (req.user?.userType !== 'broadcaster') {
    res.status(403).json({ error: 'Acesso restrito a emissoras' });
    return false;
  }
  return true;
}

async function invalidateProposalCache(broadcasterId: string, slug?: string): Promise<void> {
  await cacheInvalidate(`proposals:broadcaster:${broadcasterId}*`);
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
        agencyCommission: 0,
        agencyCommissionAmount: 0,
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
 * POST /api/broadcaster-proposals
 * Cria proposta a partir dos produtos da emissora (snapshot).
 */
export const createProposal = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!requireBroadcaster(req, res)) return;

    const { items, clientName, title, description, templateId, isMonitoringEnabled, discount: discountInput } = req.body;

    if (!items || !Array.isArray(items) || items.length === 0) {
      res.status(400).json({ error: 'Itens da proposta são obrigatórios' });
      return;
    }

    // Separar itens do marketplace e itens customizados
    const marketplaceItems = items.filter((i: any) => !i.isCustom && i.productId);
    const customItems = items.filter((i: any) => i.isCustom);

    // Validar que os produtos pertencem a esta emissora
    const productIds = marketplaceItems.map((item: any) => item.productId);
    const products = productIds.length > 0
      ? await Product.find({ _id: { $in: productIds } }).populate('broadcasterId')
      : [];
    const productMap = new Map(products.map(p => [p._id.toString(), p]));

    const proposalItems: any[] = [];
    let productsTotal = 0;

    // Processar itens do marketplace (produtos da emissora)
    for (const item of marketplaceItems) {
      const product = productMap.get(item.productId?.toString());
      if (!product) {
        res.status(400).json({ error: `Produto ${item.productId} não encontrado` });
        return;
      }

      // Validar que o produto pertence a esta emissora
      if (product.broadcasterId?.toString() !== req.userId && (product.broadcasterId as any)?._id?.toString() !== req.userId) {
        res.status(403).json({ error: `Produto ${item.productId} não pertence a esta emissora` });
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
        // Audience snapshot
        categories: bProfile?.categories || undefined,
        audienceGenderFemale: bProfile?.audienceProfile?.gender?.female || undefined,
        audienceAgeRange: bProfile?.audienceProfile?.ageRange || undefined,
        audienceSocialClass: bProfile?.audienceProfile?.socialClass
          ? `${(bProfile.audienceProfile.socialClass.classeAB || 0) + (bProfile.audienceProfile.socialClass.classeC || 0)}% ABC`
          : undefined,
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

    // Calcular financeiro (snapshot) — SEM comissão de agência
    const grossAmount = parseFloat((productsTotal + productionCost).toFixed(2));

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

    // totalAmount = grossAmount + techFee - discountAmount + monitoringCost (sem comissão)
    const totalAmount = parseFloat((grossAmount + techFee - discountAmount + monitoringCost).toFixed(2));

    // Gerar slug unico
    const slugBase = slugify(title || 'proposta-comercial');
    const slug = `${slugBase}-${generateId(8)}`;

    // Se template foi selecionado, copiar customization
    let customization: any = undefined;
    if (templateId) {
      const template = await ProposalTemplate.findOne({
        _id: templateId,
        $or: [{ broadcasterId: req.userId }, { isDefault: true }]
      });
      if (template) {
        customization = template.customization;
      }
    }

    const proposal = new Proposal({
      ownerType: 'broadcaster',
      broadcasterId: req.userId,
      clientName: clientName || undefined,
      title: title || 'Proposta Comercial',
      description: description || undefined,
      slug,
      items: proposalItems,
      grossAmount,
      techFee,
      productionCost,
      agencyCommission: 0,
      agencyCommissionAmount: 0,
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
 * GET /api/broadcaster-proposals
 * Lista propostas da emissora autenticada.
 */
export const getProposals = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!requireBroadcaster(req, res)) return;

    const { status, search, page = '1', limit = '20' } = req.query;
    const pageNum = Math.max(1, parseInt(page as string));
    const limitNum = Math.min(50, Math.max(1, parseInt(limit as string)));

    const filter: any = { broadcasterId: req.userId };
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
 * GET /api/broadcaster-proposals/:id
 * Detalhe de uma proposta (apenas owner).
 */
export const getProposal = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!requireBroadcaster(req, res)) return;

    const proposal = await Proposal.findOne({
      _id: req.params.id,
      broadcasterId: req.userId
    });

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
 * PUT /api/broadcaster-proposals/:id
 * Edita proposta (items, dados gerais, customizacao).
 */
export const updateProposal = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!requireBroadcaster(req, res)) return;

    const proposal = await Proposal.findOne({
      _id: req.params.id,
      broadcasterId: req.userId
    });

    if (!proposal) {
      res.status(404).json({ error: 'Proposta não encontrada' });
      return;
    }

    const { title, description, clientName, items, customization, validUntil, isMonitoringEnabled, discount: discountInput } = req.body;

    // Atualizar campos basicos
    if (title !== undefined) proposal.title = title;
    if (description !== undefined) proposal.description = description;
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
      proposal.agencyCommission = 0;
      proposal.agencyCommissionAmount = 0;
      proposal.monitoringCost = monitoringCost;
      proposal.discountAmount = discountAmt;
      proposal.totalAmount = parseFloat((grossAmount + techFee - discountAmt + monitoringCost).toFixed(2));
    } else if (discountInput !== undefined) {
      // Recalcular sem alterar items
      const techFee = parseFloat((proposal.grossAmount * 0.05).toFixed(2));
      proposal.techFee = techFee;
      const discountAmt = calculateDiscount(proposal.grossAmount, proposal.discount);
      proposal.discountAmount = discountAmt;
      proposal.totalAmount = parseFloat((proposal.grossAmount + techFee - discountAmt + proposal.monitoringCost).toFixed(2));
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
 * PUT /api/broadcaster-proposals/:id/customization
 * Atualiza apenas a customizacao visual (autosave do editor).
 */
export const updateCustomization = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!requireBroadcaster(req, res)) return;

    const { customization } = req.body;
    if (!customization) {
      res.status(400).json({ error: 'Dados de customização são obrigatórios' });
      return;
    }

    const proposal = await Proposal.findOneAndUpdate(
      { _id: req.params.id, broadcasterId: req.userId },
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
 * DELETE /api/broadcaster-proposals/:id
 * Exclui proposta permanentemente.
 */
export const deleteProposal = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!requireBroadcaster(req, res)) return;

    const proposal = await Proposal.findOneAndDelete({
      _id: req.params.id,
      broadcasterId: req.userId
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
 * POST /api/broadcaster-proposals/:id/duplicate
 * Duplica proposta existente como rascunho.
 */
export const duplicateProposal = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!requireBroadcaster(req, res)) return;

    const original = await Proposal.findOne({
      _id: req.params.id,
      broadcasterId: req.userId
    }).lean();

    if (!original) {
      res.status(404).json({ error: 'Proposta não encontrada' });
      return;
    }

    const slugBase = slugify(`copia-${original.title}`);
    const slug = `${slugBase}-${generateId(8)}`;

    const duplicate = new Proposal({
      ownerType: 'broadcaster',
      broadcasterId: original.broadcasterId,
      clientName: original.clientName,
      title: `Cópia de ${original.title}`,
      description: original.description,
      slug,
      items: original.items,
      grossAmount: original.grossAmount,
      techFee: original.techFee || parseFloat((original.grossAmount * 0.05).toFixed(2)),
      agencyCommission: 0,
      agencyCommissionAmount: 0,
      monitoringCost: original.monitoringCost,
      discount: original.discount,
      discountAmount: original.discountAmount || 0,
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
 * POST /api/broadcaster-proposals/:id/send
 * Marca proposta como enviada.
 */
export const sendProposal = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!requireBroadcaster(req, res)) return;

    const proposal = await Proposal.findOne({
      _id: req.params.id,
      broadcasterId: req.userId
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
 * POST /api/broadcaster-proposals/:id/upload
 * Upload de logo ou cover image para a proposta.
 * Expects multipart/form-data com campo 'file' e query ?type=logo|cover
 */
export const uploadProposalImage = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!requireBroadcaster(req, res)) return;

    const proposal = await Proposal.findOne({
      _id: req.params.id,
      broadcasterId: req.userId
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

// ─── Templates ────────────────────────────────────────────────────────────

/**
 * GET /api/broadcaster-proposals/templates
 * Lista templates da emissora + templates padrao da plataforma.
 */
export const getTemplates = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!requireBroadcaster(req, res)) return;

    const templates = await ProposalTemplate.find({
      $or: [
        { broadcasterId: req.userId },
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
 * POST /api/broadcaster-proposals/templates
 * Cria template a partir da customizacao atual.
 */
export const createTemplate = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!requireBroadcaster(req, res)) return;

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
      broadcasterId: req.userId,
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
 * PUT /api/broadcaster-proposals/templates/:id
 * Edita template (apenas owner).
 */
export const updateTemplate = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!requireBroadcaster(req, res)) return;

    const { name, customization, category } = req.body;

    const template = await ProposalTemplate.findOne({
      _id: req.params.id,
      broadcasterId: req.userId,
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
 * DELETE /api/broadcaster-proposals/templates/:id
 * Exclui template (apenas owner, nao padrao).
 */
export const deleteTemplate = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!requireBroadcaster(req, res)) return;

    const template = await ProposalTemplate.findOneAndDelete({
      _id: req.params.id,
      broadcasterId: req.userId,
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

// ─── Comentários ─────────────────────────────────────────────────────────

/**
 * POST /api/broadcaster-proposals/:id/comments
 * Adiciona comentário a uma seção (broadcaster).
 */
export const addComment = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!requireBroadcaster(req, res)) return;

    const { sectionId, text } = req.body;
    if (!sectionId || !text) {
      res.status(400).json({ error: 'Seção e texto são obrigatórios' });
      return;
    }

    const proposal = await Proposal.findOne({
      _id: req.params.id,
      broadcasterId: req.userId
    });

    if (!proposal) {
      res.status(404).json({ error: 'Proposta não encontrada' });
      return;
    }

    const { User } = await import('../models/User');
    const user = await User.findById(req.userId).lean();

    proposal.comments.push({
      sectionId,
      author: (user as any)?.companyName || (user as any)?.fantasyName || 'Emissora',
      authorEmail: (user as any)?.email,
      authorType: 'broadcaster',
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

// ─── Versionamento ───────────────────────────────────────────────────────

/**
 * GET /api/broadcaster-proposals/:id/versions
 * Lista versões de uma proposta.
 */
export const getVersions = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!requireBroadcaster(req, res)) return;

    const proposal = await Proposal.findOne({ _id: req.params.id, broadcasterId: req.userId });
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
 * POST /api/broadcaster-proposals/:id/versions/:versionId/restore
 * Restaura uma versão anterior.
 */
export const restoreVersion = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!requireBroadcaster(req, res)) return;

    const proposal = await Proposal.findOne({ _id: req.params.id, broadcasterId: req.userId });
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
    proposal.agencyCommission = 0;
    proposal.agencyCommissionAmount = 0;
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
 * GET /api/broadcaster-proposals/analytics
 * Dashboard de analytics de propostas da emissora.
 */
export const getAnalytics = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!requireBroadcaster(req, res)) return;

    const broadcasterId = req.userId;
    const broadcasterOid = new mongoose.Types.ObjectId(broadcasterId);
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
      Proposal.countDocuments({ broadcasterId }),
      Proposal.aggregate([
        { $match: { broadcasterId: broadcasterOid, createdAt: { $gte: startDate } } },
        { $group: { _id: '$status', count: { $sum: 1 }, value: { $sum: '$totalAmount' } } }
      ]),
      Proposal.find({ broadcasterId, createdAt: { $gte: startDate } })
        .select('status totalAmount createdAt sentAt viewedAt respondedAt')
        .sort({ createdAt: -1 })
        .limit(50)
        .lean(),
      Proposal.aggregate([
        { $match: { broadcasterId: broadcasterOid, status: { $in: ['approved', 'converted'] } } },
        { $group: { _id: null, total: { $sum: '$totalAmount' }, count: { $sum: 1 } } }
      ]),
      Proposal.aggregate([
        { $match: { broadcasterId: broadcasterOid, status: { $in: ['rejected', 'expired'] } } },
        { $group: { _id: null, total: { $sum: '$totalAmount' } } }
      ]),
      Proposal.aggregate([
        { $match: { broadcasterId: broadcasterOid, createdAt: { $gte: startDate } } },
        { $group: { _id: null, total: { $sum: '$totalAmount' } } }
      ]),
      Proposal.aggregate([
        { $match: { broadcasterId: broadcasterOid, respondedAt: { $exists: true }, sentAt: { $exists: true } } },
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

// ─── Proteção por PIN ────────────────────────────────────────────────────

/**
 * POST /api/broadcaster-proposals/:id/protection
 * Ativa ou desativa proteção por PIN.
 */
export const setProtection = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!requireBroadcaster(req, res)) return;

    const { enabled, email } = req.body;

    const proposal = await Proposal.findOne({ _id: req.params.id, broadcasterId: req.userId });
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

// ─── Exportar Proposta XLSX ──────────────────────────────────────────────

const STATUS_LABELS: Record<string, string> = {
  draft: 'Rascunho', sent: 'Enviada', viewed: 'Visualizada',
  approved: 'Aprovada', rejected: 'Recusada', expired: 'Expirada', converted: 'Convertida'
};

/**
 * Gera workbook XLSX a partir de uma proposta de emissora (sem comissão de agência).
 */
async function buildBroadcasterProposalWorkbook(proposal: any): Promise<ExcelJS.Workbook> {
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
    addKeyValue(ws1, row, 'Cliente', (proposal as any).clientName || '—');
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

    // NO agency commission rows for broadcaster proposals

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
    // ABA 3: DISTRIBUIÇÃO (Cronograma de Veiculação)
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
        const ws4 = wb.addWorksheet('Distribuição', { properties: { defaultColWidth: 12 } });
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
 * GET /api/broadcaster-proposals/:id/export
 * Exporta XLSX (rota autenticada — broadcaster).
 */
export const exportProposalXlsx = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!requireBroadcaster(req, res)) return;

    const proposal = await Proposal.findOne({ _id: req.params.id, broadcasterId: req.userId })
      .lean();

    if (!proposal) {
      res.status(404).json({ error: 'Proposta não encontrada' });
      return;
    }

    const wb = await buildBroadcasterProposalWorkbook(proposal);
    await sendWorkbook(res, wb, `${proposal.proposalNumber || 'proposta'}.xlsx`);
  } catch (error) {
    console.error('Erro ao exportar proposta XLSX:', error);
    res.status(500).json({ error: 'Erro ao gerar planilha' });
  }
};

// ─── Produtos da Emissora ────────────────────────────────────────────────

/**
 * GET /api/broadcaster-proposals/my-products
 * Retorna produtos ativos da emissora para seleção ao criar propostas.
 */
export const getMyProducts = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!requireBroadcaster(req, res)) return;

    const products = await Product.find({
      broadcasterId: req.userId,
      isActive: true
    })
      .populate('broadcasterId', 'companyName fantasyName address broadcasterProfile')
      .lean();

    res.json({ products });
  } catch (error) {
    console.error('Erro ao buscar produtos:', error);
    res.status(500).json({ error: 'Erro ao buscar produtos da emissora' });
  }
};
