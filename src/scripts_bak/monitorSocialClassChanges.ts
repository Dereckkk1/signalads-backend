#!/usr/bin/env node

/**
 * Script para monitorar em tempo real criação de socialClass incorreto
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

const monitorChanges = async () => {
  console.log('🔍 Monitorando mudanças na collection users...');
  
  try {
    const db = mongoose.connection.db;
    if (!db) {
      throw new Error('Conexão com banco não disponível');
    }
    
    // Monitor de mudanças na collection users
    const changeStream = db.collection('users').watch([
      {
        $match: {
          'fullDocument.userType': 'broadcaster'
        }
      }
    ], { fullDocument: 'updateLookup' });

    changeStream.on('change', (change) => {
      console.log('\n📝 Mudança detectada:');
      console.log('   Tipo:', change.operationType);
      console.log('   DocumentKey:', change.documentKey);
      
      if (change.fullDocument) {
        const socialClass = change.fullDocument.broadcasterProfile?.audienceProfile?.socialClass;
        
        if (socialClass !== undefined) {
          console.log('   socialClass tipo:', typeof socialClass);
          console.log('   socialClass valor:', socialClass);
          
          if (typeof socialClass === 'object') {
            console.log('🚨 ALERTA: socialClass como OBJETO detectado!');
            console.log('   Email:', change.fullDocument.email);
            console.log('   Valor problemático:', JSON.stringify(socialClass));
          }
        }
      }
      
      if (change.updateDescription) {
        console.log('   Campos atualizados:', Object.keys(change.updateDescription.updatedFields || {}));
        
        // Verifica se algum campo de socialClass foi atualizado
        const updatedFields = change.updateDescription.updatedFields || {};
        for (const fieldPath in updatedFields) {
          if (fieldPath.includes('socialClass')) {
            console.log(`   Campo socialClass atualizado: ${fieldPath}`);
            console.log(`   Novo valor:`, updatedFields[fieldPath]);
            console.log(`   Tipo:`, typeof updatedFields[fieldPath]);
          }
        }
      }
    });

    console.log('👀 Monitoramento ativo. Faça alterações nos dados para testar...');
    console.log('🔴 Pressione Ctrl+C para parar');

  } catch (error) {
    console.error('❌ Erro durante monitoramento:', error);
  }
};

const main = async () => {
  console.log('🚀 Iniciando monitoramento em tempo real...');
  
  await connectDB();
  await monitorChanges();
  
  // Mantém o script rodando
  process.on('SIGINT', () => {
    console.log('\n🏁 Monitoramento finalizado');
    process.exit(0);
  });
};

// Executa apenas se chamado diretamente
if (require.main === module) {
  main().catch(error => {
    console.error('❌ Erro fatal:', error);
    process.exit(1);
  });
}