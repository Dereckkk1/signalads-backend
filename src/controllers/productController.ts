import { Response } from 'express';
import { Product, PLATFORM_COMMISSION_RATE } from '../models/Product';
import { User } from '../models/User';
import { AuthRequest } from '../middleware/auth';
import { toAccentInsensitiveRegex } from '../utils/stringUtils';
import { cacheGet, cacheSet, cacheInvalidate } from '../config/redis';
import crypto from 'crypto';
import NodeGeocoder from 'node-geocoder';

/**
 * Gera cache key normalizada: ordena keys e arrays, gera hash curto.
 * Garante que mesmos parametros em ordem diferente resultem na mesma key.
 * Remove valores undefined/null para evitar keys desnecessarias.
 */
function buildCacheKey(prefix: string, params: Record<string, any>): string {
  const normalized: Record<string, any> = {};
  for (const key of Object.keys(params).sort()) {
    const val = params[key];
    if (val === undefined || val === null || val === '') continue;
    if (Array.isArray(val)) {
      normalized[key] = [...val].sort();
    } else {
      normalized[key] = val;
    }
  }
  const hash = crypto.createHash('md5').update(JSON.stringify(normalized)).digest('hex').slice(0, 12);
  return `${prefix}:${hash}`;
}
const options: NodeGeocoder.Options = {
  provider: 'openstreetmap'
};
const geocoder = NodeGeocoder(options);

// Cache de geocoding via Redis (TTL: 24h, persistente, compartilhado entre workers)
async function getCachedGeocode(query: string) {
  const cacheKey = `geo:${query}`;
  const cached = await cacheGet<any[]>(cacheKey);
  if (cached) return cached;

  const result = await geocoder.geocode(query);
  await cacheSet(cacheKey, result, 86400); // 24h
  return result;
}

async function getCachedReverseGeocode(lat: number, lng: number) {
  const cacheKey = `geo:rev:${lat.toFixed(4)}:${lng.toFixed(4)}`;
  const cached = await cacheGet<any[]>(cacheKey);
  if (cached) return cached;

  const result = await geocoder.reverse({ lat, lon: lng });
  await cacheSet(cacheKey, result, 86400); // 24h
  return result;
}

// Função para calcular distância entre duas coordenadas usando fórmula de Haversine
function getDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371; // Raio da Terra em km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c; // Distância em km
}

// Listar produtos da emissora (broadcaster) ou produtos de qualquer emissora (admin)
export const getMyProducts = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!req.userId) {
      res.status(401).json({ error: 'Usuário não autenticado' });
      return;
    }

    const user = await User.findById(req.userId);

    if (!user) {
      res.status(401).json({ error: 'Usuário não encontrado' });
      return;
    }

    // Admin pode listar produtos de emissora específica via query param
    const { broadcasterId } = req.query;

    let query: any;

    if (user.userType === 'admin' && broadcasterId) {
      // Admin listando produtos de uma emissora específica
      query = { broadcasterId: broadcasterId as string };
    } else if (user.userType === 'broadcaster') {
      // Broadcaster listando seus próprios produtos
      query = { broadcasterId: req.userId };
    } else if (user.userType === 'admin' && !broadcasterId) {
      // Admin listando todos os produtos
      query = {};
    } else {
      res.status(403).json({ error: 'Apenas administradores e emissoras podem listar produtos' });
      return;
    }

    const products = await Product.find(query)
      .populate('broadcasterId', 'companyName email')
      .sort({ createdAt: -1 });

    res.json(products);
  } catch (error) {
    res.status(500).json({ error: 'Erro ao buscar produtos' });
  }
};

// Retorna produtos companheiros a serem criados automaticamente com base no spotType/preço
function getCompanionProducts(spotType: string, basePrice: number, timeSlot: string) {
  const companions: Array<{ spotType: string; duration: number; timeSlot: string; price: number }> = [];

  if (spotType === 'Comercial 30s') {
    companions.push(
      { spotType: 'Comercial 15s', duration: 15, timeSlot, price: Math.round(basePrice * 0.75 * 100) / 100 },
      { spotType: 'Comercial 45s', duration: 45, timeSlot, price: Math.round(basePrice * 1.5 * 100) / 100 },
      { spotType: 'Comercial 60s', duration: 60, timeSlot, price: Math.round(basePrice * 2.0 * 100) / 100 }
    );
  } else if (spotType === 'Testemunhal 30s') {
    companions.push(
      { spotType: 'Testemunhal 60s', duration: 60, timeSlot, price: Math.round(basePrice * 2.0 * 100) / 100 }
    );
  }

  return companions;
}

