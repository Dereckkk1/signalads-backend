import { Request, Response } from 'express';
import { Conversation } from '../models/Conversation';
import { User, IUser } from '../models/User';
import Order, { IOrder } from '../models/Order';
import { uploadFile } from '../config/storage';
import { AuthRequest } from '../middleware/auth';

// Listar todas as conversas do usuário
export const getConversations = async (req: AuthRequest, res: Response) => {
  try {
    // req.user é o documento do Mongoose, então _id é um ObjectId
    // Precisamos converter para string para comparar
    const userId = req.user?._id?.toString();
    const userType = req.user?.userType;



    if (!userId || !userType) {
      return res.status(401).json({ message: 'Usuário não autenticado' });
    }

    let query;

    // Admin pode ver conversas tanto como advertiser quanto broadcaster
    if (userType === 'admin') {
      query = { advertiserId: userId };
    } else if (userType === 'broadcaster') {
      query = { broadcasterId: userId };
    } else {
      query = { advertiserId: userId };
    }


    const conversations = await Conversation.find(query)
      .sort({ lastMessageAt: -1 })
      .lean();


    // Se for comprador (advertiser/agency), garantir conversa com Suporte
    if (userType === 'advertiser' || userType === 'agency') {
      const supportUserId = process.env.SUPPORT_USER_ID;

      if (supportUserId) {
        // Verificar se já existe conversa com Suporte
        const hasSupportConversation = conversations.some(
          conv => conv.broadcasterId === supportUserId
        );

        if (!hasSupportConversation) {

          // Buscar dados do usuário de suporte
          const supportUser = await User.findById(supportUserId);
          const currentUser = req.user;

          if (supportUser && currentUser) {
            // Criar conversa com Suporte
            const supportConversation = await Conversation.create({
              advertiserId: userId,
              advertiserName: currentUser.name || currentUser.email,
              broadcasterId: supportUserId,
              broadcasterName: 'Suporte E-radios',
              broadcasterLogo: '', // Pode adicionar logo do suporte depois
              broadcasterDial: '',
              broadcasterBand: '',
              relatedOrders: [],
              messages: [{
                senderId: supportUserId,
                senderName: 'Suporte E-radios',
                senderType: 'admin',
                message: 'Olá! 👋 Como podemos ajudar você hoje? Nossa equipe está disponível para responder suas dúvidas sobre a plataforma, campanhas, faturamento ou qualquer outra questão.',
                timestamp: new Date(),
                read: false
              }],
              lastMessageAt: new Date(),
              lastMessageBy: supportUserId,
              unreadCount: { advertiser: 1, broadcaster: 0 },
              isPinned: true // Marcar como conversa fixada
            });


            // Adicionar ao início da lista (como objeto plain para .lean())
            conversations.unshift(supportConversation.toObject());
          }
        } else {

          // Garantir que conversa com Suporte está no topo (se for pinada)
          const supportIndex = conversations.findIndex(
            conv => conv.broadcasterId === supportUserId
          );

          if (supportIndex > 0) {
            const [supportConv] = conversations.splice(supportIndex, 1);
            if (supportConv) {
              conversations.unshift(supportConv);
            }
          }
        }
      } else {
        console.warn('⚠️ SUPPORT_USER_ID não configurado no .env');
      }
    }

    if (conversations.length > 0 && conversations[0]) {

    }

    res.json({ conversations });
  } catch (error: any) {
    console.error('❌ Erro ao buscar conversas:', error);
    res.status(500).json({ message: 'Erro ao buscar conversas', error: error.message });
  }
};

