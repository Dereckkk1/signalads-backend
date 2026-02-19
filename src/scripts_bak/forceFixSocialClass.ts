#!/usr/bin/env node

/**
 * Script DEFINITIVO para corrigir TODOS os dados de socialClass
 * Busca por QUALQUER tipo que não seja string
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

const forceFixAllSocialClass = async () => {
  console.log('🔍 Buscando TODOS os problemas de socialClass (busca abrangente)...');
  
  try {
    const db = mongoose.connection.db;
    if (!db) {
      throw new Error('Conexão com banco não disponível');
    }
    
    console.log('📊 1. Listando todos os broadcasters...');
    
    // Busca TODOS os broadcasters
    const allBroadcasters = await db.collection('users').find({
      userType: 'broadcaster'
    }).toArray();
    
    console.log(`   Total encontrados: ${allBroadcasters.length}`);
    
    let fixedCount = 0;
    let problematicUsers = [];
    
    for (const user of allBroadcasters) {
      const socialClass = user.broadcasterProfile?.audienceProfile?.socialClass;
      
      // Verifica se socialClass existe e não é string
      if (socialClass !== undefined && typeof socialClass !== 'string') {
        problematicUsers.push({
          email: user.email,
          id: user._id,
          socialClassType: typeof socialClass,
          socialClassValue: socialClass
        });
        
        console.log(`🐛 PROBLEMA: ${user.email}`);
        console.log(`   Tipo atual: ${typeof socialClass}`);
        console.log(`   Valor: ${JSON.stringify(socialClass)}`);
        
        // Determina qual string usar
        let newSocialClass = '';
        
        if (typeof socialClass === 'object' && socialClass !== null) {
          // Se é objeto, tenta converter
          if (socialClass.classA !== undefined) {
            const parts = [];
            if (socialClass.classA > 0) parts.push(`A: ${socialClass.classA}%`);
            if (socialClass.classB > 0) parts.push(`B: ${socialClass.classB}%`);
            if (socialClass.classC > 0) parts.push(`C: ${socialClass.classC}%`);
            if (socialClass.classDE > 0) parts.push(`DE: ${socialClass.classDE}%`);
            
            newSocialClass = parts.length > 0 ? parts.join(', ') : '';
          } else {
            // Objeto desconhecido, deixa vazio
            newSocialClass = '';
          }
        } else {
          // Outros tipos (number, boolean, etc), deixa vazio
          newSocialClass = '';
        }
        
        console.log(`   Nova string: "${newSocialClass}"`);
        
        // Força a atualização
        await db.collection('users').updateOne(
          { _id: user._id },
          {
            $set: {
              'broadcasterProfile.audienceProfile.socialClass': newSocialClass
            }
          }
        );
        
        fixedCount++;
        console.log(`✅ Corrigido forçadamente`);
      }
    }
    
    console.log('\n📈 RESUMO:');
    console.log(`   Total de broadcasters: ${allBroadcasters.length}`);
    console.log(`   Problemas encontrados: ${problematicUsers.length}`);
    console.log(`   Corrigidos: ${fixedCount}`);
    
    if (problematicUsers.length > 0) {
      console.log('\n🐛 LISTA DE PROBLEMAS:');
      problematicUsers.forEach(user => {
        console.log(`   ${user.email}: ${user.socialClassType} = ${JSON.stringify(user.socialClassValue)}`);
      });
    }
    
    // Verificação final - busca por QUALQUER socialClass não-string
    console.log('\n🔍 VERIFICAÇÃO FINAL...');
    
    const remainingProblems = await db.collection('users').find({
      userType: 'broadcaster',
      'broadcasterProfile.audienceProfile.socialClass': { 
        $exists: true,
        $not: { $type: 'string' }
      }
    }).toArray();
    
    if (remainingProblems.length > 0) {
      console.log(`❌ AINDA HÁ ${remainingProblems.length} PROBLEMAS!`);
      for (const problem of remainingProblems) {
        const sc = problem.broadcasterProfile?.audienceProfile?.socialClass;
        console.log(`   ${problem.email}: ${typeof sc} = ${JSON.stringify(sc)}`);
      }
    } else {
      console.log(`✅ PERFEITO: Nenhum problema restante!`);
    }
    
    // Teste de validação - tenta carregar um usuário
    console.log('\n🧪 TESTE DE VALIDAÇÃO...');
    try {
      const testUser = await db.collection('users').findOne({
        userType: 'broadcaster',
        'broadcasterProfile.audienceProfile.socialClass': { $exists: true }
      });
      
      if (testUser) {
        console.log(`✅ Teste passou: ${testUser.email}`);
        console.log(`   socialClass: "${testUser.broadcasterProfile?.audienceProfile?.socialClass}"`);
        console.log(`   Tipo: ${typeof testUser.broadcasterProfile?.audienceProfile?.socialClass}`);
      } else {
        console.log('⚠️ Nenhum usuário com socialClass encontrado para teste');
      }
    } catch (testError: any) {
      console.log('❌ Teste falhou:', testError.message);
    }
    
    console.log(`\n🎉 Operação concluída: ${fixedCount} usuários corrigidos`);
    
  } catch (error) {
    console.error('❌ Erro durante a correção:', error);
  }
};

const main = async () => {
  console.log('🚀 Iniciando correção FORÇADA de todos os dados socialClass...');
  console.log('⚠️ Esta operação irá corrigir QUALQUER socialClass que não seja string');
  
  await connectDB();
  await forceFixAllSocialClass();
  
  console.log('\n🏁 Script finalizado');
  process.exit(0);
};

// Executa apenas se chamado diretamente
if (require.main === module) {
  main().catch(error => {
    console.error('❌ Erro fatal:', error);
    process.exit(1);
  });
}