#!/usr/bin/env node

/**
 * Script para encontrar onde o socialClass está sendo modificado incorretamente
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

const searchProblematicValues = async () => {
  console.log('🔍 Buscando valores problemáticos de socialClass...');
  
  try {
    const db = mongoose.connection.db;
    if (!db) {
      throw new Error('Conexão com banco não disponível');
    }
    
    console.log('\n📊 1. Busca por socialClass como objeto...');
    
    // Busca especificamente por objetos com classA, classB, etc.
    const objSocialClass = await db.collection('users').find({
      'broadcasterProfile.audienceProfile.socialClass.classA': { $exists: true }
    }).toArray();
    
    console.log(`   Encontrados ${objSocialClass.length} com socialClass.classA`);
    
    for (const user of objSocialClass) {
      console.log(`   📍 ${user.email}: ${JSON.stringify(user.broadcasterProfile?.audienceProfile?.socialClass)}`);
    }
    
    console.log('\n📊 2. Busca por socialClass que NÃO é string nem null/undefined...');
    
    // Busca por qualquer socialClass que não seja string, null ou undefined
    const nonStringSocialClass = await db.collection('users').find({
      $and: [
        { 'broadcasterProfile.audienceProfile.socialClass': { $exists: true } },
        { 'broadcasterProfile.audienceProfile.socialClass': { $ne: null } },
        { 'broadcasterProfile.audienceProfile.socialClass': { $not: { $type: 'string' } } }
      ]
    }).toArray();
    
    console.log(`   Encontrados ${nonStringSocialClass.length} socialClass não-string`);
    
    for (const user of nonStringSocialClass) {
      const sc = user.broadcasterProfile?.audienceProfile?.socialClass;
      console.log(`   📍 ${user.email}:`);
      console.log(`     Tipo: ${typeof sc}`);
      console.log(`     Valor: ${JSON.stringify(sc)}`);
    }
    
    console.log('\n📊 3. Busca por socialClass contendo palavras-chave suspeitas...');
    
    // Busca por strings que contenham "classA", "classB", etc (formato incorreto)
    const suspiciousStrings = await db.collection('users').find({
      'broadcasterProfile.audienceProfile.socialClass': { 
        $regex: /class[A-Z]|{|}|\[|\]/, 
        $options: 'i' 
      }
    }).toArray();
    
    console.log(`   Encontrados ${suspiciousStrings.length} com strings suspeitas`);
    
    for (const user of suspiciousStrings) {
      console.log(`   📍 ${user.email}: "${user.broadcasterProfile?.audienceProfile?.socialClass}"`);
    }
    
    console.log('\n📊 4. Verificação completa dos dados...');
    
    // Lista TODOS os socialClass para verificação manual
    const allBroadcasters = await db.collection('users').find({
      userType: 'broadcaster'
    }).toArray();
    
    console.log(`   Total de broadcasters: ${allBroadcasters.length}`);
    
    for (const user of allBroadcasters) {
      const sc = user.broadcasterProfile?.audienceProfile?.socialClass;
      
      if (sc === undefined || sc === null) {
        console.log(`   ⚪ ${user.email}: undefined/null`);
      } else if (typeof sc === 'string') {
        console.log(`   ✅ ${user.email}: "${sc}" (string)`);
      } else {
        console.log(`   ❌ ${user.email}: PROBLEMA! Tipo: ${typeof sc}, Valor: ${JSON.stringify(sc)}`);
      }
    }
    
    console.log('\n📊 5. Teste de criação de objeto problemático...');
    
    // Testa se consegue encontrar documentos criados com objeto
    const testFind = await db.collection('users').findOne({
      'broadcasterProfile.audienceProfile.socialClass': {
        classA: 0,
        classB: 0,
        classC: 0,
        classDE: 0
      }
    });
    
    if (testFind) {
      console.log(`   ❌ ENCONTRADO documento com objeto exato: ${testFind.email}`);
    } else {
      console.log(`   ✅ Nenhum documento encontrado com objeto exato`);
    }
    
    // Testa busca por qualquer campo "classA" dentro de socialClass
    const testClassA = await db.collection('users').find({
      'broadcasterProfile.audienceProfile.socialClass.classA': { $exists: true }
    }).count();
    
    console.log(`   Documentos com socialClass.classA: ${testClassA}`);
    
  } catch (error: any) {
    console.error('❌ Erro durante a busca:', error.message);
  }
};

const main = async () => {
  console.log('🚀 Iniciando busca por valores problemáticos de socialClass...');
  
  await connectDB();
  await searchProblematicValues();
  
  console.log('\n🏁 Busca finalizada');
  process.exit(0);
};

// Executa apenas se chamado diretamente
if (require.main === module) {
  main().catch(error => {
    console.error('❌ Erro fatal:', error);
    process.exit(1);
  });
}