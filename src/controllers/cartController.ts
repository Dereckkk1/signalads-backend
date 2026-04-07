import { Response } from 'express';
import { Cart, ICartItem } from '../models/Cart';
import { Product } from '../models/Product';
import { Sponsorship } from '../models/Sponsorship';
import { User } from '../models/User';
import { AuthRequest } from '../middleware/auth';

const MAX_CART_QUANTITY = 10000;

// Calcula quantos dias do programa caem no mês selecionado
function countProgramDaysInMonth(yearMonth: string, daysOfWeek: number[]): number {
  const parts = yearMonth.split('-').map(Number);
  const year = parts[0]!;
  const month = parts[1]!;
  const daysInMonth = new Date(year, month, 0).getDate();
  let count = 0;
  for (let day = 1; day <= daysInMonth; day++) {
    const date = new Date(year, month - 1, day);
    if (daysOfWeek.includes(date.getDay())) {
      count++;
    }
  }
  return count;
}

// Valida e sanitiza quantidade: inteiro >= 1 e <= MAX_CART_QUANTITY
const sanitizeQuantity = (qty: any): number | null => {
  const n = Number(qty);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 1 || n > MAX_CART_QUANTITY) {
    return null;
  }
  return n;
};

// Função para validar e limpar datas expiradas
const cleanExpiredSchedules = (items: ICartItem[], minAdvanceDays: number = 3): ICartItem[] => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);


  return items.map(item => {
    if (!item.schedule || Object.keys(item.schedule).length === 0) {
      return item;
    }

    const cleanedSchedule: any = {};
    let removedCount = 0;

    // Calcula data mínima permitida (hoje + minAdvanceDays em dias ÚTEIS)
    const minDate = new Date(today);
    let businessDaysAdded = 0;


    while (businessDaysAdded < minAdvanceDays) {
      minDate.setDate(minDate.getDate() + 1);
      const dayOfWeek = minDate.getDay();

      // Conta apenas dias úteis (segunda a sexta, 1-5)
      if (dayOfWeek !== 0 && dayOfWeek !== 6) {
        businessDaysAdded++;
      }
    }

    minDate.setHours(0, 0, 0, 0);

    // Converte Map do Mongoose para objeto puro
    let scheduleObj: any = {};

    if (item.schedule instanceof Map) {
      scheduleObj = Object.fromEntries(item.schedule);
    } else if (typeof item.schedule === 'object' && item.schedule !== null) {
      // Se for objeto Mongoose com toObject, converte
      scheduleObj = (item.schedule as any).toObject ? (item.schedule as any).toObject() : item.schedule;
    } else {
      scheduleObj = item.schedule;
    }

    // Filtra datas válidas
    Object.entries(scheduleObj).forEach(([dateStr, count]) => {
      // Ignora propriedades internas do Mongoose
      if (dateStr.startsWith('$') || dateStr.startsWith('_')) {
        return;
      }

      try {
        // Cria data a partir da string no formato local (sem conversão de timezone)
        const parts = dateStr.split('-');
        if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) {
          throw new Error('Formato de data inválido');
        }

        const year = parseInt(parts[0], 10);
        const month = parseInt(parts[1], 10);
        const day = parseInt(parts[2], 10);

        if (isNaN(year) || isNaN(month) || isNaN(day)) {
          throw new Error('Data contém valores não numéricos');
        }

        const scheduleDate = new Date(year, month - 1, day);
        scheduleDate.setHours(0, 0, 0, 0);


        if (scheduleDate >= minDate) {
          cleanedSchedule[dateStr] = count;
        } else {
          removedCount += count as number;
        }
      } catch (error) {
        removedCount += count as number;
      }
    });

    if (removedCount > 0) {
    } else {
    }

    return {
      ...item,
      schedule: cleanedSchedule
    };
  });
};

