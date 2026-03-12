import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { User } from '../models/User';
import { Product } from '../models/Product';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { uploadFile } from '../config/storage';
import { sendEmailConfirmation } from '../services/emailService';
import NodeGeocoder from 'node-geocoder';

const geocoderOptions: NodeGeocoder.Options = { provider: 'openstreetmap' };
const geocoder = NodeGeocoder(geocoderOptions);

/**
 * Helper: Geocodifica a cidade/estado de um endereço e retorna lat/lng.
 * Usado ao criar/atualizar emissoras para preencher address.latitude/longitude.
 */
async function geocodeAddress(address: any): Promise<{ latitude: number; longitude: number } | null> {
  try {
    const city = address?.city;
    const state = address?.state;
    if (!city) return null;

    const query = state ? `${city}, ${state}, Brasil` : `${city}, Brasil`;
    const results = await geocoder.geocode(query);

    const first = results?.[0];
    if (first && first.latitude != null && first.longitude != null) {
      console.log(`📍 Geocodificação OK: "${query}" → (${first.latitude}, ${first.longitude})`);
      return { latitude: first.latitude, longitude: first.longitude };
    }
    console.log(`⚠️ Geocodificação sem resultado para: "${query}"`);
    return null;
  } catch (err) {
    console.error('❌ Erro ao geocodificar endereço:', err);
    return null;
  }
}

/**
 * Controller de Emissoras Catálogo
 * Gerencia emissoras cadastradas pelo admin (sem conta própria)
 * Modelo "Agência/Vitrine" - 100% do pagamento vai para plataforma
 */

// ========================
// CRUD DE EMISSORAS CATÁLOGO
// ========================

/**
 * POST /api/admin/catalog-broadcasters
 * Cria uma nova emissora catálogo (sem conta própria)
 */
