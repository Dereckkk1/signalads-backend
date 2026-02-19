/**
 * Script para criar subconta no Asaas com CNPJ correto
 * Uso: npx ts-node src/scripts/createSubaccount.ts
 */

import axios from 'axios';
import * as dotenv from 'dotenv';

dotenv.config();

async function main() {
  console.log('🏢 CRIANDO SUBCONTA NO ASAAS\n');
  console.log('CNPJ: 41.531.108/0002-79\n');

  const api = axios.create({
    baseURL: process.env.ASAAS_API_URL,
    headers: {
      'access_token': process.env.ASAAS_API_KEY,
      'Content-Type': 'application/json'
    }
  });

  try {
    const res = await api.post('/accounts', {
      name: 'E RADIOS LTDA',
      email: 'faturamento@hubradios.com.br',
      cpfCnpj: '41531108000279',
      companyType: 'LIMITED',
      phone: '1140407000',
      mobilePhone: '11996330203',
      address: 'AV PAULISTA',
      addressNumber: '1636',
      complement: 'CONJ 4 PAVMTO15 SALA 1504',
      province: 'Bela Vista',
      postalCode: '01310200',
      incomeValue: 500000 // Faturamento mensal estimado (R$)
    });

    console.log('✅ SUCESSO!\n');
    console.log(JSON.stringify(res.data, null, 2));
    
    const id = res.data.walletId || res.data.id;
    console.log(`\n🔑 Adicione no .env:\nASAAS_SUBACCOUNT_ID=${id}\n`);

  } catch (error: any) {
    console.error('❌ ERRO:', error.response?.data || error.message);
  }
}

main();
