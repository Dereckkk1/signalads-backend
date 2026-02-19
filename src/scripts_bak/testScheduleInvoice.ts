import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

const ASAAS_API_URL = process.env.ASAAS_API_URL || 'https://sandbox.asaas.com/api/v3';
const ASAAS_SUBACCOUNT_API_KEY = process.env.ASAAS_SUBACCOUNT_API_KEY;

const api = axios.create({
  baseURL: ASAAS_API_URL,
  headers: {
    'access_token': ASAAS_SUBACCOUNT_API_KEY,
    'Content-Type': 'application/json'
  }
});

async function testAgendarNF() {
  console.log('\n🧪 TESTANDO AGENDAR NF (ao invés de emitir diretamente)\n');
  
  const PAYMENT_ID = 'pay_0d1np5haopvient2';
  
  try {
    // 1. Primeiro AGENDA a NF (ao invés de emitir diretamente)
    console.log('📅 1. Agendando nota fiscal...\n');
    
    const schedulePayload = {
      payment: PAYMENT_ID,
      serviceDescription: 'Veiculação de campanha publicitária em rádio',
      observations: 'Teste via API - NF agendada',
      
      // Código do serviço
      municipalServiceCode: '06394',
      municipalServiceName: 'Agenciamento de propaganda e publicidade',
      
      // Impostos
      taxes: {
        retainIss: false,
        iss: 5.00,
        cofins: 0,
        csll: 0,
        inss: 0,
        ir: 0,
        pis: 0
      }
    };
    
    console.log('Payload:');
    console.log(JSON.stringify(schedulePayload, null, 2));
    console.log('');
    
    const scheduleResponse = await api.post('/invoices', schedulePayload);
    
    console.log('✅ NF agendada com sucesso!');
    console.log(`   ID: ${scheduleResponse.data.id}`);
    console.log(`   Status: ${scheduleResponse.data.status}`);
    console.log('');
    
    // 2. Agora AUTORIZA (emite) a NF
    console.log('✅ 2. Autorizando (emitindo) nota fiscal...\n');
    
    const authorizeResponse = await api.post(`/invoices/${scheduleResponse.data.id}/authorize`);
    
    console.log('✅✅ NOTA FISCAL EMITIDA COM SUCESSO!\n');
    console.log(JSON.stringify(authorizeResponse.data, null, 2));
    console.log('');
    console.log(`🎉 Número NF: ${authorizeResponse.data.number}`);
    console.log(`📄 PDF: ${authorizeResponse.data.pdfUrl}`);
    console.log(`📄 XML: ${authorizeResponse.data.xmlUrl}`);
    
  } catch (error: any) {
    console.error('❌ ERRO:\n');
    
    if (error.response) {
      console.log('Status:', error.response.status);
      console.log('Dados:', JSON.stringify(error.response.data, null, 2));
    } else {
      console.log(error.message);
    }
    
    console.log('\n💡 OBSERVAÇÃO:');
    console.log('Se este método também falhar, significa que a API não reconhece');
    console.log('a configuração feita manualmente no painel.');
    console.log('');
    console.log('Neste caso, a solução é:');
    console.log('1. Continuar emitindo NFs manualmente pelo painel, OU');
    console.log('2. Contatar suporte Asaas para sincronizar configuração fiscal');
    console.log('   WhatsApp: (47) 3000-0999');
    console.log('   Email: suporte@asaas.com');
  }
}

testAgendarNF();