// Obter carrinho do usuário
export const getCart = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!req.userId) {
      res.status(401).json({ error: 'Usuário não autenticado' });
      return;
    }

    // Usa findOneAndUpdate com upsert para evitar duplicate key error
    let cart = await Cart.findOneAndUpdate(
      { userId: req.userId },
      { $setOnInsert: { userId: req.userId, items: [] } },
      { upsert: true, new: true }
    );

    // Popula dados do broadcaster para o frontend (necessário para insights)
    await cart.populate('items.broadcasterId', '_id companyName fantasyName broadcasterProfile address email');

    // Converte para objeto para poder modificar
    const cartObj = cart.toObject();

    // Mapeia itens para incluir broadcasterProfile na raiz do item (para o frontend)
    cartObj.items = cartObj.items.map((item: any) => {
      if (item.broadcasterId && typeof item.broadcasterId === 'object') {
        // Se broadcasterId foi populado (é um objeto User)
        return {
          ...item,
          broadcasterProfile: item.broadcasterId.broadcasterProfile,
          // Mantém ID como string
          broadcasterId: item.broadcasterId._id
        };
      }
      return item;
    });

    res.json(cartObj);
  } catch (error) {
    res.status(500).json({ error: 'Erro ao buscar carrinho' });
  }
};

// Adicionar item ao carrinho
export const addItem = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!req.userId) {
      res.status(401).json({ error: 'Usuário não autenticado' });
      return;
    }

    const { productId, quantity: rawQty, sponsorshipId, selectedMonth } = req.body;

    // ─── Patrocínio ──────────────────────────────────────────────────────
    if (sponsorshipId) {
      // selectedMonth é opcional no addItem (pode ser definido depois via updateSponsorshipMonth)
      if (selectedMonth && !/^\d{4}-\d{2}$/.test(selectedMonth)) {
        res.status(400).json({ error: 'selectedMonth deve estar no formato YYYY-MM' });
        return;
      }

      // Validar que é mês futuro (a partir do próximo mês — patrocínio é mês fechado)
      if (selectedMonth) {
        const now = new Date();
        const parts = selectedMonth.split('-').map(Number);
        const selYear = parts[0]!;
        const selMonth = parts[1]!;
        const currentYearMonth = now.getFullYear() * 100 + (now.getMonth() + 1);
        const selectedYearMonth = selYear * 100 + selMonth;
        if (selectedYearMonth <= currentYearMonth) {
          res.status(400).json({ error: 'Patrocínio só pode ser comprado a partir do mês seguinte' });
          return;
        }
      }

      const sponsorship = await Sponsorship.findOne({ _id: sponsorshipId, isActive: true })
        .populate('broadcasterId', '_id companyName fantasyName broadcasterProfile address email status');
      if (!sponsorship || !sponsorship.broadcasterId) {
        res.status(404).json({ error: 'Patrocínio não encontrado ou indisponível' });
        return;
      }

      const broadcasterData: any = sponsorship.broadcasterId;
      if (broadcasterData.status !== 'approved') {
        res.status(400).json({ error: 'Emissora temporariamente indisponível' });
        return;
      }

      const broadcaster: any = sponsorship.broadcasterId;
      const programDaysInMonth = selectedMonth ? countProgramDaysInMonth(selectedMonth, sponsorship.daysOfWeek) : 0;

      let cart = await Cart.findOne({ userId: req.userId });
      if (!cart) {
        cart = new Cart({ userId: req.userId, items: [] });
      }

      // Verifica se patrocínio já existe no carrinho (mesmo id + mesmo mês)
      const existingIndex = cart.items.findIndex(
        item => item.productId.toString() === sponsorshipId && item.itemType === 'sponsorship'
      );

      if (existingIndex !== -1 && cart.items[existingIndex]) {
        // Atualiza mês
        cart.items[existingIndex].selectedMonth = selectedMonth;
        cart.items[existingIndex].programDaysInMonth = programDaysInMonth;
        cart.items[existingIndex].price = sponsorship.pricePerMonth;
      } else {
        const timeRangeStr = `${sponsorship.timeRange.start} às ${sponsorship.timeRange.end}`;
        const newItem: any = {
          productId: sponsorship._id, // Reutiliza productId para sponsorshipId
          productName: sponsorship.programName,
          productSchedule: timeRangeStr,
          broadcasterId: broadcaster._id,
          broadcasterName: broadcaster.companyName || broadcaster.fantasyName || '',
          broadcasterDial: broadcaster.broadcasterProfile?.generalInfo?.dialFrequency || '',
          broadcasterBand: broadcaster.broadcasterProfile?.generalInfo?.band || '',
          broadcasterLogo: broadcaster.broadcasterProfile?.logo || '',
          broadcasterCity: broadcaster.address?.city || '',
          price: sponsorship.pricePerMonth,
          quantity: 1, // Patrocínio é sempre 1 (por mês)
          duration: 0,
          schedule: {},
          addedAt: new Date(),
          itemType: 'sponsorship',
          selectedMonth,
          selectedMonths: selectedMonth ? [selectedMonth] : [],
          programDaysInMonth,
          daysOfWeek: sponsorship.daysOfWeek,
          sponsorshipInsertions: sponsorship.insertions.map(ins => ({
            name: ins.name,
            duration: ins.duration,
            quantityPerDay: ins.quantityPerDay,
            requiresMaterial: ins.requiresMaterial
          }))
        };
        cart.items.push(newItem);
      }

      await cart.save();
      res.json(cart);
      return;
    }

    // ─── Produto normal ──────────────────────────────────────────────────
    const quantity = sanitizeQuantity(rawQty);

    if (!productId || quantity === null) {
      res.status(400).json({ error: 'Dados inválidos. Quantidade deve ser inteiro entre 1 e ' + MAX_CART_QUANTITY });
      return;
    }

    // Busca produto ATIVO e broadcaster ATIVO
    const product = await Product.findOne({ _id: productId, isActive: true }).populate('broadcasterId', '_id companyName fantasyName broadcasterProfile address email status');
    if (!product || !product.broadcasterId) {
      res.status(404).json({ error: 'Produto não encontrado ou indisponível' });
      return;
    }

    // Verificar se emissora esta ativa/aprovada
    const broadcasterData: any = product.broadcasterId;
    if (broadcasterData.status !== 'approved') {
      res.status(400).json({ error: 'Emissora temporariamente indisponível' });
      return;
    }

    const broadcaster: any = product.broadcasterId;

    // Busca ou cria carrinho
    let cart = await Cart.findOne({ userId: req.userId });
    if (!cart) {
      cart = new Cart({
        userId: req.userId,
        items: []
      });
    }

    // Verifica se item já existe
    const existingItemIndex = cart.items.findIndex(
      item => item.productId.toString() === productId && (!item.itemType || item.itemType === 'product')
    );

    if (existingItemIndex !== -1 && cart.items[existingItemIndex]) {
      // Atualiza quantidade
      cart.items[existingItemIndex].quantity = quantity;
    } else {
      // Adiciona novo item
      const newItem: ICartItem = {
        productId: product._id,
        productName: product.spotType,
        productSchedule: product.timeSlot,
        broadcasterId: product.broadcasterId._id,
        broadcasterName: broadcaster.companyName || broadcaster.fantasyName || '',
        broadcasterDial: broadcaster.broadcasterProfile?.generalInfo?.dialFrequency || '',
        broadcasterBand: broadcaster.broadcasterProfile?.generalInfo?.band || '',
        broadcasterLogo: broadcaster.broadcasterProfile?.logo || '',
        broadcasterCity: broadcaster.address?.city || '',
        price: product.pricePerInsertion,
        quantity: quantity,
        duration: product.duration,
        schedule: {},
        addedAt: new Date()
      };

      cart.items.push(newItem);
    }

    await cart.save();



    res.json(cart);
  } catch (error) {
    res.status(500).json({ error: 'Erro ao adicionar item ao carrinho' });
  }
};