// Criar novo produto (Broadcaster ou Admin)
export const createProduct = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { spotType, timeSlot, pricePerInsertion, netPrice, broadcasterId } = req.body;

    const user = await User.findById(req.userId);

    // Permite broadcaster OU admin
    if (!user || (user.userType !== 'broadcaster' && user.userType !== 'admin')) {
      res.status(403).json({ error: 'Apenas emissoras e administradores podem cadastrar produtos' });
      return;
    }

    // Determina o ID da emissora alvo
    let targetBroadcasterId: string;

    if (user.userType === 'broadcaster') {
      // Broadcaster cria para si mesmo
      if (!req.userId) {
        res.status(401).json({ error: 'Usuário não autenticado' });
        return;
      }
      targetBroadcasterId = req.userId;
    } else {
      // Admin precisa informar a emissora
      if (!broadcasterId) {
        res.status(400).json({ error: 'ID da emissora é obrigatório para administradores' });
        return;
      }
      targetBroadcasterId = broadcasterId;
    }

    // Valida se a emissora alvo existe e é do tipo broadcaster
    const broadcaster = await User.findById(targetBroadcasterId);
    if (!broadcaster || broadcaster.userType !== 'broadcaster') {
      res.status(404).json({ error: 'Emissora não encontrada ou ID inválido' });
      return;
    }

    // Aceita netPrice (preço líquido) ou pricePerInsertion (legado/admin)
    const inputNetPrice = netPrice ? parseFloat(netPrice) : null;
    const inputPrice = pricePerInsertion ? parseFloat(pricePerInsertion) : null;

    if (!spotType || !timeSlot || (!inputNetPrice && !inputPrice)) {
      res.status(400).json({ error: 'spotType, timeSlot e netPrice (ou pricePerInsertion) são obrigatórios' });
      return;
    }

    // Se veio netPrice, calcula pricePerInsertion. Se veio apenas pricePerInsertion (admin/legado), calcula netPrice.
    const finalNetPrice = inputNetPrice || Math.round((inputPrice! / (1 + PLATFORM_COMMISSION_RATE)) * 100) / 100;
    const finalPrice = inputNetPrice
      ? Math.round(inputNetPrice * (1 + PLATFORM_COMMISSION_RATE) * 100) / 100
      : inputPrice!;

    // Extrai a duração do spotType (ex: "Comercial 30s" -> 30)
    const durationMatch = spotType.match(/(\d+)s/);
    const duration = durationMatch ? parseInt(durationMatch[1]) : 30;

    const product = new Product({
      broadcasterId: targetBroadcasterId,
      spotType,
      duration,
      timeSlot,
      netPrice: finalNetPrice,
      pricePerInsertion: finalPrice
    });

    await product.save();

    // Cria produtos companheiros automaticamente (ex: Comercial 30s → 15s, 45s, 60s)
    const companions = getCompanionProducts(spotType, finalNetPrice, timeSlot);
    const createdCompanions = [];
    for (const comp of companions) {
      const existing = await Product.findOne({
        broadcasterId: targetBroadcasterId,
        spotType: comp.spotType,
        timeSlot: comp.timeSlot,
        isActive: true
      });
      if (!existing) {
        const compProduct = new Product({
          broadcasterId: targetBroadcasterId,
          spotType: comp.spotType,
          duration: comp.duration,
          timeSlot: comp.timeSlot,
          netPrice: comp.price,
          pricePerInsertion: Math.round(comp.price * (1 + PLATFORM_COMMISSION_RATE) * 100) / 100
        });
        await compProduct.save();
        createdCompanions.push(compProduct);
      }
    }

    // Invalida caches que dependem de produtos/emissoras
    await Promise.all([
      cacheInvalidate('marketplace:*'),
      cacheInvalidate('map:*'),
      cacheInvalidate('compare:*'),
    ]);

    res.status(201).json({
      message: 'Produto cadastrado com sucesso!',
      product,
      companionsCreated: createdCompanions
    });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao criar produto' });
  }
};

