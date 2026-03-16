import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import Order from '../models/Order';
import { User } from '../models/User';
import { uploadFile } from '../config/storage';
import { 
  sendMaterialRejectedByBroadcaster,
  sendMaterialProducedByBroadcaster,
  sendMaterialApprovedByClient,
  sendMaterialRejectedByClient
} from '../services/emailService';

// Helper para validar itemIndex
const getOrderItem = (order: any, itemIndex: string | undefined) => {
  if (!itemIndex) {
    throw new Error('itemIndex não fornecido');
  }
  const item = order.items[parseInt(itemIndex)];
  if (!item) {
    throw new Error('Item não encontrado');
  }
  return item;
};

// Enviar mensagem no chat de materiais
export const sendMessage = async (req: AuthRequest, res: Response) => {
  try {
    const { orderId, itemIndex } = req.params;
    const { message } = req.body;
    const userId = req.userId;
    const userType = req.user?.userType;

    const order = await Order.findById(orderId);
    if (!order) {
      return res.status(404).json({ error: 'Pedido não encontrado' });
    }

    const item = getOrderItem(order, itemIndex);

    // Verifica se o usuário tem permissão
    const isBroadcaster = userType === 'broadcaster' && item.broadcasterId === userId;
    const isClient = ['advertiser', 'agency'].includes(userType || '') && order.buyerId.toString() === userId;

    if (!isBroadcaster && !isClient) {
      return res.status(403).json({ error: 'Sem permissão para acessar este chat' });
    }

    // Adiciona mensagem ao chat
    const chatMessage = {
      sender: isBroadcaster ? 'broadcaster' as const : 'client' as const,
      message,
      timestamp: new Date()
    };

    if (!item.material.chat) {
      item.material.chat = [];
    }
    item.material.chat.push(chatMessage);

    await order.save();


    res.json({ success: true, message: chatMessage });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Erro ao enviar mensagem' });
  }
};

