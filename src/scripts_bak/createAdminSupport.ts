/**
 * Script para criar conversas de suporte entre todas as emissoras e o admin
 * Executa: npx ts-node src/scripts/createAdminSupport.ts
 */

import mongoose from 'mongoose';
import { User } from '../models/User';
import { Conversation } from '../models/Conversation';

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://marketingE-radios:xwT7VEJ04rnHHBFu@cluster0.bnx0k.mongodb.net/E-radios?retryWrites=true&w=majority';

async function createAdminSupportConversations() {
  try {
    console.log('🔌 Conectando ao MongoDB...');
    await mongoose.connect(MONGODB_URI);
    console.log('✅ Conectado ao MongoDB');

    // Buscar admin principal (primeiro admin criado ou com email específico)
    const admin = await User.findOne({ 
      userType: 'admin'
    }).sort({ createdAt: 1 });

    if (!admin) {
      console.log('❌ Nenhum admin encontrado. Crie um admin primeiro.');
      process.exit(1);
    }

    console.log('👤 Admin encontrado:', {
      id: admin._id,
      email: admin.email,
      name: admin.name || admin.email
    });

    // Buscar todas as emissoras aprovadas
    const broadcasters = await User.find({
      userType: 'broadcaster',
      status: 'approved'
    }).select('-password');

    console.log(`📻 ${broadcasters.length} emissoras encontradas`);

    let created = 0;
    let existing = 0;

    for (const broadcaster of broadcasters) {
      const broadcasterId = broadcaster._id.toString();
      const adminId = admin._id.toString();

      // Verificar se já existe conversa
      const existingConversation = await Conversation.findOne({
        advertiserId: adminId,
        broadcasterId: broadcasterId
      });

      if (existingConversation) {
        console.log(`⏭️  Conversa já existe com ${broadcaster.companyName}`);
        existing++;
        continue;
      }

      // Criar nova conversa
      const broadcasterProfile = broadcaster.broadcasterProfile;
      const generalInfo = broadcasterProfile?.generalInfo || {};

      const conversation = new Conversation({
        advertiserId: adminId,
        advertiserName: 'Suporte E-rádios',
        broadcasterId: broadcasterId,
        broadcasterName: generalInfo.stationName || broadcaster.companyName || 'Emissora',
        broadcasterLogo: broadcasterProfile?.logo || '',
        broadcasterDial: generalInfo.dialFrequency || '',
        broadcasterBand: generalInfo.band || '',
        messages: [{
          senderId: adminId,
          senderName: 'Suporte E-rádios',
          senderType: 'admin',
          message: `Olá ${generalInfo.stationName || broadcaster.companyName}! 👋\n\nEste é o canal de suporte da plataforma E-rádios. Estamos aqui para ajudar com qualquer dúvida ou problema.\n\nSinta-se à vontade para entrar em contato sempre que precisar!`,
          timestamp: new Date(),
          read: false
        }],
        relatedOrders: [],
        lastMessageAt: new Date(),
        lastMessageBy: adminId,
        unreadCount: {
          advertiser: 0,
          broadcaster: 1 // 1 mensagem não lida para a emissora
        }
      });

      await conversation.save();
      console.log(`✅ Conversa criada com ${broadcaster.companyName}`);
      created++;
    }

    console.log('\n📊 Resumo:');
    console.log(`   ✅ Conversas criadas: ${created}`);
    console.log(`   ⏭️  Conversas já existentes: ${existing}`);
    console.log(`   📻 Total de emissoras: ${broadcasters.length}`);

  } catch (error) {
    console.error('❌ Erro ao criar conversas de suporte:', error);
  } finally {
    await mongoose.connection.close();
    console.log('🔌 Conexão fechada');
  }
}

// Executar script
createAdminSupportConversations();
