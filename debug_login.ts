import axios from 'axios';
import mongoose from 'mongoose';
import { User } from './src/models/User';
import dotenv from 'dotenv';

dotenv.config();

const API_URL = 'http://localhost:5000/api';

const run = async () => {
    try {
        console.log('🔒 INICIANDO DEBUG DE LOGIN...');

        // 1. Tentar Login com usuário conhecido
        await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/signalads');

        const user = await User.findOne({ email: 'aliiicia.parker@gmail.com' }); // User used in previous verification? Or find any user.
        // Actually, just try to login with ANY credentials to trigger the endpoint logic.
        // If 500 happens before auth logic (middleware), credentials don't matter.

        const payload = {
            email: 'test@example.com',
            password: 'wrongpassword'
        };

        console.log(`🕵️ Tentando login com: ${payload.email}`);

        try {
            const response = await axios.post(`${API_URL}/auth/login`, payload);
            console.log('✅ Login respondeu (provavelmente 200/400/401):', response.status);
            console.log('   Data:', response.data);
        } catch (apiError: any) {
            console.error('❌ Erro na requisição API:', apiError.message);
            if (apiError.response) {
                console.error('   Status:', apiError.response.status);
                console.error('   Data:', apiError.response.data);
                if (apiError.response.status === 500) {
                    console.error('   ⚠️ ERRO 500 CONFIRMADO!');
                }
            } else {
                console.error('   Sem resposta do servidor (conexão recusada?)');
            }
        }

    } catch (error) {
        console.error('❌ Erro geral:', error);
    } finally {
        await mongoose.disconnect();
    }
};

run();