// Atualizar quantidade de item
export const updateItemQuantity = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!req.userId) {
      res.status(401).json({ error: 'Usuário não autenticado' });
      return;
    }

    const { productId, quantity: rawQty } = req.body;
    const quantity = sanitizeQuantity(rawQty);

    if (!productId || quantity === null) {
      res.status(400).json({ error: 'Dados inválidos. Quantidade deve ser inteiro entre 1 e ' + MAX_CART_QUANTITY });
      return;
    }

    const cart = await Cart.findOne({ userId: req.userId });
    if (!cart) {
      res.status(404).json({ error: 'Carrinho não encontrado' });
      return;
    }

    const itemIndex = cart.items.findIndex(
      item => item.productId.toString() === productId
    );

    if (itemIndex === -1) {
      res.status(404).json({ error: 'Item não encontrado no carrinho' });
      return;
    }

    if (!cart.items[itemIndex]) {
      res.status(404).json({ error: 'Item não encontrado no carrinho' });
      return;
    }

    cart.items[itemIndex].quantity = quantity;
    await cart.save();

    res.json(cart);
  } catch (error) {
    res.status(500).json({ error: 'Erro ao atualizar quantidade' });
  }
};

// Atualizar agendamento de item
export const updateItemSchedule = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!req.userId) {
      res.status(401).json({ error: 'Usuário não autenticado' });
      return;
    }

    const { productId, schedule } = req.body;

    if (!productId || !schedule) {
      res.status(400).json({ error: 'Dados inválidos' });
      return;
    }

    if (schedule && typeof schedule !== 'object') {
      res.status(400).json({ error: 'Formato de agendamento inválido' });
      return;
    }

    const cart = await Cart.findOne({ userId: req.userId });
    if (!cart) {
      res.status(404).json({ error: 'Carrinho não encontrado' });
      return;
    }

    const itemIndex = cart.items.findIndex(
      item => item.productId.toString() === productId
    );

    if (itemIndex === -1) {
      res.status(404).json({ error: 'Item não encontrado no carrinho' });
      return;
    }

    if (!cart.items[itemIndex]) {
      res.status(404).json({ error: 'Item não encontrado no carrinho' });
      return;
    }

    cart.items[itemIndex].schedule = schedule;
    await cart.save();


    res.json(cart);
  } catch (error) {
    res.status(500).json({ error: 'Erro ao atualizar agendamento' });
  }
};

