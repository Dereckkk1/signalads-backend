#!/usr/bin/env node

/**
 * Script para corrigir dados de socialClass no banco
 * 
 * O erro indica que alguns documentos têm socialClass como objeto
 * { classA: 0, classB: 0, classC: 0, classDE: 0 }
 * em vez de string conforme o schema.
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

const fixSocialClassData = async () => {
  console.log('🔍 Buscando usuários com socialClass incorreto...');
  
  try {
    // Busca todos os broadcasters
    const users = await User.find({
      userType: 'broadcaster',
      'broadcasterProfile.audienceProfile.socialClass': { $exists: true }
    });
    
    console.log(`📊 Encontrados ${users.length} usuários com socialClass`);
    
    let fixedCount = 0;
    
    for (const user of users) {
      const socialClass = user.broadcasterProfile?.audienceProfile?.socialClass;
      
      if (socialClass && typeof socialClass === 'object') {
        console.log(`🔧 Corrigindo usuário ${user.email}:`, socialClass);
        
        // Garante que as propriedades existem
        if (!user.broadcasterProfile) {
          user.broadcasterProfile = {};
        }
        if (!user.broadcasterProfile.audienceProfile) {
          user.broadcasterProfile.audienceProfile = {};
        }
        
        // Converte objeto para string vazia (usuário pode repreenchr)
        user.broadcasterProfile.audienceProfile.socialClass = '';
        
        // Força save marcando o campo como modificado
        user.markModified('broadcasterProfile.audienceProfile.socialClass');
        
        await user.save();
        
        fixedCount++;
        console.log(`✅ Corrigido: ${user.email}`);
      }
    }
    
    console.log(`🎉 Correção concluída: ${fixedCount} usuários corrigidos`);
    
  } catch (error) {
    console.error('❌ Erro durante a correção:', error);
  }
};

const main = async () => {
  console.log('🚀 Iniciando correção de dados socialClass...');
  
  await connectDB();
  await fixSocialClassData();
  
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