#!/usr/bin/env node

/**
 * Script para corrigir dados de socialClass no banco
 * Converte objetos como { classA: 25, classB: 25, classC: 25, classDE: 25 }
 * para strings legíveis como "A: 25%, B: 25%, C: 25%, DE: 25%"
 */

import dotenv from 'dotenv';
import mongoose from 'mongoose';

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
  console.log('🔍 Corrigindo dados de socialClass...');
  
  try {
    const db = mongoose.connection.db;
    if (!db) {
      throw new Error('Conexão com banco não disponível');
    }
    
    // Busca documentos com socialClass como objeto
    const rawUsers = await db.collection('users').find({
      userType: 'broadcaster',
      'broadcasterProfile.audienceProfile.socialClass': { 
        $type: 'object', 
        $exists: true 
      }
    }).toArray();
    
    console.log(`🐛 Encontrados ${rawUsers.length} usuários com problema`);
    
    let fixedCount = 0;
    
    for (const user of rawUsers) {
      const socialClass = user.broadcasterProfile?.audienceProfile?.socialClass;
      
      if (socialClass && typeof socialClass === 'object') {
        console.log(`🔧 Corrigindo usuário: ${user.email}`);
        console.log(`   Objeto atual:`, socialClass);
        
        // Converte objeto para string legível
        const parts = [];
        if (socialClass.classA > 0) parts.push(`A: ${socialClass.classA}%`);
        if (socialClass.classB > 0) parts.push(`B: ${socialClass.classB}%`);
        if (socialClass.classC > 0) parts.push(`C: ${socialClass.classC}%`);
        if (socialClass.classDE > 0) parts.push(`DE: ${socialClass.classDE}%`);
        
        const newSocialClass = parts.join(', ');
        console.log(`   Nova string: "${newSocialClass}"`);
        
        // Atualiza o documento diretamente
        await db.collection('users').updateOne(
          { _id: user._id },
          {
            $set: {
              'broadcasterProfile.audienceProfile.socialClass': newSocialClass
            }
          }
        );
        
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