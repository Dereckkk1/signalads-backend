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

async function checkFiscalConfiguration() {
  console.log('\n🔍 VERIFICANDO CONFIGURAÇÃO FISCAL COMPLETA\n');
  
  try {
    // 1. Verifica informações fiscais
    console.log('📋 1. Informações Fiscais:');
    try {
      const fiscalInfo = await api.get('/myAccount/fiscalInfo');
      console.log(JSON.stringify(fiscalInfo.data, null, 2));
    } catch (err: any) {
      console.log('❌ Erro:', err.response?.data || err.message);
    }
    
    // 2. Verifica configuração de NF
    console.log('\n📋 2. Configuração de Notas Fiscais:');
    try {
      const invoiceConfig = await api.get('/myAccount/invoiceConfig');
      console.log(JSON.stringify(invoiceConfig.data, null, 2));
    } catch (err: any) {
      console.log('❌ Erro:', err.response?.data || err.message);
    }
    
    // 3. Verifica serviços municipais
    console.log('\n📋 3. Serviços Municipais:');
    try {
      const services = await api.get('/municipalServices');
      console.log(JSON.stringify(services.data, null, 2));
    } catch (err: any) {
      console.log('❌ Erro:', err.response?.data || err.message);
    }
    
    // 4. Verifica dados da conta
    console.log('\n📋 4. Dados da Conta:');
    try {
      const account = await api.get('/myAccount');
      console.log('CNPJ:', account.data.cpfCnpj);
      console.log('Status:', account.data.status);
      console.log('Cidade:', account.data.city?.name);
    } catch (err: any) {
      console.log('❌ Erro:', err.response?.data || err.message);
    }
    
  } catch (error: any) {
    console.error('❌ Erro geral:', error.message);
  }
}

checkFiscalConfiguration();
