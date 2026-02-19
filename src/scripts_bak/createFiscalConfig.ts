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

async function createFiscalConfig() {
  console.log('\n🔧 CRIANDO CONFIGURAÇÃO FISCAL VIA API\n');
  
  try {
    const payload = {
      // Código do serviço (conforme você configurou no painel)
      municipalServiceCode: '06394', // Agenciamento de publicidade
      municipalServiceName: 'Agenciamento de propaganda e publicidade',
      
      // Inscrição municipal (conforme você configurou)
      municipalInscription: '18673554',
      
      // Regime tributário (0 = Normal)
      specialTaxRegime: 0,
      
      // RPS
      rpsSerie: '1',
      rpsNumber: 1,
      
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
    
    console.log('📋 Payload:');
    console.log(JSON.stringify(payload, null, 2));
    console.log('');
    
    const response = await api.post('/fiscalInfo', payload);
    
    console.log('✅ SUCESSO!\n');
    console.log(JSON.stringify(response.data, null, 2));
    console.log('');
    console.log('🧪 Agora teste a emissão de NF:');
    console.log('npx ts-node src/scripts/testMinimalInvoice.ts');
    
  } catch (error: any) {
    console.error('❌ ERRO:\n');
    
    if (error.response) {
      console.log('Status:', error.response.status);
      console.log('Dados:', JSON.stringify(error.response.data, null, 2));
    } else {
      console.log(error.message);
    }
    
    console.log('\n💡 POSSÍVEIS CAUSAS:');
    console.log('1. Certificado digital não foi enviado ou está inválido');
    console.log('2. Inscrição municipal não está ativa na prefeitura');
    console.log('3. Configuração já existe (tente GET /fiscalInfo primeiro)');
    console.log('4. Alguns campos da prefeitura de SP podem ser diferentes');
    console.log('');
    console.log('🔍 Verifique se no painel você consegue emitir NF manualmente');
    console.log('   Se conseguir, o problema é na chamada da API');
    console.log('   Se não conseguir, falta configuração no painel');
  }
}

createFiscalConfig();