// Atualizar produto (Broadcaster ou Admin)
export const updateProduct = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!req.userId) {
      res.status(401).json({ error: 'Usuário não autenticado' });
      return;
    }

    const user = await User.findById(req.userId);

    // Permite broadcaster OU admin
    if (!user || (user.userType !== 'broadcaster' && user.userType !== 'admin')) {
      res.status(403).json({ error: 'Apenas emissoras e administradores podem atualizar produtos' });
      return;
    }

    const { productId } = req.params;

    if (!productId) {
      res.status(400).json({ error: 'ID do produto não fornecido' });
      return;
    }

    let query: any = { _id: productId };

    // Se é broadcaster, só pode atualizar seus próprios produtos
    if (user.userType === 'broadcaster') {
      query.broadcasterId = req.userId;
    }

    const { spotType, timeSlot, pricePerInsertion, netPrice, isActive } = req.body;

    const product = await Product.findOne(query);

    if (!product) {
      res.status(404).json({ error: 'Produto não encontrado' });
      return;
    }

    if (spotType) {
      product.spotType = spotType;
      const durationMatch = spotType.match(/(\d+)s/);
      product.duration = durationMatch && durationMatch[1] ? parseInt(durationMatch[1], 10) : 30;
    } else {
      if (!product.duration) {
        const durationMatch = product.spotType.match(/(\d+)s/);
        product.duration = durationMatch && durationMatch[1] ? parseInt(durationMatch[1], 10) : 30;
      }
    }
    if (timeSlot) product.timeSlot = timeSlot;

    // Prioridade: netPrice (emissora) → pricePerInsertion (admin/legado)
    if (netPrice !== undefined) {
      product.netPrice = parseFloat(netPrice);
      product.pricePerInsertion = Math.round(parseFloat(netPrice) * (1 + PLATFORM_COMMISSION_RATE) * 100) / 100;
    } else if (pricePerInsertion !== undefined) {
      product.pricePerInsertion = parseFloat(pricePerInsertion);
      product.netPrice = Math.round(parseFloat(pricePerInsertion) / (1 + PLATFORM_COMMISSION_RATE) * 100) / 100;
    }

    if (isActive !== undefined) product.isActive = isActive;

    await product.save();

    // Invalida caches que dependem de produtos/emissoras
    await Promise.all([
      cacheInvalidate('marketplace:*'),
      cacheInvalidate('map:*'),
      cacheInvalidate('compare:*'),
    ]);

    res.json({
      message: 'Produto atualizado com sucesso!',
      product
    });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao atualizar produto' });
  }
};

// Deletar produto (Broadcaster ou Admin)
export const deleteProduct = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!req.userId) {
      res.status(401).json({ error: 'Usuário não autenticado' });
      return;
    }

    const user = await User.findById(req.userId);

    // Permite broadcaster OU admin
    if (!user || (user.userType !== 'broadcaster' && user.userType !== 'admin')) {
      res.status(403).json({ error: 'Apenas emissoras e administradores podem deletar produtos' });
      return;
    }

    const { productId } = req.params;

    if (!productId) {
      res.status(400).json({ error: 'ID do produto não fornecido' });
      return;
    }

    let query: any = { _id: productId };

    // Se é broadcaster, só pode deletar seus próprios produtos
    if (user.userType === 'broadcaster') {
      query.broadcasterId = req.userId;
    }

    const product = await Product.findOneAndDelete(query);

    if (!product) {
      res.status(404).json({ error: 'Produto não encontrado' });
      return;
    }

    // Invalida caches que dependem de produtos/emissoras
    await Promise.all([
      cacheInvalidate('marketplace:*'),
      cacheInvalidate('map:*'),
      cacheInvalidate('compare:*'),
    ]);

    res.json({ message: 'Produto deletado com sucesso!' });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao deletar produto' });
  }
};