// Buscar ou criar conversa entre comprador e emissora
export const getOrCreateConversation = async (req: AuthRequest, res: Response) => {
  try {
    const { otherPartyId } = req.params;
    // Converter _id do Mongoose para string
    const userId = req.user?._id?.toString();
    const userType = req.user?.userType;

    if (!userId || !userType) {
      return res.status(401).json({ message: 'Usuário não autenticado' });
    }

    // Determinar quem é o comprador e quem é a emissora
    const isAdvertiser = userType === 'advertiser' || userType === 'agency';
    const advertiserId = isAdvertiser ? userId : otherPartyId;
    const broadcasterId = isAdvertiser ? otherPartyId : userId;

    // Buscar conversa existente
    let conversation = await Conversation.findOne({
      advertiserId,
      broadcasterId
    });

    // Se não existir, criar nova
    if (!conversation) {
      const advertiser = await User.findById(advertiserId);
      const broadcaster = await User.findById(broadcasterId);

      if (!advertiser || !broadcaster) {
        return res.status(404).json({ message: 'Usuário não encontrado' });
      }

      // Buscar pedidos relacionados
      const orders = await Order.find({
        buyerId: advertiserId,
        'items.broadcasterId': broadcasterId
      }).select('_id');

      // Determinar nome do usuário
      const advertiserName = advertiser.fantasyName || advertiser.companyName || advertiser.email;
      const broadcasterName = broadcaster.fantasyName || broadcaster.companyName || broadcaster.email;

      // Extrair logo, dial e band da emissora
      const broadcasterLogo = broadcaster.broadcasterProfile?.logo || '';
      const broadcasterDial = broadcaster.broadcasterProfile?.generalInfo?.dialFrequency || '';
      const broadcasterBand = broadcaster.broadcasterProfile?.generalInfo?.band || '';

      conversation = await Conversation.create({
        advertiserId,
        advertiserName,
        broadcasterId,
        broadcasterName,
        broadcasterLogo,
        broadcasterDial,
        broadcasterBand,
        relatedOrders: orders.map((o: any) => o._id.toString()),
        messages: [],
        lastMessageAt: new Date(),
        unreadCount: { advertiser: 0, broadcaster: 0 }
      });

    }

    res.json({ conversation });
  } catch (error: any) {
    console.error('❌ Erro ao buscar/criar conversa:', error);
    res.status(500).json({ message: 'Erro ao processar conversa', error: error.message });
  }
};

// Enviar mensagem (com ou sem anexos)
export const sendMessage = async (req: AuthRequest, res: Response) => {
  try {
    const { conversationId } = req.params;
    const { message } = req.body;
    // Converter _id do Mongoose para string
    const userId = req.user?._id?.toString();
    const userType = req.user?.userType;

    if (!userId || !userType) {
      return res.status(401).json({ message: 'Usuário não autenticado' });
    }

    const conversation = await Conversation.findById(conversationId);
    if (!conversation) {
      return res.status(404).json({ message: 'Conversa não encontrada' });
    }

    // Buscar nome do remetente
    const sender = await User.findById(userId);
    if (!sender) {
      return res.status(404).json({ message: 'Usuário não encontrado' });
    }

    const senderName = sender.fantasyName || sender.companyName || sender.email;

    // Processar anexos se houver
    let attachments: { type: 'audio' | 'image' | 'document'; url: string; fileName: string; fileSize: number; }[] = [];
    if (req.file) {
      const fileUrl = await uploadFile(
        req.file.buffer,
        req.file.originalname,
        'chat-attachments',
        req.file.mimetype
      );

      const fileType: 'audio' | 'image' | 'document' = req.file.mimetype.startsWith('audio/')
        ? 'audio'
        : req.file.mimetype.startsWith('image/')
          ? 'image'
          : 'document';

      attachments.push({
        type: fileType,
        url: fileUrl,
        fileName: req.file.originalname,
        fileSize: req.file.size
      });
    }

    // Adicionar mensagem
    const newMessage = {
      senderId: userId,
      senderName,
      senderType: userType as 'advertiser' | 'agency' | 'broadcaster',
      message: message || '',
      attachments,
      timestamp: new Date(),
      read: false
    };

    conversation.messages.push(newMessage);
    conversation.lastMessageAt = new Date();
    conversation.lastMessageBy = userId;

    // Incrementar contador de não lidas para o outro participante
    const isAdvertiserSending = userId === conversation.advertiserId;
    if (isAdvertiserSending) {
      conversation.unreadCount.broadcaster += 1;
    } else {
      conversation.unreadCount.advertiser += 1;
    }

    await conversation.save();


    res.json({
      message: 'Mensagem enviada com sucesso',
      newMessage,
      conversation
    });
  } catch (error: any) {
    console.error('❌ Erro ao enviar mensagem:', error);
    res.status(500).json({ message: 'Erro ao enviar mensagem', error: error.message });
  }
};

