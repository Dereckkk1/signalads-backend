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

async function configureFiscalInfo() {
  console.log('\n🔧 CONFIGURANDO INFORMAÇÕES FISCAIS VIA API\n');
  
  try {
    // 1. Primeiro lista as configurações municipais para saber o que é necessário
    console.log('📋 1. Listando configurações municipais de São Paulo...\n');
    
    const municipalOptions = await api.get('/fiscalInfo/municipalOptions');
    console.log('✅ Configurações municipais obtidas:');
    console.log(JSON.stringify(municipalOptions.data, null, 2));
    console.log('');
    
    // 2. Lista os serviços municipais disponíveis
    console.log('📋 2. Listando serviços municipais...\n');
    
    const municipalServices = await api.get('/fiscalInfo/municipalServices');
    console.log('✅ Serviços municipais:');
    console.log(JSON.stringify(municipalServices.data, null, 2));
    console.log('');
    
    // 3. Procura pelo serviço de publicidade (código 06394 ou similar)
    const advertisingService = municipalServices.data.data?.find((service: any) => 
      service.code?.includes('06394') || 
      service.description?.toLowerCase().includes('publicidade') ||
      service.description?.toLowerCase().includes('agenciamento')
    );
    
    if (advertisingService) {
      console.log('🎯 Serviço encontrado:');
      console.log(`   ID: ${advertisingService.id}`);
      console.log(`   Código: ${advertisingService.code}`);
      console.log(`   Descrição: ${advertisingService.description}`);
      console.log('');
    }
    
    // 4. Cria/atualiza as informações fiscais
    console.log('📋 3. Criando/atualizando informações fiscais...\n');
    
    const fiscalInfoPayload = {
      municipalServiceId: advertisingService?.id, // ID do serviço municipal
      municipalServiceCode: advertisingService?.code, // Código do serviço
      municipalServiceName: advertisingService?.description, // Nome do serviço
      
      // Dados do seu certificado/configuração
      specialTaxRegime: 1, // 1 = Microempresa municipal
      culturalProjectsPromoter: false,
      
      // RPS
      rpsSerie: '1',
      rpsNumber: 1,
      loteNumber: 1,
      
      // Impostos
      taxes: {
        retainIss: false,
        iss: 5.00, // 5%
        cofins: 0,
        csll: 0,
        inss: 0,
        ir: 0,
        pis: 0
      }
    };
    
    console.log('Payload:');
    console.log(JSON.stringify(fiscalInfoPayload, null, 2));
    console.log('');
    
    const fiscalInfoResponse = await api.post('/fiscalInfo', fiscalInfoPayload);
    
    console.log('✅ INFORMAÇÕES FISCAIS CONFIGURADAS COM SUCESSO!\n');
    console.log(JSON.stringify(fiscalInfoResponse.data, null, 2));
    console.log('');
    
    console.log('✅ AGORA VOCÊ PODE EMITIR NOTAS FISCAIS!');
    console.log('🧪 Teste com: npx ts-node src/scripts/testMinimalInvoice.ts');
    
  } catch (error: any) {
    console.error('❌ ERRO ao configurar informações fiscais:\n');
    
    if (error.response) {
      console.log('Status:', error.response.status);
      console.log('Dados:', JSON.stringify(error.response.data, null, 2));
    } else {
      console.log(error.message);
    }
    
    console.log('\n💡 OBSERVAÇÕES:');
    console.log('1. Algumas prefeituras exigem configuração manual no painel');
    console.log('2. Certificado digital pode precisar ser enviado via painel');
    console.log('3. Inscrição municipal precisa estar ativa e validada');
    console.log('');
    console.log('📞 Se persistir, contate suporte Asaas:');
    console.log('   WhatsApp: (47) 3000-0999');
    console.log('   Email: suporte@asaas.com');
  }
}

configureFiscalInfo();