// Listar todos os produtos ativos (para o Marketplace) - COM PAGINAÇÃO POR EMISSORA
export const getAllActiveProducts = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 25;
    const skip = (page - 1) * limit;
    const search = (req.query.search as string) || '';

    // Cache Redis (TTL 30s) — cache key normalizada para maximizar hit rate
    const cacheKey = buildCacheKey('marketplace', {
      page, limit, city: req.query.city, search: req.query.search,
      priceMin: req.query.priceMin, priceMax: req.query.priceMax,
      ageRanges: req.query.ageRanges, genders: req.query.genders,
      socialClasses: req.query.socialClasses,
      lat: req.query.lat, lng: req.query.lng,
    });

    const cached = await cacheGet(cacheKey);
    if (cached) {
      res.json(cached);
      return;
    }

    // PASSO 1: Filtro de Preço (nos Produtos)
    // null = sem filtro de preço (mostra todas as emissoras, inclusive sem produtos)
    let priceFilteredBroadcasterIds: any[] | null = null;
    const priceMin = req.query.priceMin ? parseFloat(req.query.priceMin as string) : null;
    const priceMax = req.query.priceMax ? parseFloat(req.query.priceMax as string) : null;

    if (priceMin !== null || priceMax !== null) {
      const priceQuery: any = { isActive: true };
      if (priceMin !== null) priceQuery.pricePerInsertion = { ...priceQuery.pricePerInsertion, $gte: priceMin };
      if (priceMax !== null) priceQuery.pricePerInsertion = { ...priceQuery.pricePerInsertion, $lte: priceMax };

      priceFilteredBroadcasterIds = await Product.distinct('broadcasterId', priceQuery);
      // Se não achou ninguém com esse preço, retorna vazio
      if (priceFilteredBroadcasterIds.length === 0) {
        res.json({ products: [], pagination: { currentPage: page, totalPages: 0, totalItems: 0, itemsPerPage: limit, hasNextPage: false, hasPrevPage: false } });
        return;
      }
    }
    // Se não há filtro de preço, priceFilteredBroadcasterIds = null → mostra TODAS as emissoras aprovadas

    // PASSO 2: Query de Broadcasters (Filtros de Perfil)
    let broadcasterQuery: any = {
      userType: 'broadcaster',
      status: 'approved' // Apenas emissoras aprovadas aparecem no marketplace
    };

    // Se há filtro de preço, restringe a emissoras que têm produtos nesse range
    if (priceFilteredBroadcasterIds !== null) {
      broadcasterQuery._id = { $in: priceFilteredBroadcasterIds };
    }

    // Filtro de Cidade (Insensível a acentos)
    if (req.query.city) {
      broadcasterQuery['address.city'] = toAccentInsensitiveRegex(req.query.city as string);
    }

    // Filtros de Audiência (JSON parse necessário)
    try {
      if (req.query.ageRanges) {
        const ageRanges = JSON.parse(req.query.ageRanges as string);
        if (Array.isArray(ageRanges) && ageRanges.length > 0) {
          // Mapeamento de faixas etárias para regex
          // Se o usuário seleciona "18+", queremos encontrar qualquer emissora que tenha público 18+, 20+, 25+, etc.
          const ageMap: Record<string, string[]> = {
            '18+': ['18+', '20+', '25+', '30+', '35+', '40+', '45+', '50+', '55+', '60+', '65+'],
            '25+': ['25+', '30+', '35+', '40+', '45+', '50+', '55+', '60+', '65+'],
            '30+': ['30+', '35+', '40+', '45+', '50+', '55+', '60+', '65+'],
            '35+': ['35+', '40+', '45+', '50+', '55+', '60+', '65+'],
            '40+': ['40+', '45+', '50+', '55+', '60+', '65+'],
            '50+': ['50+', '55+', '60+', '65+'],
            '60+': ['60+', '65+']
          };

          const valuesToMatch = new Set<string>();
          ageRanges.forEach((range: string) => {
            const matches = ageMap[range];
            if (matches) {
              matches.forEach(m => valuesToMatch.add(m));
            } else {
              // Fallback para valor exato (ex: "Livre" ou formato desconhecido)
              valuesToMatch.add(range);
            }
          });

          // Cria regex: "18+|20+|25+..."
          // Escapa o + para o regex
          const regexPattern = Array.from(valuesToMatch)
            .map(v => v.replace('+', '\\+'))
            .join('|');

          broadcasterQuery['broadcasterProfile.audienceProfile.ageRange'] = {
            $regex: regexPattern,
            $options: 'i'
          };
        }
      }

      /*
      // NOTA: Filtros de exclusão removidos a pedido do cliente.
      // Agora a seleção de Gênero e Classe Social apenas REORDENA os resultados (ver lógica de sort abaixo),
      // mas não exclui ninguém da lista.
      
      if (req.query.genders) {
        // Lógica de filtro removida
      }

      if (req.query.socialClasses) {
        // Lógica de filtro removida
      }
      */
    } catch (e) {
      // JSON parse error silenced
    }

    // Busca textual com suporte a múltiplos termos concatenados
    // Ex: "fm o dia 100.5 rio" → cada termo deve dar match em algum campo (AND entre termos, OR entre campos)
    if (search && search.length >= 2) {
      const searchFields = [
        'companyName',
        'broadcasterProfile.generalInfo.stationName',
        'broadcasterProfile.generalInfo.dialFrequency',
        'address.city'
      ];

      // Quebra em tokens e filtra tokens muito curtos (1 char) exceto números
      const tokens = search.trim().split(/\s+/).filter(t => t.length >= 2 || /\d/.test(t));

      if (tokens.length > 0) {
        broadcasterQuery.$and = broadcasterQuery.$and || [];

        // Cada token precisa dar match em pelo menos um campo
        for (const token of tokens) {
          const tokenRegex = toAccentInsensitiveRegex(token);
          broadcasterQuery.$and.push({
            $or: searchFields.map(field => ({ [field]: tokenRegex }))
          });
        }
      }
    }

    // Inicia countDocuments em paralelo com geocoding (ambos são independentes)
    const countPromise = User.countDocuments(broadcasterQuery);

    // Definição de Ordenação Dinâmica
    let sortOptions: any = {};

    // Parseia filtros de target para uso tanto no sort do banco quanto no sort por proximidade
    let targetGender: string | null = null;
    let targetSocialClass: string | null = null;

    // Prioridade 1: Classe Social
    try {
      if (req.query.socialClasses) {
        const socialClasses = JSON.parse(req.query.socialClasses as string);
        if (Array.isArray(socialClasses) && socialClasses.length > 0) {
          targetSocialClass = socialClasses[0];
          if (targetSocialClass === 'AB') sortOptions['broadcasterProfile.audienceProfile.socialClass.classeAB'] = -1;
          if (targetSocialClass === 'C') sortOptions['broadcasterProfile.audienceProfile.socialClass.classeC'] = -1;
          if (targetSocialClass === 'DE') sortOptions['broadcasterProfile.audienceProfile.socialClass.classeDE'] = -1;
        }
      }
    } catch (e) { /* parse error */ }

    // Prioridade 2: Gênero
    try {
      if (req.query.genders) {
        const genders = JSON.parse(req.query.genders as string);
        if (Array.isArray(genders) && genders.length > 0) {
          targetGender = genders[0];
          if (targetGender === 'male') sortOptions['broadcasterProfile.audienceProfile.gender.male'] = -1;
          if (targetGender === 'female') sortOptions['broadcasterProfile.audienceProfile.gender.female'] = -1;
        }
      }
    } catch (e) { /* parse error */ }

    const hasTargetFilters = targetGender !== null || targetSocialClass !== null;

    // Helper: calcula score de match com target (0-200, maior = melhor)
    const getTargetScore = (b: any): number => {
      let score = 0;
      if (targetGender) {
        score += b.broadcasterProfile?.audienceProfile?.gender?.[targetGender] || 0;
      }
      if (targetSocialClass) {
        const classField = targetSocialClass === 'AB' ? 'classeAB' : targetSocialClass === 'C' ? 'classeC' : 'classeDE';
        score += b.broadcasterProfile?.audienceProfile?.socialClass?.[classField] || 0;
      }
      return score;
    };

    // Fallbacks (Padrão)
    sortOptions['broadcasterProfile.pmm'] = -1;
    sortOptions['createdAt'] = -1;

    let userLat = req.query.lat ? parseFloat(req.query.lat as string) : null;
    let userLng = req.query.lng ? parseFloat(req.query.lng as string) : null;
    let userCity: string | null = null;

    // Se as coordenadas não vieram na query (navegador bloqueado/não autorizado) 
    // e o usuário estiver logado, buscar do banco de dados (endereço de registro)
    if (req.userId && (userLat === null || userLng === null || Number.isNaN(userLat) || Number.isNaN(userLng))) {
      try {
        const loggedUser = await User.findById(req.userId).select('address').lean();
        if (loggedUser && loggedUser.address) {
          if (loggedUser.address.latitude && loggedUser.address.longitude) {
            userLat = loggedUser.address.latitude;
            userLng = loggedUser.address.longitude;
          } else if (loggedUser.address.city && loggedUser.address.state) {
            // Se o usuário não tem lat/lng, mas tem cidade, tentamos geocodificar a cidade dele!
            const resData = await getCachedGeocode(`${loggedUser.address.city}, ${loggedUser.address.state}, Brasil`);
            if (resData && resData.length > 0 && resData[0]) {
              userLat = resData[0].latitude || null;
              userLng = resData[0].longitude || null;
            }
          }
          if (loggedUser.address.city) {
            userCity = loggedUser.address.city;
          }
        }
      } catch (err) {
        // Geocoding error silenced
      }
    }

    // Se temos coordenadas mas não temos cidade, tenta obter via geocoding reverso ANTES de ordenar
    if ((userLat !== null && userLng !== null && !Number.isNaN(userLat) && !Number.isNaN(userLng)) && !userCity) {
      try {
        const reverseResult = await getCachedReverseGeocode(userLat, userLng);
        if (reverseResult && reverseResult.length > 0 && reverseResult[0]) {
          userCity = reverseResult[0].city || (reverseResult[0].administrativeLevels && reverseResult[0].administrativeLevels.level2long) || null;
        }
      } catch (err) {
        // Geocoding reverso falhou, segue sem cidade
      }
    }

    // Aguarda countDocuments (já estava rodando em paralelo com geocoding)
    const totalBroadcasters = await countPromise;
    const totalPages = Math.ceil(totalBroadcasters / limit);

    let paginatedBroadcasters;
    let proximitySortApplied = false;

    const hasValidCoords = userLat !== null && userLng !== null && !Number.isNaN(userLat) && !Number.isNaN(userLng);

    if (hasValidCoords && !req.query.city) {
      try {
        // Busca emissoras que batem com os filtros para ordenar em memória por proximidade
        // Limita a 3000 para evitar OOM em datasets grandes — cobre 99% dos cenários reais
        const selectFields = hasTargetFilters
          ? '_id address.city address.latitude address.longitude broadcasterProfile.pmm broadcasterProfile.audienceProfile.gender broadcasterProfile.audienceProfile.socialClass companyName'
          : '_id address.city address.latitude address.longitude broadcasterProfile.pmm companyName';
        const allMatching = await User.find(broadcasterQuery)
          .select(selectFields)
          .limit(3000)
          .lean();

        const normalizeCityStr = (city?: string) => {
          if (!city) return '';
          return city
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .toLowerCase()
            .trim()
            .replace(/\s+/g, ' ');
        };
        const normalizedUserCity = normalizeCityStr(userCity || '');

        // Pré-calcula distância de cada emissora (evita recalcular durante o sort)
        const distanceCache = new Map<string, number>();
        const safeUserLat = userLat as number;
        const safeUserLng = userLng as number;

        allMatching.forEach((b: any) => {
          const bLat = b.address?.latitude;
          const bLng = b.address?.longitude;
          if (bLat != null && bLng != null && typeof bLat === 'number' && typeof bLng === 'number') {
            distanceCache.set(b._id.toString(), getDistance(safeUserLat, safeUserLng, bLat, bLng));
          }
        });

        // Ordena: mesma cidade primeiro, depois por distância crescente
        // Quando filtros de target estão ativos, target score tem prioridade sobre distância
        allMatching.sort((a: any, b: any) => {
          const aCity = normalizeCityStr(a.address?.city);
          const bCity = normalizeCityStr(b.address?.city);
          const pmmA = a.broadcasterProfile?.pmm || 0;
          const pmmB = b.broadcasterProfile?.pmm || 0;

          const aIsUserCity = normalizedUserCity !== '' && aCity === normalizedUserCity;
          const bIsUserCity = normalizedUserCity !== '' && bCity === normalizedUserCity;

          // Regra 1: Emissoras da mesma cidade do usuário sempre no topo
          if (aIsUserCity && !bIsUserCity) return -1;
          if (!aIsUserCity && bIsUserCity) return 1;

          // Regra 2: Quando filtros de target ativos, ordena por target score (maior = melhor)
          if (hasTargetFilters) {
            const scoreA = getTargetScore(a);
            const scoreB = getTargetScore(b);
            if (scoreA !== scoreB) return scoreB - scoreA;
          }

          // Regra 3: Dentro da mesma cidade, desempata por PMM
          if (aIsUserCity && bIsUserCity) return pmmB - pmmA;

          // Regra 4: Por distância crescente (PMM como desempate se < 30km de diferença)
          const distA = distanceCache.get(a._id.toString());
          const distB = distanceCache.get(b._id.toString());

          if (distA != null && distB != null) {
            const distDiff = distA - distB;
            if (Math.abs(distDiff) < 30) return pmmB - pmmA;
            return distDiff;
          }
          // Emissoras sem coordenadas vão para o final, ordenadas por PMM
          if (distA != null && distB == null) return -1;
          if (distA == null && distB != null) return 1;
          return pmmB - pmmA;
        });

        // Aplica paginação manual após ordenação
        paginatedBroadcasters = allMatching.slice(skip, skip + limit);
        proximitySortApplied = true;

      } catch (proxError) {
        // Fallback: usa ordenação padrão do banco
        paginatedBroadcasters = null;
        proximitySortApplied = false;
      }
    }

    // Fallback: ordenação padrão do banco de dados (sem proximidade)
    if (!paginatedBroadcasters) {
      paginatedBroadcasters = await User.find(broadcasterQuery)
        .select('_id address.city')
        .sort(sortOptions)
        .skip(skip)
        .limit(limit);
    }

    const paginatedBroadcasterIds = paginatedBroadcasters.map((b: any) => b._id);

    // Busca produtos dessas emissoras (reaplicando filtro de preço se necessário)
    const productQuery: any = {
      isActive: true,
      broadcasterId: { $in: paginatedBroadcasterIds }
    };

    if (priceMin !== null) productQuery.pricePerInsertion = { ...productQuery.pricePerInsertion, $gte: priceMin };
    if (priceMax !== null) productQuery.pricePerInsertion = { ...productQuery.pricePerInsertion, $lte: priceMax };

    // Paraleliza products + PMM aggregation (queries independentes)
    const citiesOnPage = [...new Set(paginatedBroadcasters.map(b => b.address?.city).filter(Boolean))];

    const [products, pmmAggregation] = await Promise.all([
      Product.find(productQuery)
        .populate({
          path: 'broadcasterId',
          select: '_id companyName fantasyName email broadcasterProfile address status'
        })
        .lean(),
      citiesOnPage.length > 0
        ? User.aggregate([
            {
              $match: {
                'address.city': { $in: citiesOnPage },
                userType: 'broadcaster',
                status: 'approved'
              }
            },
            {
              $group: {
                _id: '$address.city',
                maxPMM: { $max: '$broadcasterProfile.pmm' }
              }
            }
          ])
        : []
    ]);

    // Reordenar os produtos com base na ordem dos broadcasters (Map para O(1) lookup)
    const broadcasterOrderMap = new Map(
      paginatedBroadcasterIds.map((id: any, idx: number) => [id.toString(), idx])
    );

    products.sort((a: any, b: any) => {
      const idA = a.broadcasterId?._id ? a.broadcasterId._id.toString() : '';
      const idB = b.broadcasterId?._id ? b.broadcasterId._id.toString() : '';
      const indexA = broadcasterOrderMap.get(idA) ?? broadcasterOrderMap.size;
      const indexB = broadcasterOrderMap.get(idB) ?? broadcasterOrderMap.size;

      // Se forem da mesma emissora, ordena por data de criação do produto (mais novo primeiro)
      if (indexA === indexB) {
        return new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime();
      }

      return indexA - indexB;
    });

    // Emissoras da página que não têm nenhum produto — precisam aparecer com products: []
    const broadcastersWithProductIdsSet = new Set(
      products.map((p: any) => p.broadcasterId?._id?.toString()).filter(Boolean)
    );
    const idsWithoutProducts = paginatedBroadcasterIds
      .map((id: any) => id.toString())
      .filter((id: string) => !broadcastersWithProductIdsSet.has(id));

    let broadcastersWithoutProducts: any[] = [];
    if (idsWithoutProducts.length > 0) {
      broadcastersWithoutProducts = await User.find({ _id: { $in: idsWithoutProducts } })
        .select('_id companyName fantasyName email broadcasterProfile address status')
        .lean();
    }

    const cityMaxPmm: Record<string, number> = pmmAggregation.reduce((acc: Record<string, number>, curr: any) => {
      acc[curr._id] = curr.maxPMM || 0;
      return acc;
    }, {} as Record<string, number>);

    // totalBroadcasters vem do countDocuments — reflete o total real de emissoras que batem com os filtros
    const finalTotalItems = totalBroadcasters;
    const finalTotalPages = Math.ceil(finalTotalItems / limit);

    const response = {
      products,
      broadcastersWithoutProducts,
      cityMaxPmm,
      isSortedByProximity: proximitySortApplied,
      pagination: {
        currentPage: page,
        totalPages: finalTotalPages,
        totalItems: finalTotalItems,
        itemsPerPage: limit,
        hasNextPage: page < finalTotalPages,
        hasPrevPage: page > 1
      }
    };

    await cacheSet(cacheKey, response, 30); // 30 segundos
    res.json(response);
  } catch (error) {
    res.status(500).json({ error: 'Erro ao buscar produtos' });
  }
};

