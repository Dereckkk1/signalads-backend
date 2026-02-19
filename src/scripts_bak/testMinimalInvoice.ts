import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

const ASAAS_API_URL = process.env.ASAAS_API_URL || 'https://sandbox.asaas.com/api/v3';
const ASAAS_SUBACCOUNT_API_KEY = process.env.ASAAS_SUBACCOUNT_API_KEY;
const PAYMENT_ID = 'pay_0d1np5haopvient2';

const api = axios.create({
  baseURL: ASAAS_API_URL,
  headers: {
    'access_token': ASAAS_SUBACCOUNT_API_KEY,
    'Content-Type': 'application/json'
  }
});

async function testMinimalInvoice() {
  console.log('\n🧪 TESTE COM PAYLOAD ABSOLUTAMENTE MÍNIMO\n');
  
  try {
    // Payload mais mínimo possível
    const payload = {
      payment: PAYMENT_ID
    };
    
    console.log('📋 Payload:');
    console.log(JSON.stringify(payload, null, 2));
    console.log('');
    
    const response = await api.post('/invoices', payload);
    
    console.log('✅ SUCESSO!');
    console.log(JSON.stringify(response.data, null, 2));
    
  } catch (error: any) {
    console.log('❌ ERRO:', error.response?.data || error.message);
    console.log('');
    
    console.log('💡 PRÓXIMOS PASSOS:');
    console.log('');
    console.log('1. Acesse: https://sandbox.asaas.com');
    console.log('2. Faça login com a subconta (faturamento@hubradios.com.br)');
    console.log('3. Vá em: Configurações → Notas Fiscais');
    console.log('4. Verifique ESPECIALMENTE:');
    console.log('   ✓ Município de prestação de serviço: São Paulo - SP');
    console.log('   ✓ Regime de tributação: Selecionado e SALVO');
    console.log('   ✓ Inscrição Municipal: Preenchida e SALVA');
    console.log('   ✓ Série RPS: Configurada (padrão 1)');
    console.log('   ✓ Número RPS inicial: Configurado (padrão 1)');
    console.log('5. Clique em SALVAR mesmo que pareça já estar salvo');
    console.log('6. Aguarde 2-3 minutos (cache)');
    console.log('7. Rode este script novamente');
    console.log('');
    console.log('📞 Se o erro persistir, entre em contato com suporte Asaas:');
    console.log('   - Chat no painel');
    console.log('   - Email: suporte@asaas.com');
    console.log('   - WhatsApp: (47) 3000-0999');
  }
}

testMinimalInvoice();
