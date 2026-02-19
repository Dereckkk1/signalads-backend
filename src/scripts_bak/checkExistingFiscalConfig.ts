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

async function checkExistingFiscalConfig() {
  console.log('\n🔍 VERIFICANDO CONFIGURAÇÃO FISCAL EXISTENTE\n');
  
  try {
    const response = await api.get('/fiscalInfo');
    
    console.log('✅ CONFIGURAÇÃO FISCAL ENCONTRADA!\n');
    console.log(JSON.stringify(response.data, null, 2));
    console.log('');
    
    if (response.data) {
      console.log('📋 RESUMO:');
      console.log(`   Regime: ${response.data.specialTaxRegime}`);
      console.log(`   Inscrição Municipal: ${response.data.municipalInscription}`);
      console.log(`   Código Serviço: ${response.data.municipalServiceCode}`);
      console.log(`   RPS Série: ${response.data.rpsSerie}`);
      console.log(`   RPS Número: ${response.data.rpsNumber}`);
      console.log(`   ISS: ${response.data.taxes?.iss}%`);
      console.log('');
      console.log('✅ Configuração OK! Pode emitir NF.');
      console.log('🧪 Teste: npx ts-node src/scripts/testMinimalInvoice.ts');
    }
    
  } catch (error: any) {
    console.error('❌ ERRO ao buscar configuração fiscal:\n');
    
    if (error.response) {
      console.log('Status:', error.response.status);
      console.log('Dados:', JSON.stringify(error.response.data, null, 2));
      
      if (error.response.status === 404) {
        console.log('\n💡 Nenhuma configuração fiscal encontrada.');
        console.log('   Isso significa que você precisa configurar no painel:');
        console.log('   https://sandbox.asaas.com → Configurações → Notas Fiscais');
      }
    } else {
      console.log(error.message);
    }
  }
}

checkExistingFiscalConfig();
