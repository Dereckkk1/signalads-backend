/**
 * Script para simular pagamento de cobrança no Asaas Sandbox
 * Uso: npx ts-node src/scripts/simulatePayment.ts
 */

import axios from 'axios';
import * as dotenv from 'dotenv';

dotenv.config();

async function simulatePayment() {
  console.log('💳 SIMULANDO PAGAMENTO NO SANDBOX\n');

  const api = axios.create({
    baseURL: process.env.ASAAS_API_URL,
    headers: {
      'access_token': process.env.ASAAS_API_KEY,
      'Content-Type': 'application/json'
    }
  });

  const PAYMENT_ID = 'pay_0d1np5haopvient2'; // Último do log

  try {
    console.log(`💰 Verificando cobrança: ${PAYMENT_ID}\n`);
    
    // Primeiro busca os dados da cobrança
    const paymentData = await api.get(`/payments/${PAYMENT_ID}`);
    console.log('📊 Status atual:', paymentData.data.status);
    console.log('💵 Valor:', paymentData.data.value);
    
    if (paymentData.data.status === 'CONFIRMED' || paymentData.data.status === 'RECEIVED') {
      console.log('\n✅ Pagamento já está confirmado!');
      console.log('🧪 Pode testar a emissão de NF:');
      console.log('npx ts-node src/testInvoice.ts');
      return;
    }
    
    console.log(`\n💳 Simulando recebimento...\n`);
    
    // Simula pagamento com o valor da cobrança
    const response = await api.post(`/payments/${PAYMENT_ID}/receiveInCash`, {
      paymentDate: new Date().toISOString().split('T')[0],
      value: paymentData.data.value,
      notifyCustomer: false
    });

    console.log('✅ PAGAMENTO SIMULADO COM SUCESSO!\n');
    console.log('Status:', response.data.status);
    console.log('Valor:', response.data.value);
    console.log('Data:', response.data.paymentDate);
    
    console.log('\n🧪 Agora rode o teste de NF:');
    console.log('npx ts-node src/testInvoice.ts');

  } catch (error: any) {
    console.error('❌ ERRO:', error.response?.data || error.message);
    
    console.log('\n💡 ALTERNATIVA:');
    console.log('1. Acesse: https://sandbox.asaas.com');
    console.log('2. Menu: Cobranças → Pendentes');
    console.log(`3. Localize: ${PAYMENT_ID}`);
    console.log('4. Clique em "Receber" ou "Marcar como pago"');
  }
}

simulatePayment();