// Listar todas as cidades com emissoras ativas no marketplace
export const getMarketplaceCities = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    // 1. Encontra IDs de emissoras que têm produtos ativos
    const broadcastersWithProducts = await Product.distinct('broadcasterId', { isActive: true });

    // 2. Busca as cidades dessas emissoras
    const broadcasters = await User.find({
      _id: { $in: broadcastersWithProducts },
      userType: 'broadcaster',
      status: 'approved' // Apenas emissoras aprovadas aparecem no marketplace
    }).select('address.city');

    // 3. Extrai e ordena as cidades
    const citiesSet = new Set<string>();
    broadcasters.forEach(b => {
      if (b.address && b.address.city) {
        citiesSet.add(b.address.city);
      }
    });

    const cities = Array.from(citiesSet).sort();

    res.json(cities);
  } catch (error) {
    res.status(500).json({ error: 'Erro ao buscar cidades' });
  }
};

// Obter detalhes públicos da emissora para o Marketplace
export const getMarketplaceBroadcasterDetails = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { broadcasterId } = req.params;

    // Busca broadcaster (catalogo ou normal)
    const broadcaster = await User.findOne({
      _id: broadcasterId,
      userType: 'broadcaster' // Garante que é broadcaster
    }).select('-password');

    if (!broadcaster) {
      res.status(404).json({ error: 'Emissora não encontrada' });
      return;
    }

    // Retorna perfil unificado
    res.json({
      id: broadcaster._id,
      name: broadcaster.companyName,
      location: broadcaster.address?.city || '',
      address: broadcaster.address, // Inclui endereço completo (com coordenadas)
      profile: broadcaster.broadcasterProfile || {},
      isCatalogOnly: broadcaster.isCatalogOnly || false
    });

  } catch (error) {
    res.status(500).json({ error: 'Erro ao buscar detalhes da emissora' });
  }
};