// Marcar mensagens como lidas
export const markAsRead = async (req: AuthRequest, res: Response) => {
  try {
    const { conversationId } = req.params;
    // Converter _id do Mongoose para string
    const userId = req.user?._id?.toString();
    const userType = req.user?.userType;

    if (!userId || !userType) {
      return res.status(401).json({ message: 'Usuário não autenticado' });
    }

    const conversation = await Conversation.findById(conversationId);
    if (!conversation) {
      return res.status(404).json({ message: 'Conversa não encontrada' });
    }

    // Marcar mensagens não lidas do outro participante como lidas
    const isAdvertiser = userId === conversation.advertiserId;
    const otherPartyId = isAdvertiser ? conversation.broadcasterId : conversation.advertiserId;

    conversation.messages.forEach(msg => {
      if (msg.senderId === otherPartyId && !msg.read) {
        msg.read = true;
      }
    });

    // Zerar contador de não lidas
    if (isAdvertiser) {
      conversation.unreadCount.advertiser = 0;
    } else {
      conversation.unreadCount.broadcaster = 0;
    }

    await conversation.save();


    res.json({ message: 'Mensagens marcadas como lidas' });
  } catch (error: any) {
    console.error('❌ Erro ao marcar como lida:', error);
    res.status(500).json({ message: 'Erro ao marcar como lida', error: error.message });
  }
};

// Obter histórico de mensagens de uma conversa
export const getMessages = async (req: AuthRequest, res: Response) => {
  try {
    const { conversationId } = req.params;
    // Converter _id do Mongoose para string
    const userId = req.user?._id?.toString();

    if (!userId) {
      return res.status(401).json({ message: 'Usuário não autenticado' });
    }

    const conversation = await Conversation.findById(conversationId);
    if (!conversation) {
      return res.status(404).json({ message: 'Conversa não encontrada' });
    }

    // Verificar se o usuário faz parte da conversa
    if (conversation.advertiserId !== userId && conversation.broadcasterId !== userId) {
      return res.status(403).json({ message: 'Acesso negado a esta conversa' });
    }

    res.json({
      messages: conversation.messages,
      conversation: {
        advertiserId: conversation.advertiserId,
        advertiserName: conversation.advertiserName,
        broadcasterId: conversation.broadcasterId,
        broadcasterName: conversation.broadcasterName
      }
    });
  } catch (error: any) {
    console.error('❌ Erro ao buscar mensagens:', error);
    res.status(500).json({ message: 'Erro ao buscar mensagens', error: error.message });
  }
};

// Criar conversa automaticamente quando pedido é criado (chamado internamente)
export const createConversationFromOrder = async (orderId: string) => {
  try {
    const order = await Order.findById(orderId);
    if (!order) {
      console.error('❌ Pedido não encontrado para criar conversa:', orderId);
      return;
    }

    // Para cada emissora única no pedido
    const broadcasterIds = [...new Set(order.items.map((item: any) => item.broadcasterId))];

    for (const broadcasterId of broadcasterIds) {
      const advertiserId = order.buyerId;

      // Verificar se já existe conversa
      const existing = await Conversation.findOne({
        advertiserId: advertiserId.toString(),
        broadcasterId: broadcasterId.toString()
      });

      if (existing) {
        // Adicionar orderId aos relacionados se não existir
        if (!existing.relatedOrders.includes(orderId)) {
          existing.relatedOrders.push(orderId);
          await existing.save();
        }
        continue;
      }

      // Criar nova conversa
      const advertiser = await User.findById(advertiserId);
      const broadcaster = await User.findById(broadcasterId);

      if (!advertiser || !broadcaster) {
        console.error('❌ Usuário não encontrado:', { advertiserId, broadcasterId });
        continue;
      }

      const advertiserName = advertiser.fantasyName || advertiser.companyName || advertiser.email;
      const broadcasterName = broadcaster.fantasyName || broadcaster.companyName || broadcaster.email;

      // Extrair logo, dial e band da emissora
      const broadcasterLogo = broadcaster.broadcasterProfile?.logo || '';
      const broadcasterDial = broadcaster.broadcasterProfile?.generalInfo?.dialFrequency || '';
      const broadcasterBand = broadcaster.broadcasterProfile?.generalInfo?.band || '';

      const conversation = await Conversation.create({
        advertiserId: advertiserId.toString(),
        advertiserName,
        broadcasterId: broadcasterId.toString(),
        broadcasterName,
        broadcasterLogo,
        broadcasterDial,
        broadcasterBand,
        relatedOrders: [orderId],
        messages: [{
          senderId: 'system',
          senderName: 'E-rádios',
          senderType: 'advertiser' as const,
          message: `🎉 Novo pedido criado! ${advertiserName} comprou produtos de ${broadcasterName}. Use este chat para conversar sobre materiais, suporte e detalhes da campanha.`,
          timestamp: new Date(),
          read: false
        }],
        lastMessageAt: new Date(),
        unreadCount: { advertiser: 0, broadcaster: 1 }
      });

    }
  } catch (error: any) {
    console.error('❌ Erro ao criar conversa do pedido:', error.message);
  }
};