export const createCatalogBroadcaster = async (req: AuthRequest, res: Response) => {
  try {
    const adminId = req.userId;

    // Verifica se é admin
    const admin = await User.findById(adminId);
    if (!admin || admin.userType !== 'admin') {
      return res.status(403).json({ message: 'Acesso negado. Apenas administradores.' });
    }

    const {
      companyName,
      fantasyName,
      cnpj,
      phone,
      email,
      address,
      broadcasterProfile
    } = req.body;

    // Validações básicas
    if (!companyName || !phone || !email) {
      return res.status(400).json({
        message: 'Campos obrigatórios: companyName, phone, email'
      });
    }

    // Verifica se email já existe
    const existingEmail = await User.findOne({ email: email.toLowerCase() });
    if (existingEmail) {
      return res.status(400).json({
        message: `Este email já está cadastrado como ${existingEmail.userType} (status: ${existingEmail.status})`
      });
    }

    // Gera identificador único para cpfOrCnpj (evita conflito de unique)
    const catalogId = `CATALOG-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;

    // Gera senha aleatória (nunca será usada, emissora catálogo não faz login)
    const randomPassword = crypto.randomBytes(16).toString('hex');
    const hashedPassword = await bcrypt.hash(randomPassword, 10);

    // Função helper para remover undefined recursivamente
    const removeUndefined = (obj: any): any => {
      if (obj === null || obj === undefined) return undefined;
      if (typeof obj !== 'object') return obj;
      if (Array.isArray(obj)) return obj;

      const cleaned: any = {};
      for (const [key, value] of Object.entries(obj)) {
        if (value !== undefined) {
          if (typeof value === 'object' && !Array.isArray(value)) {
            cleaned[key] = removeUndefined(value);
          } else {
            cleaned[key] = value;
          }
        }
      }
      return cleaned;
    };

    // Remove campos undefined do broadcasterProfile
    let cleanBroadcasterProfile = broadcasterProfile || {
      generalInfo: {
        stationName: companyName,
        dialFrequency: '',
        band: 'FM'
      }
    };

    if (broadcasterProfile) {
      cleanBroadcasterProfile = removeUndefined(broadcasterProfile);
    }

    // Geocodifica o endereço para obter lat/lng (necessário para ordenação por proximidade no marketplace)
    let finalAddress = address || {};
    if (finalAddress.city && (!finalAddress.latitude || !finalAddress.longitude)) {
      const coords = await geocodeAddress(finalAddress);
      if (coords) {
        finalAddress = { ...finalAddress, latitude: coords.latitude, longitude: coords.longitude };
      }
    }

    // Cria a emissora catálogo
    const catalogBroadcaster = new User({
      companyName,
      fantasyName: fantasyName || companyName,
      cnpj: cnpj || '',
      phone,
      email: email.toLowerCase(),
      password: hashedPassword,
      cpfOrCnpj: cnpj || catalogId, // Usa CNPJ se tiver, senão usa ID único
      userType: 'broadcaster',
      status: 'approved', // Já aprovada (não precisa de validação)
      onboardingCompleted: true, // Considera completo após cadastro
      isCatalogOnly: true, // MARCA COMO CATÁLOGO
      managedByAdmin: true, // GERENCIADA PELO ADMIN
      createdBy: adminId, // QUEM CRIOU
      address: finalAddress,
      broadcasterProfile: cleanBroadcasterProfile
    });

    // Gera token de confirmação de email e envia
    const confirmToken = crypto.randomBytes(32).toString('hex');
    const tokenExpires = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24h
    catalogBroadcaster.emailConfirmed = false;
    catalogBroadcaster.emailConfirmToken = confirmToken;
    catalogBroadcaster.emailConfirmTokenExpires = tokenExpires;

    await catalogBroadcaster.save();

    // Envia email de confirmação para a emissora
    await sendEmailConfirmation(
      catalogBroadcaster.email,
      companyName || fantasyName || 'Emissora',
      confirmToken
    );

    res.status(201).json({
      message: 'Emissora catálogo criada com sucesso! Email de confirmação enviado.',
      broadcaster: {
        id: catalogBroadcaster._id,
        companyName: catalogBroadcaster.companyName,
        fantasyName: catalogBroadcaster.fantasyName,
        email: catalogBroadcaster.email,
        phone: catalogBroadcaster.phone,
        cnpj: catalogBroadcaster.cnpj,
        address: catalogBroadcaster.address,
        broadcasterProfile: catalogBroadcaster.broadcasterProfile,
        isCatalogOnly: true,
        status: 'approved'
      }
    });
  } catch (error: any) {
    console.error('❌ Erro ao criar emissora catálogo:', error);
    res.status(500).json({
      message: 'Erro ao criar emissora catálogo',
      error: error.message
    });
  }
};

/**
 * GET /api/admin/catalog-broadcasters
 * Lista todas as emissoras catálogo
 */
export const getCatalogBroadcasters = async (req: AuthRequest, res: Response) => {
  try {
    const { status, search, page = 1, limit = 50, sortBy = 'createdAt', sortOrder = 'desc', onlyWithoutProducts } = req.query;

    const pageNum = Math.max(1, Number(page));
    const limitNum = Math.max(1, Number(limit));
    const skip = (pageNum - 1) * limitNum;


    const matchStage: any = {
      userType: 'broadcaster',
      isCatalogOnly: true
    };

    if (status && status !== 'all') {
      matchStage.status = status;
    }

    if (search) {
      matchStage.$or = [
        { companyName: { $regex: search, $options: 'i' } },
        { fantasyName: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
        { 'address.city': { $regex: search, $options: 'i' } }
      ];
    }

    // Pipeline de agregação inicial
    const pipeline: any[] = [{ $match: matchStage }];

    const sortByProducts = sortBy === 'products';
    const filterWithoutProducts = onlyWithoutProducts === 'true';

    // Ordenação
    let sort: any = {};
    const order = sortOrder === 'asc' ? 1 : -1;
    if (sortBy === 'name') {
      sort = { companyName: order };
    } else if (sortBy === 'date' || sortBy === 'createdAt') {
      sort = { createdAt: order };
    } else if (sortByProducts) {
      sort = { productCount: order };
    } else {
      sort = { createdAt: -1 };
    }

    // Estágios de lookup para contar produtos (mais leves)
    const lookupStages = [
      {
        $lookup: {
          from: 'products',
          localField: '_id',
          foreignField: 'broadcasterId',
          pipeline: [
            { $match: { isActive: true } },
            { $project: { _id: 1 } }
          ],
          as: 'productDocs'
        }
      },
      {
        $addFields: {
          productCount: { $size: '$productDocs' }
        }
      },
      { $project: { productDocs: 0, password: 0 } }
    ];

    let queryTotal = 0;

    // Se a ordenação/filtro depende dos produtos carregamos de tudo primeiro:
    if (sortByProducts || filterWithoutProducts) {
      pipeline.push(...lookupStages);

      if (filterWithoutProducts) {
        pipeline.push({ $match: { productCount: 0 } });
      }

      pipeline.push({ $sort: sort });

      pipeline.push({
        $facet: {
          metadata: [{ $count: 'total' }],
          data: [{ $skip: skip }, { $limit: limitNum }]
        }
      });
    } else {
      // Caso contrário, otimizamos: Pula/Limita antes de fazer o JOIN/COUNT dos produtos
      pipeline.push({ $sort: sort });

      pipeline.push({
        $facet: {
          metadata: [{ $count: 'total' }],
          data: [
            { $skip: skip },
            { $limit: limitNum },
            ...lookupStages
          ]
        }
      });
    }

    const result = await User.aggregate(pipeline);

    // Extrai resultados
    const metadata = result[0].metadata;
    const data = result[0].data;
    const total = metadata.length > 0 ? metadata[0].total : 0;


    res.json({
      broadcasters: data,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        pages: Math.ceil(total / limitNum)
      }
    });

  } catch (error: any) {
    console.error('❌ Erro ao listar emissoras catálogo:', error);
    res.status(500).json({
      message: 'Erro ao listar emissoras catálogo',
      error: error.message
    });
  }
};

/**
 * GET /api/admin/catalog-broadcasters/:id
 * Retorna detalhes de uma emissora catálogo
 */
export const getCatalogBroadcasterById = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    const broadcaster = await User.findOne({
      _id: id,
      userType: 'broadcaster',
      isCatalogOnly: true
    }).select('-password').lean();

    if (!broadcaster) {
      return res.status(404).json({ message: 'Emissora catálogo não encontrada' });
    }

    // Busca produtos da emissora
    const products = await Product.find({
      broadcasterId: id,
      isActive: true
    }).lean();

    res.json({
      broadcaster,
      products
    });
  } catch (error: any) {
    console.error('❌ Erro ao buscar emissora catálogo:', error);
    res.status(500).json({
      message: 'Erro ao buscar emissora catálogo',
      error: error.message
    });
  }
};

/**
 * PUT /api/admin/catalog-broadcasters/:id
 * Atualiza uma emissora catálogo
 */
export const updateCatalogBroadcaster = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const adminId = req.userId;

    const broadcaster = await User.findOne({
      _id: id,
      userType: 'broadcaster',
      isCatalogOnly: true
    });

    if (!broadcaster) {
      return res.status(404).json({ message: 'Emissora catálogo não encontrada' });
    }

    const {
      companyName,
      fantasyName,
      cnpj,
      phone,
      email,
      address,
      broadcasterProfile,
      status
    } = req.body;

    // Atualiza campos
    if (companyName) broadcaster.companyName = companyName;
    if (fantasyName) broadcaster.fantasyName = fantasyName;
    if (cnpj !== undefined) broadcaster.cnpj = cnpj;
    if (phone) broadcaster.phone = phone;
    if (email && email !== broadcaster.email) {
      // Verifica se novo email já existe
      const existingEmail = await User.findOne({
        email: email.toLowerCase(),
        _id: { $ne: id }
      });
      if (existingEmail) {
        return res.status(400).json({ message: 'Este email já está cadastrado' });
      }
      broadcaster.email = email.toLowerCase();

      // Gera token e envia email de confirmação para o novo email
      const confirmToken = crypto.randomBytes(32).toString('hex');
      const tokenExpires = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24h
      broadcaster.emailConfirmed = false;
      broadcaster.emailConfirmToken = confirmToken;
      broadcaster.emailConfirmTokenExpires = tokenExpires;

      await sendEmailConfirmation(
        broadcaster.email,
        broadcaster.companyName || broadcaster.fantasyName || 'Emissora',
        confirmToken
      );
    }
    if (address) {
      broadcaster.address = { ...broadcaster.address, ...address };
      // Re-geocodifica se a cidade mudou e não tem lat/lng (ou a cidade é nova)
      const updatedCity = address.city || broadcaster.address?.city;
      if (updatedCity && (!broadcaster.address?.latitude || !broadcaster.address?.longitude || address.city)) {
        const coords = await geocodeAddress(broadcaster.address);
        if (coords && broadcaster.address) {
          broadcaster.address.latitude = coords.latitude;
          broadcaster.address.longitude = coords.longitude;
        }
      }
    }
    if (broadcasterProfile) {

      // Garante que broadcasterProfile existe
      if (!broadcaster.broadcasterProfile) {
        broadcaster.broadcasterProfile = {};
      }

      // Função helper para remover undefined recursivamente de forma completa
      const removeUndefined = (obj: any): any => {
        if (obj === null || obj === undefined) return null;
        if (typeof obj !== 'object') return obj;
        if (Array.isArray(obj)) return obj;

        const cleaned: any = {};
        for (const [key, value] of Object.entries(obj)) {
          if (value !== undefined && value !== null) {
            if (typeof value === 'object' && !Array.isArray(value)) {
              const cleanedNested = removeUndefined(value);
              // Só adiciona se o objeto nested não ficou vazio
              if (cleanedNested && Object.keys(cleanedNested).length > 0) {
                cleaned[key] = cleanedNested;
              }
            } else {
              cleaned[key] = value;
            }
          }
        }
        return cleaned;
      };

      const cleanProfile = removeUndefined(broadcasterProfile);

      // Atualiza campo por campo para evitar undefined
      if (cleanProfile.generalInfo) broadcaster.broadcasterProfile.generalInfo = cleanProfile.generalInfo;
      if (cleanProfile.logo !== undefined) broadcaster.broadcasterProfile.logo = cleanProfile.logo;
      if (cleanProfile.comercialEmail !== undefined) broadcaster.broadcasterProfile.comercialEmail = cleanProfile.comercialEmail;
      if (cleanProfile.website !== undefined) broadcaster.broadcasterProfile.website = cleanProfile.website;
      if (cleanProfile.socialMedia) broadcaster.broadcasterProfile.socialMedia = cleanProfile.socialMedia;
      if (cleanProfile.categories) broadcaster.broadcasterProfile.categories = cleanProfile.categories;
      if (cleanProfile.audienceProfile) broadcaster.broadcasterProfile.audienceProfile = cleanProfile.audienceProfile;
      if (cleanProfile.coverage) broadcaster.broadcasterProfile.coverage = cleanProfile.coverage;
      if (cleanProfile.businessRules) broadcaster.broadcasterProfile.businessRules = cleanProfile.businessRules;
      if (cleanProfile.pmm !== undefined) broadcaster.broadcasterProfile.pmm = cleanProfile.pmm;
    }
    if (status) broadcaster.status = status;

    await broadcaster.save();



    res.json({
      message: 'Emissora catálogo atualizada com sucesso!',
      broadcaster: {
        id: broadcaster._id,
        companyName: broadcaster.companyName,
        fantasyName: broadcaster.fantasyName,
        email: broadcaster.email,
        phone: broadcaster.phone,
        cnpj: broadcaster.cnpj,
        address: broadcaster.address,
        broadcasterProfile: broadcaster.broadcasterProfile,
        status: broadcaster.status
      }
    });
  } catch (error: any) {
    console.error('❌ Erro ao atualizar emissora catálogo:', error);
    res.status(500).json({
      message: 'Erro ao atualizar emissora catálogo',
      error: error.message
    });
  }
};

/**
 * DELETE /api/admin/catalog-broadcasters/:id
 * Desativa uma emissora catálogo (soft delete)
 */
export const deleteCatalogBroadcaster = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    // Use findOneAndUpdate to avoid triggering full validation on legacy docs
    // that might be missing required fields on save()
    const broadcaster = await User.findOneAndUpdate(
      {
        _id: id,
        userType: 'broadcaster',
        isCatalogOnly: true
      },
      {
        $set: {
          status: 'rejected',
          rejectionReason: 'Desativada pelo administrador'
        }
      },
      { new: true }
    );

    if (!broadcaster) {
      return res.status(404).json({ message: 'Emissora catálogo não encontrada' });
    }

    // Desativa todos os produtos
    await Product.updateMany(
      { broadcasterId: id },
      { $set: { isActive: false } }
    );

    console.log(`✅ Emissora catálogo ${id} desativada com sucesso`);

    res.json({
      message: 'Emissora catálogo desativada com sucesso!'
    });
  } catch (error: any) {
    console.error('❌ Erro ao desativar emissora catálogo:', error);
    res.status(500).json({
      message: 'Erro ao desativar emissora catálogo',
      error: error.message
    });
  }
};

/**
 * POST /api/admin/catalog-broadcasters/:id/reactivate
 * Reativa uma emissora catálogo
 */
export const reactivateCatalogBroadcaster = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    const broadcaster = await User.findOne({
      _id: id,
      userType: 'broadcaster',
      isCatalogOnly: true
    });

    if (!broadcaster) {
      return res.status(404).json({ message: 'Emissora catálogo não encontrada' });
    }

    broadcaster.status = 'approved';
    broadcaster.rejectionReason = undefined;
    await broadcaster.save();



    res.json({
      message: 'Emissora catálogo reativada com sucesso!',
      broadcaster: {
        id: broadcaster._id,
        status: broadcaster.status
      }
    });
  } catch (error: any) {
    console.error('❌ Erro ao reativar emissora catálogo:', error);
    res.status(500).json({
      message: 'Erro ao reativar emissora catálogo',
      error: error.message
    });
  }
};

// ========================
// CRUD DE PRODUTOS CATÁLOGO
// ========================

/**
 * POST /api/admin/catalog-broadcasters/:broadcasterId/products
 * Cria um produto para emissora catálogo
 */
export const createCatalogProduct = async (req: AuthRequest, res: Response) => {
  try {
    const { broadcasterId } = req.params;
    const { spotType, timeSlot, pricePerInsertion } = req.body;

    // Verifica se emissora existe e é catálogo
    const broadcaster = await User.findOne({
      _id: broadcasterId,
      userType: 'broadcaster',
      isCatalogOnly: true
    });

    if (!broadcaster) {
      return res.status(404).json({
        message: 'Emissora catálogo não encontrada'
      });
    }

    // Validações
    if (!spotType || !timeSlot || pricePerInsertion === undefined) {
      return res.status(400).json({
        message: 'Campos obrigatórios: spotType, timeSlot, pricePerInsertion'
      });
    }

    // Extrai a duração do spotType (ex: "Comercial 30s" -> 30)
    const durationMatch = spotType.match(/(\d+)s/);
    const duration = durationMatch ? parseInt(durationMatch[1]) : 30;

    const product = new Product({
      broadcasterId,
      spotType,
      duration,
      timeSlot,
      pricePerInsertion: parseFloat(pricePerInsertion),
      isActive: true
    });

    await product.save();

    // Cria produtos companheiros automaticamente
    const companionRules: Record<string, Array<{ spotType: string; duration: number; multiplier: number }>> = {
      'Comercial 30s': [
        { spotType: 'Comercial 15s', duration: 15, multiplier: 0.5 },
        { spotType: 'Comercial 45s', duration: 45, multiplier: 1.5 },
        { spotType: 'Comercial 60s', duration: 60, multiplier: 2.0 }
      ],
      'Testemunhal 30s': [
        { spotType: 'Testemunhal 60s', duration: 60, multiplier: 2.0 }
      ]
    };

    const companions = companionRules[spotType] || [];
    const createdCompanions = [];
    const basePrice = parseFloat(pricePerInsertion);

    for (const comp of companions) {
      const existing = await Product.findOne({
        broadcasterId,
        spotType: comp.spotType,
        timeSlot,
        isActive: true
      });
      if (!existing) {
        const compProduct = new Product({
          broadcasterId,
          spotType: comp.spotType,
          duration: comp.duration,
          timeSlot,
          pricePerInsertion: Math.round(basePrice * comp.multiplier * 100) / 100,
          isActive: true
        });
        await compProduct.save();
        createdCompanions.push(compProduct);
      }
    }

    res.status(201).json({
      message: 'Produto criado com sucesso!',
      product,
      companionsCreated: createdCompanions
    });
  } catch (error: any) {
    console.error('❌ Erro ao criar produto catálogo:', error);
    res.status(500).json({
      message: 'Erro ao criar produto',
      error: error.message
    });
  }
};

/**
 * GET /api/admin/catalog-broadcasters/:broadcasterId/products
 * Lista produtos de uma emissora catálogo
 */
export const getCatalogProducts = async (req: AuthRequest, res: Response) => {
  try {
    const { broadcasterId } = req.params;
    const { includeInactive } = req.query;

    // Verifica se emissora existe e é catálogo
    const broadcaster = await User.findOne({
      _id: broadcasterId,
      userType: 'broadcaster',
      isCatalogOnly: true
    });

    if (!broadcaster) {
      return res.status(404).json({
        message: 'Emissora catálogo não encontrada'
      });
    }

    const filter: any = { broadcasterId };
    if (!includeInactive) {
      filter.isActive = true;
    }

    const products = await Product.find(filter).sort({ createdAt: -1 }).lean();

    res.json({
      broadcaster: {
        id: broadcaster._id,
        companyName: broadcaster.companyName
      },
      products
    });
  } catch (error: any) {
    console.error('❌ Erro ao listar produtos catálogo:', error);
    res.status(500).json({
      message: 'Erro ao listar produtos',
      error: error.message
    });
  }
};

/**
 * PUT /api/admin/catalog-products/:productId
 * Atualiza um produto de emissora catálogo
 */
export const updateCatalogProduct = async (req: AuthRequest, res: Response) => {
  try {
    const { productId } = req.params;
    const { spotType, timeSlot, pricePerInsertion, isActive } = req.body;

    const product = await Product.findById(productId);
    if (!product) {
      return res.status(404).json({ message: 'Produto não encontrado' });
    }

    // Verifica se pertence a emissora catálogo
    const broadcaster = await User.findOne({
      _id: product.broadcasterId,
      isCatalogOnly: true
    });

    if (!broadcaster) {
      return res.status(403).json({
        message: 'Este produto não pertence a uma emissora catálogo'
      });
    }

    // Atualiza campos
    if (spotType) {
      product.spotType = spotType;
      const durationMatch = spotType.match(/(\d+)s/);
      product.duration = durationMatch ? parseInt(durationMatch[1]) : 30;
    }
    if (timeSlot) product.timeSlot = timeSlot;
    if (pricePerInsertion !== undefined) {
      product.pricePerInsertion = parseFloat(pricePerInsertion);
    }
    if (isActive !== undefined) product.isActive = isActive;

    await product.save();



    res.json({
      message: 'Produto atualizado com sucesso!',
      product
    });
  } catch (error: any) {
    console.error('❌ Erro ao atualizar produto catálogo:', error);
    res.status(500).json({
      message: 'Erro ao atualizar produto',
      error: error.message
    });
  }
};

/**
 * DELETE /api/admin/catalog-products/:productId
 * Remove um produto de emissora catálogo
 */
export const deleteCatalogProduct = async (req: AuthRequest, res: Response) => {
  try {
    const { productId } = req.params;

    const product = await Product.findById(productId);
    if (!product) {
      return res.status(404).json({ message: 'Produto não encontrado' });
    }

    // Verifica se pertence a emissora catálogo
    const broadcaster = await User.findOne({
      _id: product.broadcasterId,
      isCatalogOnly: true
    });

    if (!broadcaster) {
      return res.status(403).json({
        message: 'Este produto não pertence a uma emissora catálogo'
      });
    }

    await Product.findByIdAndDelete(productId);



    res.json({
      message: 'Produto deletado com sucesso!'
    });
  } catch (error: any) {
    console.error('❌ Erro ao deletar produto catálogo:', error);
    res.status(500).json({
      message: 'Erro ao deletar produto',
      error: error.message
    });
  }
};

// ========================
// ONBOARDING COMPLETO
// ========================

/**
 * POST /api/admin/catalog-broadcasters/:id/complete-profile
 * Completa/atualiza o perfil completo (onboarding) de uma emissora catálogo
 */
export const completeCatalogProfile = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { broadcasterProfile } = req.body;

    const broadcaster = await User.findOne({
      _id: id,
      userType: 'broadcaster',
      isCatalogOnly: true
    });

    if (!broadcaster) {
      return res.status(404).json({ message: 'Emissora catálogo não encontrada' });
    }

    // Atualiza perfil completo
    broadcaster.broadcasterProfile = {
      ...broadcaster.broadcasterProfile,
      ...broadcasterProfile
    };
    broadcaster.onboardingCompleted = true;

    await broadcaster.save();



    res.json({
      message: 'Perfil atualizado com sucesso!',
      broadcaster: {
        id: broadcaster._id,
        broadcasterProfile: broadcaster.broadcasterProfile,
        onboardingCompleted: true
      }
    });
  } catch (error: any) {
    console.error('❌ Erro ao completar perfil catálogo:', error);
    res.status(500).json({
      message: 'Erro ao completar perfil',
      error: error.message
    });
  }
};

/**
 * POST /api/admin/catalog-broadcasters/:id/upload-logo
 * Upload de logo para emissora catálogo
 */
export const uploadCatalogLogo = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const file = req.file;

    if (!file) {
      return res.status(400).json({ message: 'Nenhum arquivo enviado' });
    }

    const broadcaster = await User.findOne({
      _id: id,
      userType: 'broadcaster',
      isCatalogOnly: true
    });

    if (!broadcaster) {
      return res.status(404).json({ message: 'Emissora catálogo não encontrada' });
    }

    // Faz upload do logo
    const logoUrl = await uploadFile(
      file.buffer,
      file.originalname,
      'logos',
      file.mimetype
    );

    // Atualiza no perfil
    if (!broadcaster.broadcasterProfile) {
      broadcaster.broadcasterProfile = {};
    }
    broadcaster.broadcasterProfile.logo = logoUrl;
    await broadcaster.save();



    res.json({
      message: 'Logo enviado com sucesso!',
      logoUrl
    });
  } catch (error: any) {
    console.error('❌ Erro ao enviar logo catálogo:', error);
    res.status(500).json({
      message: 'Erro ao enviar logo',
      error: error.message
    });
  }
};

// ========================
// OPEC - COMPROVANTE DE VEICULAÇÃO
// ========================

// Importar Order model (adicionar no topo se necessário)
import Order from '../models/Order';

/**
 * POST /api/admin/orders/:orderId/opec
 * Upload de OPEC (comprovante de veiculação) para pedidos de emissoras catálogo
 * Admin faz upload do OPEC que a emissora enviou para ele (por fora)
 */
export const uploadOpec = async (req: AuthRequest, res: Response) => {
  try {
    const adminId = req.userId;
    const { orderId } = req.params;
    const { broadcasterId, description, startDate, endDate } = req.body;
    const file = req.file;

    // Verifica se é admin
    const admin = await User.findById(adminId);
    if (!admin || admin.userType !== 'admin') {
      return res.status(403).json({ message: 'Acesso negado. Apenas administradores.' });
    }

    if (!file) {
      return res.status(400).json({ message: 'Arquivo OPEC é obrigatório' });
    }

    // Busca pedido
    const order = await Order.findById(orderId);
    if (!order) {
      return res.status(404).json({ message: 'Pedido não encontrado' });
    }

    // Busca emissora
    const broadcaster = await User.findById(broadcasterId);
    if (!broadcaster) {
      return res.status(404).json({ message: 'Emissora não encontrada' });
    }

    // Verifica se a emissora faz parte do pedido
    const hasItemFromBroadcaster = order.items.some(item => item.broadcasterId === broadcasterId);
    if (!hasItemFromBroadcaster) {
      return res.status(400).json({ message: 'Esta emissora não faz parte deste pedido' });
    }



    // Faz upload do arquivo
    const fileUrl = await uploadFile(
      file.buffer,
      file.originalname,
      'opec',
      file.mimetype
    );

    // Inicializa array se não existir
    if (!order.opecs) {
      order.opecs = [];
    }

    // Adiciona OPEC ao pedido
    const opecData = {
      broadcasterId,
      broadcasterName: broadcaster.broadcasterProfile?.generalInfo?.stationName || broadcaster.companyName || 'Emissora',
      fileName: file.originalname,
      fileUrl,
      fileSize: file.size,
      uploadedBy: 'admin' as const,
      uploadedAt: new Date(),
      veiculationPeriod: startDate && endDate ? {
        startDate: new Date(startDate),
        endDate: new Date(endDate)
      } : undefined,
      description
    };

    order.opecs.push(opecData);
    await order.save();



    // TODO: Enviar notificação para o cliente

    res.json({
      message: 'OPEC enviado com sucesso!',
      opec: opecData
    });
  } catch (error: any) {
    console.error('❌ Erro ao enviar OPEC:', error);
    res.status(500).json({
      message: 'Erro ao enviar OPEC',
      error: error.message
    });
  }
};

/**
 * GET /api/admin/orders/:orderId/opec
 * Lista todos os OPECs de um pedido
 */
export const getOrderOpecs = async (req: AuthRequest, res: Response) => {
  try {
    const adminId = req.userId;
    const { orderId } = req.params;

    // Verifica se é admin
    const admin = await User.findById(adminId);
    if (!admin || admin.userType !== 'admin') {
      return res.status(403).json({ message: 'Acesso negado. Apenas administradores.' });
    }

    const order = await Order.findById(orderId).select('orderNumber items opecs status');
    if (!order) {
      return res.status(404).json({ message: 'Pedido não encontrado' });
    }

    res.json({
      orderNumber: order.orderNumber,
      status: order.status,
      opecs: order.opecs || [],
      broadcasters: order.items.map(item => ({
        broadcasterId: item.broadcasterId,
        broadcasterName: item.broadcasterName,
        hasOpec: (order.opecs || []).some(opec => opec.broadcasterId === item.broadcasterId)
      }))
    });
  } catch (error: any) {
    console.error('❌ Erro ao listar OPECs:', error);
    res.status(500).json({
      message: 'Erro ao listar OPECs',
      error: error.message
    });
  }
};

/**
 * DELETE /api/admin/orders/:orderId/opec/:opecId
 * Remove um OPEC específico
 */
export const deleteOpec = async (req: AuthRequest, res: Response) => {
  try {
    const adminId = req.userId;
    const { orderId, opecId } = req.params;

    // Verifica se é admin
    const admin = await User.findById(adminId);
    if (!admin || admin.userType !== 'admin') {
      return res.status(403).json({ message: 'Acesso negado. Apenas administradores.' });
    }

    const order = await Order.findById(orderId);
    if (!order) {
      return res.status(404).json({ message: 'Pedido não encontrado' });
    }

    // Filtra para remover o OPEC
    const initialLength = (order.opecs || []).length;
    order.opecs = (order.opecs || []).filter((opec: any) => opec._id.toString() !== opecId);

    if ((order.opecs || []).length === initialLength) {
      return res.status(404).json({ message: 'OPEC não encontrado' });
    }

    await order.save();


    res.json({ message: 'OPEC removido com sucesso' });
  } catch (error: any) {
    console.error('❌ Erro ao remover OPEC:', error);
    res.status(500).json({
      message: 'Erro ao remover OPEC',
      error: error.message
    });
  }
};

/**
 * GET /api/admin/catalog-orders
 * Lista pedidos de emissoras catálogo para gerenciamento de OPEC
 */
export const getCatalogOrders = async (req: AuthRequest, res: Response) => {
  try {
    // Admin já validado pelo middleware authenticateToken + isAdmin

    const page = parseInt(req.query.page as string) || 1;
    const limitNum = parseInt(req.query.limit as string) || 200;
    const skip = (page - 1) * limitNum;

    // Busca IDs de emissoras catálogo (lean para performance)
    const catalogBroadcasters = await User.find({
      userType: 'broadcaster',
      isCatalogOnly: true
    }).select('_id').lean();

    const catalogIds = catalogBroadcasters.map(b => b._id.toString());

    const orderFilter = {
      'items.broadcasterId': { $in: catalogIds },
      status: { $in: ['approved', 'scheduled', 'in_progress', 'completed'] }
    };

    // Paraleliza count + find com .lean() e paginação
    const [total, orders] = await Promise.all([
      Order.countDocuments(orderFilter),
      Order.find(orderFilter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .select('orderNumber buyerName status items opecs createdAt')
        .lean()
    ]);

    // Set para lookup O(1) ao invés de Array.includes O(n)
    const catalogIdSet = new Set(catalogIds);

    const ordersWithOpecInfo = orders.map(order => {
      const catalogItems = order.items.filter(item => catalogIdSet.has(item.broadcasterId));
      const orderOpecs = order.opecs || [];
      const opecBroadcasterIds = new Set(orderOpecs.map(opec => opec.broadcasterId));
      const opecCount = orderOpecs.length;
      const pendingOpecs = catalogItems.filter(item =>
        !opecBroadcasterIds.has(item.broadcasterId)
      ).length;

      return {
        _id: order._id,
        orderNumber: order.orderNumber,
        buyerName: order.buyerName,
        status: order.status,
        createdAt: order.createdAt,
        catalogBroadcasters: catalogItems.map(item => ({
          broadcasterId: item.broadcasterId,
          broadcasterName: item.broadcasterName,
          hasOpec: opecBroadcasterIds.has(item.broadcasterId)
        })),
        opecCount,
        pendingOpecs
      };
    });

    res.json({
      orders: ordersWithOpecInfo,
      total,
      page,
      totalPages: Math.ceil(total / limitNum),
      hasMore: page * limitNum < total
    });
  } catch (error: any) {
    console.error('❌ Erro ao listar pedidos catálogo:', error);
    res.status(500).json({
      message: 'Erro ao listar pedidos',
      error: error.message
    });
  }
};