// Obter emissoras para o mapa — aggregation leve, agrupado por emissora
// Payload ~70% menor: sem broadcaster duplicado por produto, sem dados sensíveis
export const getMapProducts = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    // Cache Redis (TTL 5min) — dados de mapa mudam raramente
    const mapCached = await cacheGet('map:all');
    if (mapCached) {
      res.json(mapCached);
      return;
    }

    const broadcasters = await User.aggregate([
      // 1. Apenas emissoras aprovadas com coordenadas válidas
      {
        $match: {
          userType: 'broadcaster',
          status: 'approved',
          'address.latitude': { $exists: true, $ne: null },
          'address.longitude': { $exists: true, $ne: null }
        }
      },
      // 2. Join com produtos ativos — só os campos que o mapa usa
      {
        $lookup: {
          from: 'products',
          let: { bid: '$_id' },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $eq: ['$broadcasterId', '$$bid'] },
                    { $eq: ['$isActive', true] }
                  ]
                }
              }
            },
            { $project: { _id: 1, spotType: 1, timeSlot: 1, pricePerInsertion: 1 } }
          ],
          as: 'products'
        }
      },
      // 3. Descarta emissoras sem nenhum produto ativo
      { $match: { 'products.0': { $exists: true } } },
      // 4. Projeta apenas o que o mapa precisa — sem dados sensíveis
      {
        $project: {
          _id: 1,
          name: { $ifNull: ['$broadcasterProfile.generalInfo.stationName', '$companyName'] },
          lat: '$address.latitude',
          lng: '$address.longitude',
          city: '$address.city',
          dial: '$broadcasterProfile.generalInfo.dialFrequency',
          band: '$broadcasterProfile.generalInfo.band',
          antennaClass: '$broadcasterProfile.generalInfo.antennaClass',
          logo: '$broadcasterProfile.logo',
          population: '$broadcasterProfile.coverage.totalPopulation',
          coverageCities: '$broadcasterProfile.coverage.cities',
          products: 1
        }
      }
    ]);

    await cacheSet('map:all', broadcasters, 300); // 5 minutos
    res.json(broadcasters);
  } catch (error) {
    res.status(500).json({ error: 'Erro ao buscar dados do mapa' });
  }
};