// Atualizar material de item (URL após upload)
export const updateItemMaterial = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!req.userId) {
      res.status(401).json({ error: 'Usuário não autenticado' });
      return;
    }

    const { productId, material } = req.body;

    if (!productId || !material) {
      res.status(400).json({ error: 'Dados inválidos' });
      return;
    }

    const cart = await Cart.findOne({ userId: req.userId });
    if (!cart) {
      res.status(404).json({ error: 'Carrinho não encontrado' });
      return;
    }

    const itemIndex = cart.items.findIndex(
      item => item.productId.toString() === productId
    );

    if (itemIndex === -1) {
      res.status(404).json({ error: 'Item não encontrado no carrinho' });
      return;
    }

    if (!cart.items[itemIndex]) {
      res.status(404).json({ error: 'Item não encontrado no carrinho' });
      return;
    }

    // Sanitiza URLs de material contra path traversal
    if (material.audioUrl && (typeof material.audioUrl !== 'string' || !material.audioUrl.startsWith('https://'))) {
      res.status(400).json({ error: 'URL de áudio inválida' });
      return;
    }
    if (material.audioFileName && (typeof material.audioFileName !== 'string' || /[\/\\]/.test(material.audioFileName))) {
      res.status(400).json({ error: 'Nome de arquivo inválido' });
      return;
    }

    cart.items[itemIndex].material = material;
    await cart.save();


    res.json(cart);
  } catch (error) {
    res.status(500).json({ error: 'Erro ao atualizar material' });
  }
};

// Remover item do carrinho
export const removeItem = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!req.userId) {
      res.status(401).json({ error: 'Usuário não autenticado' });
      return;
    }

    const { productId } = req.params;

    if (!productId) {
      res.status(400).json({ error: 'ID do produto não fornecido' });
      return;
    }

    const cart = await Cart.findOne({ userId: req.userId });
    if (!cart) {
      res.status(404).json({ error: 'Carrinho não encontrado' });
      return;
    }

    cart.items = cart.items.filter(
      item => item.productId.toString() !== productId
    );

    await cart.save();


    res.json(cart);
  } catch (error) {
    res.status(500).json({ error: 'Erro ao remover item' });
  }
};

// Limpar carrinho
export const clearCart = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!req.userId) {
      res.status(401).json({ error: 'Usuário não autenticado' });
      return;
    }

    const cart = await Cart.findOne({ userId: req.userId });
    if (!cart) {
      res.status(404).json({ error: 'Carrinho não encontrado' });
      return;
    }

    cart.items = [];
    await cart.save();


    res.json(cart);
  } catch (error) {
    res.status(500).json({ error: 'Erro ao limpar carrinho' });
  }
};

