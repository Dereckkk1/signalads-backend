/**
 * Script para resetar senha da subconta Asaas
 * Uso: npx ts-node src/scripts/resetSubaccountPassword.ts
 */

import axios from 'axios';
import * as dotenv from 'dotenv';

dotenv.config();

async function resetPassword() {
  console.log('🔐 RESETANDO SENHA DA SUBCONTA\n');
  
  const api = axios.create({
    baseURL: 'https://sandbox.asaas.com/api/v3',
    headers: {
      'access_token': process.env.ASAAS_API_KEY,
      'Content-Type': 'application/json'
    }
  });

  const subaccountId = process.env.ASAAS_SUBACCOUNT_ID;
  
  try {
    // Tenta reenviar email de ativação
    const response = await api.post(`/accounts/${subaccountId}/resendActivationEmail`);
    
    console.log('✅ Email de ativação reenviado!');
    console.log('📧 Verifique a caixa de entrada de: faturamento@hubradios.com.br');
    console.log('\nResponse:', JSON.stringify(response.data, null, 2));
    
  } catch (error: any) {
    console.error('❌ Erro:', error.response?.data || error.message);
    
    console.log('\n💡 SOLUÇÃO ALTERNATIVA:');
    console.log('1. Acesse: https://sandbox.asaas.com/forgot');
    console.log('2. Digite: faturamento@hubradios.com.br');
    console.log('3. Siga instruções do email');
  }
}

resetPassword();
