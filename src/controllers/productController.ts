import { Response } from 'express';
import { Product } from '../models/Product';
import { User } from '../models/User';
import { AuthRequest } from '../middleware/auth';
import { toAccentInsensitiveRegex } from '../utils/stringUtils';
import NodeGeocoder from 'node-geocoder';
const options: NodeGeocoder.Options = {
  provider: 'openstreetmap'
};
const geocoder = NodeGeocoder(options);

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
    console.error('Erro ao buscar produtos:', error);
    res.status(500).json({ error: 'Erro ao buscar produtos', details: error instanceof Error ? error.message : 'Erro desconhecido' });
  }
};

// Criar novo produto (Broadcaster ou Admin)
export const createProduct = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { spotType, timeSlot, pricePerInsertion, broadcasterId } = req.body;

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

    // Valida dados obrigatórios
    if (!spotType || !timeSlot || !pricePerInsertion) {
      res.status(400).json({ error: 'spotType, timeSlot e pricePerInsertion são obrigatórios' });
      return;
    }

    // Extrai a duração do spotType (ex: "Comercial 30s" -> 30)
    const durationMatch = spotType.match(/(\d+)s/);
    const duration = durationMatch ? parseInt(durationMatch[1]) : 30;

    const product = new Product({
      broadcasterId: targetBroadcasterId,
      spotType,
      duration,
      timeSlot,
      pricePerInsertion: parseFloat(pricePerInsertion)
    });

    await product.save();



    res.status(201).json({
      message: 'Produto cadastrado com sucesso!',
      product
    });
  } catch (error) {
    console.error('Erro ao criar produto:', error);
    res.status(500).json({ error: 'Erro ao criar produto', details: error instanceof Error ? error.message : 'Erro desconhecido' });
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

    const { spotType, timeSlot, pricePerInsertion, isActive } = req.body;

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
    if (pricePerInsertion !== undefined) product.pricePerInsertion = parseFloat(pricePerInsertion);
    if (isActive !== undefined) product.isActive = isActive;

    await product.save();



    res.json({
      message: 'Produto atualizado com sucesso!',
      product
    });
  } catch (error) {
    console.error('Erro ao atualizar produto:', error);
    res.status(500).json({ error: 'Erro ao atualizar produto', details: error instanceof Error ? error.message : 'Erro desconhecido' });
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

    const product = await Product.findByIdAndDelete(productId);

    if (!product) {
      res.status(404).json({ error: 'Produto não encontrado' });
      return;
    }



    res.json({ message: 'Produto deletado com sucesso!' });
  } catch (error) {
    console.error('Erro ao deletar produto:', error);
    res.status(500).json({ error: 'Erro ao deletar produto', details: error instanceof Error ? error.message : 'Erro desconhecido' });
  }
};