// Sincronizar carrinho completo (localStorage -> backend)
export const syncCart = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!req.userId) {
      res.status(401).json({ error: 'Usuário não autenticado' });
      return;
    }

    const { items } = req.body;

    if (!Array.isArray(items)) {
      res.status(400).json({ error: 'Dados inválidos' });
      return;
    }

    let cart = await Cart.findOne({ userId: req.userId });
    if (!cart) {
      cart = new Cart({
        userId: req.userId,
        items: []
      });
    }

    // Validar e reconstruir itens com dados confiáveis do banco
    const validatedItems: ICartItem[] = [];

    // Separar itens por tipo
    const productItems = items.filter((item: any) => !item.itemType || item.itemType === 'product');
    const sponsorshipItems = items.filter((item: any) => item.itemType === 'sponsorship');

    // ─── Produtos ────────────────────────────────────────────────────────
    const productIds = productItems.map((item: any) => item.productId).filter((id: any) => id);
    const products = await Product.find({ _id: { $in: productIds } }).populate('broadcasterId', '_id companyName fantasyName broadcasterProfile address email status');
    const productMap = new Map(products.map(p => [p._id.toString(), p]));

    for (const item of productItems) {
      if (!item.productId) continue;

      const product = productMap.get(item.productId.toString());
      if (!product || !product.broadcasterId) continue;

      const broadcaster: any = product.broadcasterId;

      const validatedItem: ICartItem = {
        productId: product._id,
        productName: product.spotType,
        productSchedule: product.timeSlot,
        broadcasterId: broadcaster._id,
        broadcasterName: broadcaster.companyName || broadcaster.fantasyName || '',
        broadcasterDial: broadcaster.broadcasterProfile?.generalInfo?.dialFrequency || '',
        broadcasterBand: broadcaster.broadcasterProfile?.generalInfo?.band || '',
        broadcasterLogo: broadcaster.broadcasterProfile?.logo || '',
        broadcasterCity: broadcaster.address?.city || '',
        price: product.pricePerInsertion, // 🔒 PREÇO SEGURO DO BANCO
        quantity: sanitizeQuantity(item.quantity) || 1,
        duration: product.duration,
        schedule: item.schedule || {},
        material: item.material || undefined,
        addedAt: item.addedAt ? new Date(item.addedAt) : new Date()
      };

      validatedItems.push(validatedItem);
    }

    // ─── Patrocínios ─────────────────────────────────────────────────────
    const sponsorshipIds = sponsorshipItems.map((item: any) => item.productId).filter((id: any) => id);
    const sponsorships = await Sponsorship.find({ _id: { $in: sponsorshipIds } }).populate('broadcasterId', '_id companyName fantasyName broadcasterProfile address email status');
    const sponsorshipMap = new Map(sponsorships.map(s => [s._id.toString(), s]));

    for (const item of sponsorshipItems) {
      if (!item.productId) continue;

      const sponsorship = sponsorshipMap.get(item.productId.toString());
      if (!sponsorship || !sponsorship.broadcasterId) continue;

      const broadcaster: any = sponsorship.broadcasterId;
      const selectedMonth = item.selectedMonth || '';
      const programDaysInMonth = selectedMonth ? countProgramDaysInMonth(selectedMonth, sponsorship.daysOfWeek) : 0;
      const timeRangeStr = `${sponsorship.timeRange.start} às ${sponsorship.timeRange.end}`;

      const validatedItem: any = {
        productId: sponsorship._id,
        productName: sponsorship.programName,
        productSchedule: timeRangeStr,
        broadcasterId: broadcaster._id,
        broadcasterName: broadcaster.companyName || broadcaster.fantasyName || '',
        broadcasterDial: broadcaster.broadcasterProfile?.generalInfo?.dialFrequency || '',
        broadcasterBand: broadcaster.broadcasterProfile?.generalInfo?.band || '',
        broadcasterLogo: broadcaster.broadcasterProfile?.logo || '',
        broadcasterCity: broadcaster.address?.city || '',
        price: sponsorship.pricePerMonth, // 🔒 PREÇO SEGURO DO BANCO
        quantity: 1,
        duration: 0,
        schedule: {},
        addedAt: item.addedAt ? new Date(item.addedAt) : new Date(),
        itemType: 'sponsorship',
        selectedMonth,
        selectedMonths: item.selectedMonths || (selectedMonth ? [selectedMonth] : []),
        programDaysInMonth,
        daysOfWeek: sponsorship.daysOfWeek,
        sponsorshipInsertions: sponsorship.insertions.map(ins => ({
          name: ins.name,
          duration: ins.duration,
          quantityPerDay: ins.quantityPerDay,
          requiresMaterial: ins.requiresMaterial
        })),
        sponsorshipMaterials: item.sponsorshipMaterials || undefined
      };

      validatedItems.push(validatedItem);
    }

    // Limpa datas expiradas dos itens de produto validados (#47)
    const cleanedItems = cleanExpiredSchedules(validatedItems);



    // Use findOneAndUpdate to atomically update the cart
    cart = await Cart.findOneAndUpdate(
      { userId: req.userId },
      { $set: { items: cleanedItems } },
      { new: true, upsert: true } // Return the updated document, create if not exists
    );



    res.json(cart);
  } catch (error) {
    res.status(500).json({ error: 'Erro ao sincronizar carrinho' });
  }
};

