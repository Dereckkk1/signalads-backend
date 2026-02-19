/**
 * Script de teste para emissão de Nota Fiscal no Asaas
 * 
 * Uso:
 * 1. Criar uma cobrança de teste no Asaas
 * 2. Copiar o ID da cobrança (pay_xxxxx)
 * 3. Executar: npx ts-node src/testInvoice.ts
 * 
 * Este script tenta emitir uma NF e mostra TODOS os detalhes da resposta.
 */

import axios from 'axios';
import * as dotenv from 'dotenv';

dotenv.config();

const ASAAS_SUBACCOUNT_API_KEY = process.env.ASAAS_SUBACCOUNT_API_KEY;
const ASAAS_API_URL = process.env.ASAAS_API_URL || 'https://sandbox.asaas.com/api/v3';
const ASAAS_SUBACCOUNT_ID = process.env.ASAAS_SUBACCOUNT_ID;

// API da subconta (com API key própria)
const api = axios.create({
  baseURL: ASAAS_API_URL,
  headers: {
    'access_token': ASAAS_SUBACCOUNT_API_KEY,
    'Content-Type': 'application/json'
  }
});

async function testInvoice() {
  console.log('🧪 TESTE DE EMISSÃO DE NOTA FISCAL (SUBCONTA)\n');
  console.log('📍 Ambiente:', process.env.ASAAS_ENVIRONMENT);
  console.log('🔗 API URL:', ASAAS_API_URL);
  console.log('🏢 Subconta ID:', ASAAS_SUBACCOUNT_ID);
  console.log('🔑 Subaccount API Key:', ASAAS_SUBACCOUNT_API_KEY?.substring(0, 20) + '...\n');

  // Substitua pelo ID de uma cobrança PAGA de teste
  const PAYMENT_ID = 'pay_0d1np5haopvient2'; // Último pagamento dos logs (ORD-20251208-0007)

  const payload = {
    payment: PAYMENT_ID,
    serviceDescription: 'Veiculação de campanha publicitária em rádio',
    observations: 'Teste de emissão de NF via subconta após configuração manual no painel',
    externalReference: 'TEST-SUBACCOUNT-003',
    effectiveDate: new Date().toISOString().split('T')[0],
    
    // Código do serviço municipal (OBRIGATÓRIO para SP)
    municipalServiceCode: '06394',
    municipalServiceName: 'Agenciamento de propaganda e publicidade',
    
    // Impostos (conforme configuração do painel)
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

  console.log('📋 Payload enviado:');
  console.log(JSON.stringify(payload, null, 2));
  console.log('\n🚀 Enviando requisição para:', `${ASAAS_API_URL}/invoices\n`);

  try {
    const response = await api.post('/invoices', payload);
    
    console.log('✅ SUCESSO! Nota fiscal emitida:\n');
    console.log(JSON.stringify(response.data, null, 2));
    
  } catch (error: any) {
    console.error('❌ ERRO ao emitir nota fiscal:\n');
    
    if (error.response) {
      console.error('Status:', error.response.status);
      console.error('Headers:', JSON.stringify(error.response.headers, null, 2));
      console.error('Body:', JSON.stringify(error.response.data, null, 2));
      
      // Análise detalhada dos erros
      if (error.response.data?.errors) {
        console.error('\n📋 ERROS DETALHADOS:');
        error.response.data.errors.forEach((err: any, index: number) => {
          console.error(`\n${index + 1}. Código: ${err.code}`);
          console.error(`   Descrição: ${err.description}`);
        });
      }
    } else {
      console.error('Erro:', error.message);
    }
    
    console.error('\n\n🔍 DIAGNÓSTICO:');
    console.error('1. Verifique se o pagamento está CONFIRMADO (status: CONFIRMED ou RECEIVED)');
    console.error('2. Acesse https://sandbox.asaas.com → Configurações → Notas Fiscais');
    console.error('3. Verifique se TODOS os campos estão preenchidos e SALVOS:');
    console.error('   - Regime de tributação');
    console.error('   - Inscrição Municipal');
    console.error('   - Alíquotas de impostos');
    console.error('   - Configuração da prefeitura');
    console.error('4. Tente clicar em "Salvar" novamente mesmo que pareça já estar salvo');
    console.error('5. Aguarde 5 minutos e tente novamente (cache do Asaas)');
  }
}

// Também testa a consulta de configuração da conta
async function checkAccountConfig() {
  console.log('\n\n🔍 VERIFICANDO CONFIGURAÇÃO DA SUBCONTA:\n');
  
  try {
    // Consulta dados da subconta
    const response = await api.get('/myAccount');
    console.log('📊 Dados da subconta (CNPJ 41.531.108/0002-79):');
    console.log(JSON.stringify(response.data, null, 2));
    
    console.log('\n\n✅ VERIFICAÇÕES:');
    console.log(`CNPJ: ${response.data.cpfCnpj}`);
    console.log(`Status: ${response.data.status}`);
    console.log(`Cidade: ${response.data.city?.name || 'N/A'} - ${response.data.state || 'N/A'}`);
    
    if (response.data.cpfCnpj !== '41531108000279') {
      console.error('\n⚠️ ATENÇÃO: CNPJ diferente do esperado!');
      console.error('Esperado: 41531108000279');
      console.error(`Retornado: ${response.data.cpfCnpj}`);
    } else {
      console.log('\n✅ CNPJ correto! Subconta configurada.');
    }
    
  } catch (error: any) {
    console.error('⚠️ Não foi possível consultar dados da subconta');
    if (error.response) {
      console.error('Status:', error.response.status);
      console.error('Data:', JSON.stringify(error.response.data, null, 2));
    }
  }
}

// Executa os testes
(async () => {
  await testInvoice();
  await checkAccountConfig();
})();
