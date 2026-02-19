#!/usr/bin/env node

/**
 * Script para corrigir TODOS os dados de socialClass no banco
 * Inclui objetos com valores zero: { classA: 0, classB: 0, classC: 0, classDE: 0 }
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

const fixAllSocialClassData = async () => {
  console.log('🔍 Buscando TODOS os problemas de socialClass...');
  
  try {
    const db = mongoose.connection.db;
    if (!db) {
      throw new Error('Conexão com banco não disponível');
    }
    
    // Busca TODOS os documentos com socialClass como objeto (incluindo valores zero)
    const rawUsers = await db.collection('users').find({
      userType: 'broadcaster',
      'broadcasterProfile.audienceProfile.socialClass': { 
        $type: 'object'
      }
    }).toArray();
    
    console.log(`🐛 Encontrados ${rawUsers.length} usuários com socialClass como objeto`);
    
    let fixedCount = 0;
    
    for (const user of rawUsers) {
      const socialClass = user.broadcasterProfile?.audienceProfile?.socialClass;
      
      if (socialClass && typeof socialClass === 'object') {
        console.log(`🔧 Corrigindo usuário: ${user.email}`);
        console.log(`   Objeto atual:`, socialClass);
        
        // Verifica se todos os valores são zero
        const allZero = (
          (socialClass.classA || 0) === 0 &&
          (socialClass.classB || 0) === 0 &&
          (socialClass.classC || 0) === 0 &&
          (socialClass.classDE || 0) === 0
        );
        
        let newSocialClass = '';
        
        if (allZero) {
          // Se todos são zero, deixa string vazia
          newSocialClass = '';
          console.log(`   ⚪ Todos valores zero - definindo como string vazia`);
        } else {
          // Converte objeto para string legível
          const parts = [];
          if (socialClass.classA > 0) parts.push(`A: ${socialClass.classA}%`);
          if (socialClass.classB > 0) parts.push(`B: ${socialClass.classB}%`);
          if (socialClass.classC > 0) parts.push(`C: ${socialClass.classC}%`);
          if (socialClass.classDE > 0) parts.push(`DE: ${socialClass.classDE}%`);
          
          newSocialClass = parts.join(', ');
          console.log(`   Nova string: "${newSocialClass}"`);
        }
        
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
    
    // Segunda verificação para garantir que não há mais objetos
    const remainingProblems = await db.collection('users').find({
      userType: 'broadcaster',
      'broadcasterProfile.audienceProfile.socialClass': { 
        $type: 'object'
      }
    }).toArray();
    
    if (remainingProblems.length > 0) {
      console.log(`⚠️ ATENÇÃO: Ainda há ${remainingProblems.length} documentos com problema!`);
      for (const problem of remainingProblems) {
        console.log(`   - ${problem.email}: ${JSON.stringify(problem.broadcasterProfile?.audienceProfile?.socialClass)}`);
      }
    } else {
      console.log(`✅ PERFEITO: Nenhum documento com socialClass como objeto encontrado`);
    }
    
    console.log(`🎉 Correção concluída: ${fixedCount} usuários corrigidos`);
    
  } catch (error) {
    console.error('❌ Erro durante a correção:', error);
  }
};

const main = async () => {
  console.log('🚀 Iniciando correção COMPLETA de dados socialClass...');
  
  await connectDB();
  await fixAllSocialClassData();
  
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