// Upload de áudio pela emissora (produção própria)
export const uploadBroadcasterProduction = async (req: AuthRequest, res: Response) => {
  try {
    const { orderId, itemIndex } = req.params;
    const { notes, audioDuration } = req.body;
    const userId = req.userId;
    const userType = req.user?.userType;

    if (!req.file) {
      return res.status(400).json({ error: 'Arquivo de áudio não enviado' });
    }

    const order = await Order.findById(orderId);
    if (!order) {
      return res.status(404).json({ error: 'Pedido não encontrado' });
    }

    const item = getOrderItem(order, itemIndex);

    // Verifica se é a emissora dona do produto
    if (userType !== 'broadcaster' || item.broadcasterId !== userId) {
      return res.status(403).json({ error: 'Apenas a emissora pode enviar produção' });
    }

    // Upload do áudio para storage
    const audioUrl = await uploadFile(
      req.file.buffer, 
      req.file.originalname, 
      'audio', 
      req.file.mimetype
    );

    // Salva produção da emissora
    item.material.broadcasterProduction = {
      audioUrl,
      audioFileName: req.file.originalname,
      audioDuration: parseFloat(audioDuration) || 0,
      producedAt: new Date(),
      notes: notes || ''
    };

    // Atualiza status
    item.material.status = 'broadcaster_produced';

    // Adiciona ao chat
    if (!item.material.chat) {
      item.material.chat = [];
    }
    item.material.chat.push({
      sender: 'broadcaster',
      message: notes || 'Áudio produzido pela emissora',
      fileUrl: audioUrl,
      fileName: req.file.originalname,
      action: 'uploaded',
      timestamp: new Date()
    });

    await order.save();


    // Envia email para o cliente
    await sendMaterialProducedByBroadcaster({
      clientEmail: order.buyerEmail,
      clientName: order.buyerName,
      orderNumber: order.orderNumber,
      broadcasterName: item.broadcasterName,
      audioUrl,
      notes: notes || ''
    });

    res.json({ 
      success: true, 
      production: item.material.broadcasterProduction,
      audioUrl 
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Erro ao enviar produção' });
  }
};

// Emissora rejeita material do cliente
export const broadcasterRejectMaterial = async (req: AuthRequest, res: Response) => {
  try {
    const { orderId, itemIndex } = req.params;
    const { reason } = req.body;
    const userId = req.userId;
    const userType = req.user?.userType;

    const order = await Order.findById(orderId);
    if (!order) {
      return res.status(404).json({ error: 'Pedido não encontrado' });
    }

    const item = getOrderItem(order, itemIndex);

    if (userType !== 'broadcaster' || item.broadcasterId !== userId) {
      return res.status(403).json({ error: 'Apenas a emissora pode rejeitar material' });
    }

    item.material.status = 'broadcaster_rejected';

    if (!item.material.chat) {
      item.material.chat = [];
    }
    item.material.chat.push({
      sender: 'broadcaster',
      message: reason,
      action: 'rejected',
      timestamp: new Date()
    });

    await order.save();


    // Envia email para o cliente
    await sendMaterialRejectedByBroadcaster({
      clientEmail: order.buyerEmail,
      clientName: order.buyerName,
      orderNumber: order.orderNumber,
      broadcasterName: item.broadcasterName,
      reason
    });

    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Erro ao rejeitar material' });
  }
};

// Emissora aprova material do cliente (áudio já pronto)
export const broadcasterApproveMaterial = async (req: AuthRequest, res: Response) => {
  try {
    const { orderId, itemIndex } = req.params;
    const userId = req.userId;
    const userType = req.user?.userType;

    const order = await Order.findById(orderId);
    if (!order) {
      return res.status(404).json({ error: 'Pedido não encontrado' });
    }

    const item = getOrderItem(order, itemIndex);

    if (userType !== 'broadcaster' || item.broadcasterId !== userId) {
      return res.status(403).json({ error: 'Apenas a emissora pode aprovar material' });
    }

    item.material.status = 'final_approved';

    if (!item.material.chat) {
      item.material.chat = [];
    }
    item.material.chat.push({
      sender: 'broadcaster',
      message: 'Material aprovado pela emissora',
      action: 'approved',
      timestamp: new Date()
    });

    await order.save();


    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Erro ao aprovar material' });
  }
};

// Cliente aprova produção da emissora
export const clientApproveMaterial = async (req: AuthRequest, res: Response) => {
  try {
    const { orderId, itemIndex } = req.params;
    const userId = req.userId;
    const userType = req.user?.userType;

    const order = await Order.findById(orderId);
    if (!order) {
      return res.status(404).json({ error: 'Pedido não encontrado' });
    }

    const item = getOrderItem(order, itemIndex);

    if (!['advertiser', 'agency'].includes(userType || '') || order.buyerId.toString() !== userId) {
      return res.status(403).json({ error: 'Apenas o cliente pode aprovar a produção' });
    }

    item.material.status = 'final_approved';

    if (!item.material.chat) {
      item.material.chat = [];
    }
    item.material.chat.push({
      sender: 'client',
      message: 'Produção aprovada pelo cliente',
      action: 'approved',
      timestamp: new Date()
    });

    await order.save();


    // Busca email da emissora
    const broadcaster = await User.findById(item.broadcasterId);

    // Envia email para a emissora
    await sendMaterialApprovedByClient({
      broadcasterEmail: broadcaster?.email || '',
      broadcasterName: item.broadcasterName,
      orderNumber: order.orderNumber,
      clientName: order.buyerName
    });

    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Erro ao aprovar produção' });
  }
};

// Cliente rejeita produção da emissora
export const clientRejectMaterial = async (req: AuthRequest, res: Response) => {
  try {
    const { orderId, itemIndex } = req.params;
    const { reason } = req.body;
    const userId = req.userId;
    const userType = req.user?.userType;

    const order = await Order.findById(orderId);
    if (!order) {
      return res.status(404).json({ error: 'Pedido não encontrado' });
    }

    const item = getOrderItem(order, itemIndex);

    if (!['advertiser', 'agency'].includes(userType || '') || order.buyerId.toString() !== userId) {
      return res.status(403).json({ error: 'Apenas o cliente pode rejeitar a produção' });
    }

    item.material.status = 'client_rejected';

    if (!item.material.chat) {
      item.material.chat = [];
    }
    item.material.chat.push({
      sender: 'client',
      message: reason,
      action: 'rejected',
      timestamp: new Date()
    });

    await order.save();


    // Busca email da emissora
    const broadcaster = await User.findById(item.broadcasterId);

    // Envia email para a emissora
    await sendMaterialRejectedByClient({
      broadcasterEmail: broadcaster?.email || '',
      broadcasterName: item.broadcasterName,
      orderNumber: order.orderNumber,
      clientName: order.buyerName,
      reason
    });

    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Erro ao rejeitar produção' });
  }
};

// Buscar histórico do chat
export const getChatHistory = async (req: AuthRequest, res: Response) => {
  try {
    const { orderId, itemIndex } = req.params;
    const userId = req.userId;
    const userType = req.user?.userType;

    const order = await Order.findById(orderId);
    if (!order) {
      return res.status(404).json({ error: 'Pedido não encontrado' });
    }

    const item = getOrderItem(order, itemIndex);

    // Verifica permissão
    const isBroadcaster = userType === 'broadcaster' && item.broadcasterId === userId;
    const isClient = ['advertiser', 'agency'].includes(userType || '') && order.buyerId.toString() === userId;

    if (!isBroadcaster && !isClient) {
      return res.status(403).json({ error: 'Sem permissão para acessar este chat' });
    }

    res.json({ 
      chat: item.material.chat || [],
      materialStatus: item.material.status,
      broadcasterProduction: item.material.broadcasterProduction
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Erro ao buscar chat' });
  }
};
