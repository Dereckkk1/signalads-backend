/**
 * Script para promover um usuário ao tipo 'admin'.
 * Executa: npx ts-node src/scripts_bak/promoteToAdmin.ts
 */

import path from 'path';
import dotenv from 'dotenv';

// Carregar variáveis do .env do backend
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

import mongoose from 'mongoose';
import { User } from '../models/User';

const MONGODB_URI =
    process.env.MONGODB_URI ||
    'mongodb+srv://marketingE-radios:xwT7VEJ04rnHHBFu@cluster0.bnx0k.mongodb.net/E-radios?retryWrites=true&w=majority';

// ─── Configuração ────────────────────────────────────────────────────────────
const TARGET_EMAIL = 'jackson@midiabox.app.br';
// ─────────────────────────────────────────────────────────────────────────────

async function promoteToAdmin() {
    try {
        console.log('🔌 Conectando ao MongoDB...');
        await mongoose.connect(MONGODB_URI);
        console.log('✅ Conectado ao MongoDB\n');

        // Buscar o usuário pelo e-mail
        const user = await User.findOne({ email: TARGET_EMAIL });

        if (!user) {
            console.error(`❌ Usuário não encontrado: ${TARGET_EMAIL}`);
            process.exit(1);
        }

        console.log('👤 Usuário encontrado:');
        console.log(`   📧  Email    : ${user.email}`);
        console.log(`   🏷️  Nome     : ${user.name || user.companyName || '(sem nome)'}`);
        console.log(`   🔑  Tipo atual: ${user.userType}`);
        console.log(`   📋  Status   : ${user.status}\n`);

        if (user.userType === 'admin') {
            console.log('ℹ️  Este usuário já é do tipo "admin". Nenhuma alteração necessária.');
            process.exit(0);
        }

        const previousType = user.userType;

        // Promover para admin e garantir status aprovado
        user.userType = 'admin';
        user.status = 'approved';
        await user.save();

        console.log('🎉 Usuário promovido com sucesso!');
        console.log(`   ${previousType}  →  admin`);
        console.log(`   Status: ${user.status}`);
    } catch (error) {
        console.error('❌ Erro ao promover usuário:', error);
        process.exit(1);
    } finally {
        await mongoose.connection.close();
        console.log('\n🔌 Conexão com MongoDB encerrada.');
    }
}

// Executar script
promoteToAdmin();
