#!/usr/bin/env node

/**
 * Script para investigar TODOS os tipos de dados problemáticos em audienceProfile
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

const investigateAllAudienceData = async () => {
  console.log('🔍 Investigando TODOS os dados de audienceProfile...');
  
  try {
    const db = mongoose.connection.db;
    if (!db) {
      throw new Error('Conexão com banco não disponível');
    }
    
    // 1. Busca todos os broadcasters
    const allUsers = await db.collection('users').find({
      userType: 'broadcaster'
    }).toArray();
    
    console.log(`📊 Total de broadcasters: ${allUsers.length}`);
    
    // 2. Analisa cada tipo de dado
    let socialClassObjects = 0;
    let socialClassStrings = 0;
    let socialClassEmpty = 0;
    let genderObjects = 0;
    let genderEmpty = 0;
    let ageRangeStrings = 0;
    let ageRangeEmpty = 0;
    
    const problems = [];
    
    for (const user of allUsers) {
      const audience = user.broadcasterProfile?.audienceProfile;
      
      if (audience) {
        // Analisa socialClass
        if (audience.socialClass !== undefined) {
          if (typeof audience.socialClass === 'object') {
            socialClassObjects++;
            problems.push({
              email: user.email,
              field: 'socialClass',
              type: 'object',
              value: audience.socialClass
            });
          } else if (typeof audience.socialClass === 'string') {
            if (audience.socialClass === '') {
              socialClassEmpty++;
            } else {
              socialClassStrings++;
            }
          }
        }
        
        // Analisa gender
        if (audience.gender !== undefined) {
          if (typeof audience.gender === 'object') {
            genderObjects++;
          } else {
            genderEmpty++;
          }
        }
        
        // Analisa ageRange
        if (audience.ageRange !== undefined) {
          if (typeof audience.ageRange === 'string') {
            if (audience.ageRange === '') {
              ageRangeEmpty++;
            } else {
              ageRangeStrings++;
            }
          }
        }
      }
    }
    
    console.log('\n📈 ESTATÍSTICAS:');
    console.log(`   socialClass como objeto: ${socialClassObjects}`);
    console.log(`   socialClass como string: ${socialClassStrings}`);
    console.log(`   socialClass vazio: ${socialClassEmpty}`);
    console.log(`   gender como objeto: ${genderObjects}`);
    console.log(`   gender vazio: ${genderEmpty}`);
    console.log(`   ageRange como string: ${ageRangeStrings}`);
    console.log(`   ageRange vazio: ${ageRangeEmpty}`);
    
    if (problems.length > 0) {
      console.log('\n🚨 PROBLEMAS ENCONTRADOS:');
      for (const problem of problems) {
        console.log(`   ${problem.email}: ${problem.field} = ${JSON.stringify(problem.value)}`);
      }
    } else {
      console.log('\n✅ Nenhum problema encontrado!');
    }
    
    // 3. Busca por documentos mal-formados que possam causar erro de cast
    console.log('\n🔍 Buscando documentos mal-formados...');
    
    try {
      const malformedDocs = await db.collection('users').find({
        userType: 'broadcaster',
        $or: [
          { 'broadcasterProfile.audienceProfile.socialClass': { $type: 'object' } },
          { 'broadcasterProfile.audienceProfile.socialClass': { $type: 'array' } },
          { 'broadcasterProfile.audienceProfile.socialClass': { $type: 'double' } },
          { 'broadcasterProfile.audienceProfile.socialClass': { $type: 'int' } }
        ]
      }).toArray();
      
      console.log(`🐛 Documentos mal-formados: ${malformedDocs.length}`);
      
      for (const doc of malformedDocs) {
        console.log(`   ${doc.email}: socialClass = ${JSON.stringify(doc.broadcasterProfile?.audienceProfile?.socialClass)}`);
      }
      
    } catch (error) {
      console.log('⚠️ Erro ao buscar documentos mal-formados:', error);
    }
    
  } catch (error) {
    console.error('❌ Erro durante a investigação:', error);
  }
};

const main = async () => {
  console.log('🚀 Iniciando investigação completa...');
  
  await connectDB();
  await investigateAllAudienceData();
  
  console.log('\n🏁 Investigação finalizada');
  process.exit(0);
};

// Executa apenas se chamado diretamente
if (require.main === module) {
  main().catch(error => {
    console.error('❌ Erro fatal:', error);
    process.exit(1);
  });
}