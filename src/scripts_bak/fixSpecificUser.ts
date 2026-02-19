#!/usr/bin/env node

/**
 * Script para corrigir especificamente o usuário aliiicia.parker@gmail.com
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

const fixSpecificUser = async () => {
  console.log('🔧 Corrigindo usuário específico...');
  
  try {
    const db = mongoose.connection.db;
    if (!db) {
      throw new Error('Conexão com banco não disponível');
    }
    
    // Busca o usuário problemático
    const problematicUser = await db.collection('users').findOne({
      email: 'aliiicia.parker@gmail.com'
    });
    
    if (!problematicUser) {
      console.log('❌ Usuário aliiicia.parker@gmail.com não encontrado');
      return;
    }
    
    console.log('📊 Dados do usuário encontrado:');
    console.log(`   Email: ${problematicUser.email}`);
    console.log(`   UserType: ${problematicUser.userType}`);
    console.log(`   ID: ${problematicUser._id}`);
    
    const socialClass = problematicUser.broadcasterProfile?.audienceProfile?.socialClass;
    console.log(`   socialClass atual: ${JSON.stringify(socialClass)}`);
    console.log(`   Tipo: ${typeof socialClass}`);
    
    if (typeof socialClass === 'object' && socialClass !== null) {
      // Converte o objeto para string
      const parts = [];
      if (socialClass.classA > 0) parts.push(`A: ${socialClass.classA}%`);
      if (socialClass.classB > 0) parts.push(`B: ${socialClass.classB}%`);
      if (socialClass.classC > 0) parts.push(`C: ${socialClass.classC}%`);
      if (socialClass.classDE > 0) parts.push(`DE: ${socialClass.classDE}%`);
      
      const newSocialClass = parts.length > 0 ? parts.join(', ') : '';
      
      console.log(`   Nova socialClass: "${newSocialClass}"`);
      
      // Atualiza o documento
      const result = await db.collection('users').updateOne(
        { _id: problematicUser._id },
        {
          $set: {
            'broadcasterProfile.audienceProfile.socialClass': newSocialClass
          }
        }
      );
      
      console.log(`✅ Atualização realizada. Documentos modificados: ${result.modifiedCount}`);
      
      // Verifica se a correção funcionou
      const updatedUser = await db.collection('users').findOne({
        _id: problematicUser._id
      });
      
      const newSc = updatedUser?.broadcasterProfile?.audienceProfile?.socialClass;
      console.log(`🔍 Verificação pós-correção:`);
      console.log(`   socialClass: "${newSc}"`);
      console.log(`   Tipo: ${typeof newSc}`);
      
    } else {
      console.log('⚠️ socialClass não é um objeto - não precisa correção');
    }
    
    // Busca final por problemas remanescentes
    console.log('\n🔍 Verificação final...');
    
    const remainingProblems = await db.collection('users').find({
      'broadcasterProfile.audienceProfile.socialClass.classA': { $exists: true }
    }).toArray();
    
    if (remainingProblems.length > 0) {
      console.log(`❌ Ainda há ${remainingProblems.length} problema(s):`);
      for (const prob of remainingProblems) {
        console.log(`   ${prob.email}: ${JSON.stringify(prob.broadcasterProfile?.audienceProfile?.socialClass)}`);
      }
    } else {
      console.log('✅ Nenhum problema remanescente encontrado!');
    }
    
  } catch (error: any) {
    console.error('❌ Erro durante a correção:', error.message);
  }
};

const main = async () => {
  console.log('🚀 Iniciando correção do usuário específico...');
  
  await connectDB();
  await fixSpecificUser();
  
  console.log('\n🏁 Correção finalizada');
  process.exit(0);
};

// Executa apenas se chamado diretamente
if (require.main === module) {
  main().catch(error => {
    console.error('❌ Erro fatal:', error);
    process.exit(1);
  });
}