// Busca de emissoras para o Comparador (server-side, leve, sob demanda)
export const searchBroadcastersForCompare = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const q = (req.query.q as string) || '';
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 50);

    // Cache Redis (TTL 1min)
    const compareCacheKey = `compare:${JSON.stringify({ q, limit })}`;
    const compareCached = await cacheGet(compareCacheKey);
    if (compareCached) {
      res.json(compareCached);
      return;
    }

    const broadcasterQuery: any = {
      userType: 'broadcaster',
      status: 'approved' // Apenas emissoras aprovadas aparecem no marketplace
    };

    if (q && q.length >= 2) {
      const searchFields = [
        'companyName',
        'broadcasterProfile.generalInfo.stationName',
        'broadcasterProfile.generalInfo.dialFrequency',
        'address.city'
      ];
      const tokens = q.trim().split(/\s+/).filter(t => t.length >= 2 || /\d/.test(t));

      if (tokens.length > 0) {
        broadcasterQuery.$and = tokens.map(token => {
          const tokenRegex = toAccentInsensitiveRegex(token);
          return { $or: searchFields.map(field => ({ [field]: tokenRegex })) };
        });
      }
    }

    const aggregatePipeline: any[] = [
      { $match: broadcasterQuery },
      // Check for at least 1 active product
      {
        $lookup: {
          from: 'products',
          localField: '_id',
          foreignField: 'broadcasterId',
          pipeline: [
            { $match: { isActive: true } },
            { $limit: 1 },
            { $project: { _id: 1 } }
          ],
          as: 'activeProductCheck'
        }
      },
      { $match: { 'activeProductCheck.0': { $exists: true } } },
      { $sort: { 'broadcasterProfile.pmm': -1 } },
      { $limit: limit },
      {
        $project: {
          _id: 1,
          companyName: 1,
          address: { city: 1, state: 1 },
          broadcasterProfile: {
            generalInfo: 1,
            logo: 1,
            pmm: 1,
            coverage: { totalPopulation: 1, cities: 1 },
            audienceProfile: 1,
            categories: 1
          }
        }
      }
    ];

    const broadcasters = await User.aggregate(aggregatePipeline);

    // Fetch actual products for the matching broadcasters
    const bIds = broadcasters.map((b: any) => b._id);
    const products = await Product.find({
      broadcasterId: { $in: bIds },
      isActive: true
    }).select('broadcasterId spotType pricePerInsertion timeSlot').lean();

    // Group products
    const productsByBroadcaster = new Map<string, any[]>();
    products.forEach((p: any) => {
      const bid = p.broadcasterId.toString();
      if (!productsByBroadcaster.has(bid)) productsByBroadcaster.set(bid, []);
      productsByBroadcaster.get(bid)!.push({
        id: p._id,
        name: p.spotType,
        price: p.pricePerInsertion,
        timeSlot: p.timeSlot
      });
    });

    const result = broadcasters.map((b: any) => ({
      id: b._id,
      name: b.broadcasterProfile?.generalInfo?.stationName || b.companyName,
      dial: b.broadcasterProfile?.generalInfo?.dialFrequency,
      band: b.broadcasterProfile?.generalInfo?.band,
      logo: b.broadcasterProfile?.logo,
      city: b.address?.city || 'Desconhecida',
      state: b.address?.state,
      population: b.broadcasterProfile?.coverage?.totalPopulation || 0,
      pmm: b.broadcasterProfile?.pmm || 0,
      audience: {
        socialClass: b.broadcasterProfile?.audienceProfile?.socialClass || {},
        ageRange: b.broadcasterProfile?.audienceProfile?.ageRange || '',
        gender: b.broadcasterProfile?.audienceProfile?.gender || { male: 50, female: 50 }
      },
      categories: b.broadcasterProfile?.categories || [],
      products: productsByBroadcaster.get(b._id.toString()) || [],
      citiesCovered: b.broadcasterProfile?.coverage?.cities?.length || 0,
      allCities: b.broadcasterProfile?.coverage?.cities || [],
      profile: b.broadcasterProfile || {}
    }));

    await cacheSet(compareCacheKey, result, 60); // 1 minuto
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: 'Erro ao buscar emissoras' });
  }
};
