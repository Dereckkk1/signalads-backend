#!/usr/bin/env node

/**
 * Script para testar login e identificar onde está ocorrendo o erro de socialClass
 */

import dotenv from 'dotenv';
import mongoose from 'mongoose';

// Carrega variáveis de ambiente
dotenv.config();

// Importa o modelo User
import { User } from '../models/User';

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

const testUserLoading = async () => {
  console.log('🔍 Testando carregamento de usuários...');
  
  try {
    console.log('\n📊 1. Buscando todos os broadcasters...');
    
    const broadcasters = await User.find({ userType: 'broadcaster' });
    console.log(`   Encontrados: ${broadcasters.length} broadcasters`);
    
    for (const user of broadcasters) {
      console.log(`\n🔍 Testando: ${user.email}`);
      console.log(`   ID: ${user._id}`);
      
      const socialClass = user.broadcasterProfile?.audienceProfile?.socialClass;
      console.log(`   socialClass: "${socialClass}"`);
      console.log(`   Tipo: ${typeof socialClass}`);
      
      // Tenta forçar uma validação
      try {
        const validatedUser = await user.validate();
        console.log(`   ✅ Validação passou`);
      } catch (validationError: any) {
        console.log(`   ❌ Erro de validação: ${validationError.message}`);
        
        if (validationError.errors) {
          Object.keys(validationError.errors).forEach(key => {
            console.log(`     ${key}: ${validationError.errors[key].message}`);
          });
        }
      }
      
      // Tenta buscar o usuário pelo ID (simula login)
      try {
        const foundUser = await User.findById(user._id);
        if (foundUser) {
          console.log(`   ✅ Busca por ID passou`);
        }
      } catch (findError: any) {
        console.log(`   ❌ Erro na busca por ID: ${findError.message}`);
      }
      
      // Tenta buscar pelo email (simula login por email)
      try {
        const foundByEmail = await User.findOne({ email: user.email });
        if (foundByEmail) {
          console.log(`   ✅ Busca por email passou`);
        }
      } catch (emailError: any) {
        console.log(`   ❌ Erro na busca por email: ${emailError.message}`);
      }
    }
    
    console.log('\n🧪 2. Teste com agregação...');
    
    // Testa agregação que pode estar sendo usada em algum lugar
    try {
      const agg = await User.aggregate([
        { $match: { userType: 'broadcaster' } },
        { $limit: 1 }
      ]);
      
      console.log(`   ✅ Agregação passou: ${agg.length} resultado(s)`);
      
      if (agg.length > 0) {
        const aggUser = agg[0];
        const aggSocialClass = aggUser.broadcasterProfile?.audienceProfile?.socialClass;
        console.log(`   socialClass na agregação: "${aggSocialClass}"`);
        console.log(`   Tipo: ${typeof aggSocialClass}`);
      }
    } catch (aggError: any) {
      console.log(`   ❌ Erro na agregação: ${aggError.message}`);
    }
    
    console.log('\n🔍 3. Verificando dados brutos...');
    
    // Verifica dados brutos diretamente na collection
    const db = mongoose.connection.db;
    if (!db) {
      throw new Error('Conexão com banco não disponível');
    }
    
    const rawUsers = await db.collection('users').find({ 
      userType: 'broadcaster' 
    }).toArray();
    
    for (const rawUser of rawUsers) {
      const rawSocialClass = rawUser.broadcasterProfile?.audienceProfile?.socialClass;
      console.log(`\n   Raw ${rawUser.email}:`);
      console.log(`     socialClass: ${JSON.stringify(rawSocialClass)}`);
      console.log(`     Tipo: ${typeof rawSocialClass}`);
      
      // Verifica se é realmente uma string
      if (typeof rawSocialClass === 'string') {
        console.log(`     ✅ É string válida`);
      } else if (rawSocialClass === null || rawSocialClass === undefined) {
        console.log(`     ⚠️ É null/undefined`);
      } else {
        console.log(`     ❌ NÃO é string! Tipo: ${typeof rawSocialClass}`);
        console.log(`     Valor: ${JSON.stringify(rawSocialClass)}`);
      }
    }
    
  } catch (error: any) {
    console.error('❌ Erro durante o teste:', error.message);
    console.error('Stack:', error.stack);
  }
};

const main = async () => {
  console.log('🚀 Iniciando teste de carregamento de usuários...');
  
  await connectDB();
  await testUserLoading();
  
  console.log('\n🏁 Teste finalizado');
  process.exit(0);
};

// Executa apenas se chamado diretamente
if (require.main === module) {
  main().catch(error => {
    console.error('❌ Erro fatal:', error);
    process.exit(1);
  });
}