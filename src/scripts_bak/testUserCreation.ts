#!/usr/bin/env node

/**
 * Script para monitorar criação de documentos com socialClass incorreto
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

const testUserCreation = async () => {
  console.log('🧪 Testando criação de usuário broadcaster...');
  
  try {
    // Simula criação de broadcaster com audienceProfile
    const testBroadcaster = new User({
      companyName: 'Test Radio',
      email: 'test-radio-' + Date.now() + '@test.com',
      password: 'test123456',
      cpfOrCnpj: 'TEST-' + Date.now(),
      userType: 'broadcaster',
      phone: '11999999999',
      status: 'approved',
      onboardingCompleted: true,
      isCatalogOnly: true,
      managedByAdmin: true,
      broadcasterProfile: {
        generalInfo: {
          stationName: 'Test Radio FM',
          dialFrequency: '99.9',
          band: 'FM'
        },
        audienceProfile: {
          gender: {
            male: 50,
            female: 50
          },
          ageRange: '77% 30+',
          socialClass: '85% ABC' // STRING CORRETA
        }
      }
    });

    console.log('🔍 Dados que serão salvos:');
    console.log('   socialClass tipo:', typeof testBroadcaster.broadcasterProfile?.audienceProfile?.socialClass);
    console.log('   socialClass valor:', testBroadcaster.broadcasterProfile?.audienceProfile?.socialClass);

    await testBroadcaster.save();
    console.log('✅ Usuário de teste criado com sucesso:', testBroadcaster._id);

    // Verifica se foi salvo corretamente
    const saved = await User.findById(testBroadcaster._id);
    console.log('🔍 Verificando dados salvos:');
    console.log('   socialClass tipo:', typeof saved?.broadcasterProfile?.audienceProfile?.socialClass);
    console.log('   socialClass valor:', saved?.broadcasterProfile?.audienceProfile?.socialClass);

    // Remove o teste
    await User.findByIdAndDelete(testBroadcaster._id);
    console.log('🗑️ Usuário de teste removido');

  } catch (error: any) {
    console.error('❌ Erro durante teste:', error);
    
    if (error.name === 'ValidationError') {
      console.log('🔍 Detalhes do erro de validação:');
      Object.keys(error.errors).forEach(field => {
        const err = error.errors[field];
        console.log(`   ${field}: ${err.message}`);
        console.log(`   Valor problemático:`, err.value);
        console.log(`   Tipo do valor:`, typeof err.value);
      });
    }
  }
};

const testObjectSocialClass = async () => {
  console.log('\n🧪 Testando criação com socialClass como OBJETO (deve falhar)...');
  
  try {
    // Tenta criar com socialClass como objeto (deve dar erro)
    const testBroadcaster = new User({
      companyName: 'Test Radio Object',
      email: 'test-radio-object-' + Date.now() + '@test.com',
      password: 'test123456',
      cpfOrCnpj: 'TEST-OBJ-' + Date.now(),
      userType: 'broadcaster',
      phone: '11999999999',
      status: 'approved',
      onboardingCompleted: true,
      isCatalogOnly: true,
      managedByAdmin: true,
      broadcasterProfile: {
        generalInfo: {
          stationName: 'Test Radio Object FM',
          dialFrequency: '99.9',
          band: 'FM'
        },
        audienceProfile: {
          gender: {
            male: 50,
            female: 50
          },
          ageRange: '77% 30+',
          socialClass: { classA: 0, classB: 0, classC: 0, classDE: 0 } // OBJETO INCORRETO
        }
      }
    });

    await testBroadcaster.save();
    console.log('❌ PROBLEMA: Usuário com objeto socialClass foi salvo (não deveria!):', testBroadcaster._id);

    // Remove se foi criado incorretamente
    await User.findByIdAndDelete(testBroadcaster._id);

  } catch (error: any) {
    console.log('✅ CORRETO: Erro esperado ao tentar salvar socialClass como objeto');
    console.log('   Erro:', error.message);
  }
};

const main = async () => {
  console.log('🚀 Iniciando teste de criação de broadcasters...');
  
  await connectDB();
  await testUserCreation();
  await testObjectSocialClass();
  
  console.log('\n🏁 Testes finalizados');
  process.exit(0);
};

// Executa apenas se chamado diretamente
if (require.main === module) {
  main().catch(error => {
    console.error('❌ Erro fatal:', error);
    process.exit(1);
  });
}