/**
 * Script para criar/garantir que existe um usuário de Suporte
 * Este usuário será usado como contato fixo para todos os compradores
 * 
 * Executar: npx ts-node src/scripts/ensureSupportUser.ts
 */

import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import { User } from '../models/User';
import dotenv from 'dotenv';

dotenv.config();

const SUPPORT_USER = {
  name: 'Suporte E-radios',
  email: 'suporte@E-radios.com',
  password: 'Suporte@2026!E-radios', // Senha forte padrão
  userType: 'admin' as const,
  phone: '+55 (11) 99999-9999',
  cpf: '00000000000',
  cpfOrCnpj: '00000000000191', // CNPJ fictício para suporte (14 dígitos)
  status: 'approved' as const,
  isSupport: true // Flag especial para identificar este usuário
};

async function ensureSupportUser() {
  try {
    // Conectar ao MongoDB
    const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/E-radios';
    await mongoose.connect(mongoUri);
    console.log('✅ Conectado ao MongoDB');

    // Verificar se já existe usuário de suporte
    let supportUser = await User.findOne({ 
      $or: [
        { email: SUPPORT_USER.email },
        { isSupport: true }
      ]
    });

    if (supportUser) {
      console.log('✅ Usuário de Suporte já existe:', {
        _id: supportUser._id,
        name: supportUser.name,
        email: supportUser.email,
        userType: supportUser.userType
      });
      
      // Atualizar variável de ambiente (informar ao desenvolvedor)
      console.log('\n📋 Adicione esta variável ao .env:');
      console.log(`SUPPORT_USER_ID=${supportUser._id}`);
      
      return supportUser._id.toString();
    }

    // Criar novo usuário de suporte
    console.log('🔧 Criando usuário de Suporte...');
    
    const hashedPassword = await bcrypt.hash(SUPPORT_USER.password, 10);
    
    supportUser = await User.create({
      ...SUPPORT_USER,
      password: hashedPassword
    });

    console.log('✅ Usuário de Suporte criado com sucesso:', {
      _id: supportUser._id,
      name: supportUser.name,
      email: supportUser.email,
      userType: supportUser.userType
    });

    console.log('\n📋 Adicione esta variável ao .env:');
    console.log(`SUPPORT_USER_ID=${supportUser._id}`);
    
    console.log('\n🔑 Credenciais de acesso (SALVE EM LOCAL SEGURO):');
    console.log(`Email: ${SUPPORT_USER.email}`);
    console.log(`Senha: ${SUPPORT_USER.password}`);

    return supportUser._id.toString();

  } catch (error: any) {
    console.error('❌ Erro ao criar usuário de Suporte:', error.message);
    throw error;
  } finally {
    await mongoose.disconnect();
    console.log('\n👋 Desconectado do MongoDB');
  }
}

// Executar se chamado diretamente
if (require.main === module) {
  ensureSupportUser()
    .then((userId) => {
      console.log(`\n✅ SUPPORT_USER_ID: ${userId}`);
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ Falha:', error);
      process.exit(1);
    });
}

export { ensureSupportUser };
