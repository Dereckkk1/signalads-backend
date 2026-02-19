import axios from 'axios';
import fs from 'fs';

const API_URL = 'http://localhost:5000/api';

const run = async () => {
    try {
        console.log('🔒 INICIANDO DEBUG DE LOGIN (FULL)...');

        const payload = {
            email: 'test@example.com',
            password: 'wrongpassword'
        };

        try {
            await axios.post(`${API_URL}/auth/login`, payload);
            console.log('✅ Login respondeu sucesso (inesperado)');
        } catch (apiError: any) {
            if (apiError.response) {
                console.log('❌ Erro na requisição API:', apiError.response.status);
                fs.writeFileSync('login_error.html', apiError.response.data);
                console.log('📄 Erro salvo em login_error.html');
            } else {
                console.error('❌ Sem resposta do servidor:', apiError.message);
            }
        }

    } catch (error) {
        console.error('❌ Erro geral:', error);
    }
};

run();
