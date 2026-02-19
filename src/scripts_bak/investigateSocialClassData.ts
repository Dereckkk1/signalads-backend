#!/usr/bin/env node

/**
 * Script para investigar dados de socialClass no banco
 */

import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { User } from '../models/User';

// Carrega variáveis de ambiente
dotenv.config();

const connectDB = async () => {
  try {
    const mongoUri = process.env.MONGODB_URI;
    
    if (!mongoUri) {
      throw new Error('MONGODB_URI não está definida no arquivo .env');
    }

    await mongoose.connect(mongoUri);
    console.log('✅ Conectado ao MongoDB');
  } catch (error) {
    console.error('❌ Erro ao conectar no MongoDB:', error);
    process.exit(1);
  }
};

const investigateSocialClassData = async () => {
  console.log('🔍 Investigando dados de socialClass...');
  
  try {
    // Busca todos os broadcasters
    const users = await User.find({
      userType: 'broadcaster'
    });
    
    console.log(`📊 Encontrados ${users.length} usuários broadcasters`);
    
    for (const user of users) {
      const profile = user.broadcasterProfile;
      const audience = profile?.audienceProfile;
      const socialClass = audience?.socialClass;
      
      if (socialClass !== undefined) {
        console.log(`👤 Usuário: ${user.email}`);
        console.log(`   socialClass tipo: ${typeof socialClass}`);
        console.log(`   socialClass valor:`, socialClass);
        console.log(`   ---`);
      }
    }
    
    // Busca especificamente por documentos com socialClass como objeto
    try {
      const db = mongoose.connection.db;
      if (db) {
        const rawUsers = await db.collection('users').find({
          userType: 'broadcaster',
          'broadcasterProfile.audienceProfile.socialClass': { 
            $type: 'object', 
            $exists: true 
          }
        }).toArray();
        
        console.log(`🔧 Encontrados ${rawUsers.length} com socialClass como objeto`);
        
        for (const user of rawUsers) {
          console.log(`🐛 Problema em: ${user.email}`);
          console.log(`   socialClass:`, user.broadcasterProfile?.audienceProfile?.socialClass);
        }
      }
    } catch (error) {
      console.log('⚠️ Erro ao buscar dados raw:', error);
    }
    
  } catch (error) {
    console.error('❌ Erro durante a investigação:', error);
  }
};

const main = async () => {
  console.log('🚀 Iniciando investigação de dados socialClass...');
  
  await connectDB();
  await investigateSocialClassData();
  
  console.log('🏁 Script finalizado');
  process.exit(0);
};

// Executa apenas se chamado diretamente
if (require.main === module) {
  main().catch(error => {
    console.error('❌ Erro fatal:', error);
    process.exit(1);
  });
}