// Listar todos os produtos ativos (para o Marketplace) - COM PAGINAÇÃO POR EMISSORA
export const getAllActiveProducts = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    // Parâmetros de paginação
    console.log('========================================');
    console.log('🛒 MARKETPLACE ENDPOINT CHAMADO');
    console.log('========================================');
    console.log('🌍 Backend recebeu:', {
      lat: req.query.lat,
      lng: req.query.lng,
      userId: req.userId,
      query: req.query
    });

    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 25;
    const skip = (page - 1) * limit;
    const search = (req.query.search as string) || '';

    console.log('🌍 Parâmetros recebidos:', {
      lat: req.query.lat,
      lng: req.query.lng,
      userId: req.userId,
      page,
      search
    });

    // PASSO 1: Filtro de Preço (nos Produtos)
    let validBroadcasterIdsViaProduct: any[] = [];
    const priceMin = req.query.priceMin ? parseFloat(req.query.priceMin as string) : null;
    const priceMax = req.query.priceMax ? parseFloat(req.query.priceMax as string) : null;

    if (priceMin !== null || priceMax !== null) {
      const priceQuery: any = { isActive: true };
      if (priceMin !== null) priceQuery.pricePerInsertion = { ...priceQuery.pricePerInsertion, $gte: priceMin };
      if (priceMax !== null) priceQuery.pricePerInsertion = { ...priceQuery.pricePerInsertion, $lte: priceMax };

      validBroadcasterIdsViaProduct = await Product.distinct('broadcasterId', priceQuery);
      // Se não achou ninguém com esse preço, retorna vazio
      if (validBroadcasterIdsViaProduct.length === 0) {
        res.json({ products: [], pagination: { currentPage: page, totalPages: 0, totalItems: 0, itemsPerPage: limit, hasNextPage: false, hasPrevPage: false } });
        return;
      }
    } else {
      // Se não tem filtro de preço, pega todos que tem produtos ativos
      validBroadcasterIdsViaProduct = await Product.distinct('broadcasterId', { isActive: true });
    }

    // PASSO 2: Query de Broadcasters (Filtros de Perfil)
    let broadcasterQuery: any = {
      _id: { $in: validBroadcasterIdsViaProduct },
      userType: 'broadcaster',
      $or: [
        { status: 'approved' },
        { isCatalogOnly: true }
      ]
    };

    // Filtro de Cidade (Exato)
    if (req.query.city) {
      broadcasterQuery['address.city'] = req.query.city;
    }

    // Filtros de Audiência (JSON parse necessário)
    try {
      if (req.query.ageRanges) {
        const ageRanges = JSON.parse(req.query.ageRanges as string);
        if (Array.isArray(ageRanges) && ageRanges.length > 0) {
          // Mapeamento de faixas etárias para regex
          // Se o usuário seleciona "18+", queremos encontrar qualquer emissora que tenha público 18+, 20+, 25+, etc.
          const ageMap: Record<string, string[]> = {
            '12+': ['12+', '14+', '18+', '20+', '25+', '30+', '35+', '40+', '45+', '50+', '55+', '60+', '65+'],
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
      console.error('Erro ao parsear filtros JSON', e);
    }

    // Se tem busca textual (mesma lógica anterior)
    if (search && search.length >= 2) {
      // Use helper para regex insensível a acentos
      const searchRegex = toAccentInsensitiveRegex(search);
      const searchQuery = {
        $or: [
          { companyName: searchRegex },
          { 'broadcasterProfile.generalInfo.stationName': searchRegex },
          { 'broadcasterProfile.generalInfo.dialFrequency': searchRegex },
          { 'address.city': searchRegex }
        ]
      };

      broadcasterQuery.$and = broadcasterQuery.$and || [];
      broadcasterQuery.$and.push(searchQuery);
    }

    // Conta total de emissoras filtradas
    const totalBroadcasters = await User.countDocuments(broadcasterQuery);
    const totalPages = Math.ceil(totalBroadcasters / limit);

    // Definição de Ordenação Dinâmica
    let sortOptions: any = {};

    // Prioridade 1: Classe Social
    try {
      if (req.query.socialClasses) {
        const socialClasses = JSON.parse(req.query.socialClasses as string);
        if (Array.isArray(socialClasses) && socialClasses.length > 0) {
          // Pega a primeira classe selecionada para ordenar
          const cls = socialClasses[0];
          if (cls === 'AB') sortOptions['broadcasterProfile.audienceProfile.socialClass.classeAB'] = -1;
          if (cls === 'C') sortOptions['broadcasterProfile.audienceProfile.socialClass.classeC'] = -1;
          if (cls === 'DE') sortOptions['broadcasterProfile.audienceProfile.socialClass.classeDE'] = -1;
        }
      }
    } catch (e) { console.error('Error parsing socialClasses for sort', e); }

    // Prioridade 2: Gênero
    try {
      if (req.query.genders) {
        const genders = JSON.parse(req.query.genders as string);
        if (Array.isArray(genders) && genders.length > 0) {
          const gender = genders[0];
          if (gender === 'male') sortOptions['broadcasterProfile.audienceProfile.gender.male'] = -1;
          if (gender === 'female') sortOptions['broadcasterProfile.audienceProfile.gender.female'] = -1;
        }
      }
    } catch (e) { console.error('Error parsing genders for sort', e); }

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
            const resData = await geocoder.geocode(`${loggedUser.address.city}, ${loggedUser.address.state}, Brasil`);
            if (resData && resData.length > 0 && resData[0]) {
              userLat = resData[0].latitude || null;
              userLng = resData[0].longitude || null;
            }
          }
          if (loggedUser.address.city) {
            userCity = loggedUser.address.city;
            console.log(`📍 Usando localização do perfil do usuário: ${userCity} (Lat: ${userLat}, Lng: ${userLng})`);
          }
        }
      } catch (err) {
        console.error('Erro ao buscar endereço do usuário logado:', err);
      }
    }

    // Se temos coordenadas mas não temos cidade, tenta obter via geocoding reverso ANTES de ordenar
    if ((userLat !== null && userLng !== null && !Number.isNaN(userLat) && !Number.isNaN(userLng)) && !userCity) {
      try {
        console.log('🔍 Buscando cidade via geocoding reverso (antes da ordenação)...');
        const reverseResult = await geocoder.reverse({ lat: userLat, lon: userLng });
        if (reverseResult && reverseResult.length > 0 && reverseResult[0]) {
          userCity = reverseResult[0].city || (reverseResult[0].administrativeLevels && reverseResult[0].administrativeLevels.level2long) || null;
          console.log('✅ Cidade obtida via geocoding reverso (antes da ordenação):', userCity);
        } else {
          console.log('⚠️ Geocoding reverso não retornou cidade');
        }
      } catch (err) {
        console.error('❌ Erro no geocoding reverso (antes da ordenação):', err);
      }
    }

    console.log('========================================');
    console.log('📍 Coordenadas finais para ordenação:', { 
      userLat, 
      userLng, 
      userCity,
      userId: req.userId || 'não logado'
    });

    let paginatedBroadcasters;
    let proximitySortApplied = false;

    const hasValidCoords = userLat !== null && userLng !== null && !Number.isNaN(userLat) && !Number.isNaN(userLng);

    if (hasValidCoords && !req.query.city) {
      try {
        console.log('📊 Iniciando ordenação por proximidade...');

        // Busca todas as emissoras que batem com os filtros para ordenar em memória
        const allMatching = await User.find(broadcasterQuery)
          .select('_id address.city address.latitude address.longitude broadcasterProfile.pmm companyName')
          .lean();

        console.log(`📊 Total de emissoras para ordenar: ${allMatching.length}`);

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

        console.log('🏙️ Cidade do usuário para ordenação:', {
          original: userCity,
          normalized: normalizedUserCity
        });

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

        console.log(`📊 Emissoras com coordenadas válidas: ${distanceCache.size} de ${allMatching.length}`);

        // Ordena: mesma cidade primeiro (por PMM), depois por distância crescente (PMM como desempate)
        allMatching.sort((a: any, b: any) => {
          const aCity = normalizeCityStr(a.address?.city);
          const bCity = normalizeCityStr(b.address?.city);
          const pmmA = a.broadcasterProfile?.pmm || 0;
          const pmmB = b.broadcasterProfile?.pmm || 0;

          const aIsUserCity = normalizedUserCity !== '' && aCity === normalizedUserCity;
          const bIsUserCity = normalizedUserCity !== '' && bCity === normalizedUserCity;

          // Regra 1: Emissoras da mesma cidade do usuário sempre no topo
          if (aIsUserCity && bIsUserCity) return pmmB - pmmA;
          if (aIsUserCity && !bIsUserCity) return -1;
          if (!aIsUserCity && bIsUserCity) return 1;

          // Regra 2: Por distância crescente (PMM como desempate se < 30km de diferença)
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

        // Debug: log das primeiras 10 emissoras após ordenação
        console.log('========================================');
        console.log('📊 Primeiras 10 emissoras após ordenação por proximidade:');
        allMatching.slice(0, 10).forEach((b: any, idx: number) => {
          const dist = distanceCache.get(b._id.toString());
          console.log(`  ${idx + 1}. ${b.companyName} | Cidade: "${b.address?.city}" | Dist: ${dist != null ? dist.toFixed(1) + 'km' : 'N/A'} | PMM: ${b.broadcasterProfile?.pmm || 0}`);
        });

        // Aplica paginação manual após ordenação
        paginatedBroadcasters = allMatching.slice(skip, skip + limit);
        res.locals.filteredTotalItems = allMatching.length;
        proximitySortApplied = true;

      } catch (proxError) {
        console.error('❌ Erro na ordenação por proximidade, usando fallback:', proxError);
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

    let products = await Product.find(productQuery)
      .populate({
        path: 'broadcasterId',
        select: '-password'
      })
      .lean();

    // Reordenar os produtos com base na ordem dos broadcasters (paginatedBroadcasterIds)
    const broadcasterIdStrings = paginatedBroadcasterIds.map((id: any) => id.toString());

    products.sort((a: any, b: any) => {
      const idA = a.broadcasterId?._id ? a.broadcasterId._id.toString() : '';
      const idB = b.broadcasterId?._id ? b.broadcasterId._id.toString() : '';
      const indexA = broadcasterIdStrings.indexOf(idA);
      const indexB = broadcasterIdStrings.indexOf(idB);

      // Se forem da mesma emissora, ordena por data de criação do produto (mais novo primeiro)
      if (indexA === indexB) {
        return new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime();
      }

      return indexA - indexB;
    });


    // Aggregation de PMM por Cidade (Server-Side Context)
    // Para cada cidade presente na página atual, buscamos o MAIOR PMM existente no banco todo
    const citiesOnPage = [...new Set(paginatedBroadcasters.map(b => b.address?.city).filter(Boolean))];
    let cityMaxPmm: Record<string, number> = {};

    if (citiesOnPage.length > 0) {
      const pmmAggregation = await User.aggregate([
        {
          $match: {
            'address.city': { $in: citiesOnPage },
            userType: 'broadcaster',
            $or: [{ status: 'approved' }, { isCatalogOnly: true }]
          }
        },
        {
          $group: {
            _id: '$address.city',
            maxPMM: { $max: '$broadcasterProfile.pmm' }
          }
        }
      ]);

      cityMaxPmm = pmmAggregation.reduce((acc, curr) => {
        acc[curr._id] = curr.maxPMM || 0;
        return acc;
      }, {} as Record<string, number>);
    }

    // Calcula totalItems real dependendo se foi filtrado por proximidade na memória ou não
    const finalTotalItems = res.locals.filteredTotalItems !== undefined ? res.locals.filteredTotalItems : totalBroadcasters;
    const finalTotalPages = Math.ceil(finalTotalItems / limit);

    console.log(`✅ Marketplace response: ${products.length} produtos, proximidade=${proximitySortApplied}, total=${finalTotalItems}`);

    res.json({
      products,
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
    });
  } catch (error) {
    console.error('Erro ao buscar produtos do marketplace:', error);
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
      $or: [
        { status: 'approved' },
        { isCatalogOnly: true }
      ]
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
    console.error('Erro ao buscar cidades do marketplace:', error);
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
    console.error('Erro ao buscar detalhes da emissora no marketplace:', error);
    res.status(500).json({ error: 'Erro ao buscar detalhes da emissora' });
  }
};

// Obter TODOS os produtos para o mapa (sem paginação, leve)
export const getMapProducts = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    // Busca todos os produtos ativos
    const products = await Product.find({ isActive: true })
      .populate({
        path: 'broadcasterId',
        select: 'companyName address broadcasterProfile userType status isCatalogOnly' // Seleciona apenas campos necessários
      });

    // Filtra produtos onde o broadcaster existe e é válido
    const validProducts = products.filter(p => {
      const b = p.broadcasterId as any;
      return b && (b.status === 'approved' || b.isCatalogOnly);
    });

    res.json(validProducts);
  } catch (error) {
    console.error('Erro ao buscar dados do mapa:', error);
    res.status(500).json({ error: 'Erro ao buscar dados do mapa' });
  }
};