// Atualizar mês selecionado de um patrocínio no carrinho
export const updateSponsorshipMonth = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!req.userId) {
      res.status(401).json({ error: 'Usuário não autenticado' });
      return;
    }

    const { productId, selectedMonth } = req.body;

    if (!productId || !selectedMonth || !/^\d{4}-\d{2}$/.test(selectedMonth)) {
      res.status(400).json({ error: 'productId e selectedMonth (YYYY-MM) são obrigatórios' });
      return;
    }

    // Validar que não é mês passado
    const now = new Date();
    const [selYear, selMonth] = selectedMonth.split('-').map(Number);
    const currentYearMonth = now.getFullYear() * 100 + (now.getMonth() + 1);
    const selectedYearMonth = selYear * 100 + selMonth;
    if (selectedYearMonth <= currentYearMonth) {
      res.status(400).json({ error: 'Patrocínio só pode ser comprado a partir do mês seguinte' });
      return;
    }

    const cart = await Cart.findOne({ userId: req.userId });
    if (!cart) {
      res.status(404).json({ error: 'Carrinho não encontrado' });
      return;
    }

    const itemIndex = cart.items.findIndex(
      item => item.productId.toString() === productId && item.itemType === 'sponsorship'
    );

    if (itemIndex === -1 || !cart.items[itemIndex]) {
      res.status(404).json({ error: 'Patrocínio não encontrado no carrinho' });
      return;
    }

    // Buscar patrocínio para recalcular dias
    const sponsorship = await Sponsorship.findById(productId);
    if (!sponsorship) {
      res.status(404).json({ error: 'Patrocínio não encontrado' });
      return;
    }

    const programDaysInMonth = countProgramDaysInMonth(selectedMonth, sponsorship.daysOfWeek);

    cart.items[itemIndex].selectedMonth = selectedMonth;
    cart.items[itemIndex].programDaysInMonth = programDaysInMonth;
    cart.items[itemIndex].price = sponsorship.pricePerMonth;

    await cart.save();

    res.json(cart);
  } catch (error) {
    res.status(500).json({ error: 'Erro ao atualizar mês do patrocínio' });
  }
};

// Atualizar material de patrocínio (por tipo de inserção)
export const updateSponsorshipMaterial = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!req.userId) {
      res.status(401).json({ error: 'Usuário não autenticado' });
      return;
    }

    const { productId, insertionName, material } = req.body;

    if (!productId || !insertionName || !material) {
      res.status(400).json({ error: 'productId, insertionName e material são obrigatórios' });
      return;
    }

    const cart = await Cart.findOne({ userId: req.userId });
    if (!cart) {
      res.status(404).json({ error: 'Carrinho não encontrado' });
      return;
    }

    const itemIndex = cart.items.findIndex(
      item => item.productId.toString() === productId && item.itemType === 'sponsorship'
    );

    if (itemIndex === -1 || !cart.items[itemIndex]) {
      res.status(404).json({ error: 'Patrocínio não encontrado no carrinho' });
      return;
    }

    // Sanitiza URLs de material contra path traversal
    if (material.audioUrl && (typeof material.audioUrl !== 'string' || !material.audioUrl.startsWith('https://'))) {
      res.status(400).json({ error: 'URL de áudio inválida' });
      return;
    }

    if (!cart.items[itemIndex].sponsorshipMaterials) {
      cart.items[itemIndex].sponsorshipMaterials = {} as any;
    }
    (cart.items[itemIndex].sponsorshipMaterials as any)[insertionName] = material;

    cart.markModified(`items.${itemIndex}.sponsorshipMaterials`);
    await cart.save();

    res.json(cart);
  } catch (error) {
    res.status(500).json({ error: 'Erro ao atualizar material do patrocínio' });
  }
};
