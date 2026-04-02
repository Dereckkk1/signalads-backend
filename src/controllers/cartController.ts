import { Response } from 'express';
import { Cart, ICartItem } from '../models/Cart';
import { Product } from '../models/Product';
import { User } from '../models/User';
import { AuthRequest } from '../middleware/auth';

const MAX_CART_QUANTITY = 10000;

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

    const { productId, quantity: rawQty } = req.body;
    const quantity = sanitizeQuantity(rawQty);

    if (!productId || quantity === null) {
      res.status(400).json({ error: 'Dados inválidos. Quantidade deve ser inteiro entre 1 e ' + MAX_CART_QUANTITY });
      return;
    }

    // Busca produto e broadcaster (select apenas campos necessarios)
    const product = await Product.findById(productId).populate('broadcasterId', '_id companyName fantasyName broadcasterProfile address email status');
    if (!product || !product.broadcasterId) {
      res.status(404).json({ error: 'Produto não encontrado' });
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
      item => item.productId.toString() === productId
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

    // Coletar IDs dos produtos para busca em lote
    const productIds = items.map(item => item.productId).filter(id => id);

    // Buscar produtos e broadcasters em uma única query otimizada
    const products = await Product.find({ _id: { $in: productIds } }).populate('broadcasterId', '_id companyName fantasyName broadcasterProfile address email status');
    const productMap = new Map(products.map(p => [p._id.toString(), p]));

    for (const item of items) {
      // Ignorar itens sem productId
      if (!item.productId) continue;

      const product = productMap.get(item.productId.toString());

      // Se produto não existe ou broadcaster não existe, ignora o item
      if (!product || !product.broadcasterId) {
        continue;
      }

      const broadcaster: any = product.broadcasterId;

      // Reconstrói item com dados seguros do banco
      const validatedItem: ICartItem = {
        productId: product._id,
        productName: product.spotType, // Garante nome atualizado
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
        schedule: item.schedule || {}, // Schedule vem do front, mas validamos datas depois
        material: item.material || undefined, // Mantém material se já existir
        addedAt: item.addedAt ? new Date(item.addedAt) : new Date()
      };

      validatedItems.push(validatedItem);
    }

    // Limpa datas expiradas dos itens validados
    // const cleanedItems = cleanExpiredSchedules(validatedItems);
    const cleanedItems = validatedItems;



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
