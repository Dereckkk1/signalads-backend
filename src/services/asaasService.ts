import axios, { AxiosInstance } from 'axios';

/**
 * Serviço de integração com Asaas API
 * Documentação: https://docs.asaas.com/
 */

class AsaasService {
  private api: AxiosInstance;
  private environment: string;

  constructor() {
    this.environment = process.env.ASAAS_ENVIRONMENT || 'sandbox';
    const apiUrl = process.env.ASAAS_API_URL;
    const apiKey = process.env.ASAAS_API_KEY;

    if (!apiUrl || !apiKey) {
      console.error('❌ Variáveis ASAAS_API_URL e ASAAS_API_KEY não configuradas no .env');
      throw new Error('Configuração do Asaas incompleta');
    }

    this.api = axios.create({
      baseURL: apiUrl,
      headers: {
        'access_token': apiKey,
        'Content-Type': 'application/json'
      }
    });

  }

  /**
   * Cria instância da API para usar subconta (para emissão de NF com CNPJ correto)
   */
  private getSubaccountApi(): AxiosInstance {
    const subaccountApiKey = process.env.ASAAS_SUBACCOUNT_API_KEY;

    if (!subaccountApiKey) {
      console.warn('⚠️ ASAAS_SUBACCOUNT_API_KEY não configurado - usando conta principal');
      return this.api;
    }

    const apiUrl = process.env.ASAAS_API_URL;

    return axios.create({
      baseURL: apiUrl,
      headers: {
        'access_token': subaccountApiKey, // API key da subconta
        'Content-Type': 'application/json'
      }
    });
  }

  /**
   * Cria ou atualiza cliente no Asaas
   */
  async createOrUpdateCustomer(data: {
    name: string;
    email: string;
    phone: string;
    cpfCnpj: string;
    postalCode?: string;
    address?: string;
    addressNumber?: string;
    complement?: string;
    province?: string;
    externalReference?: string;
  }) {
    try {
      // Valida CPF/CNPJ
      const cleanCpfCnpj = data.cpfCnpj.replace(/\D/g, '');

      if (!cleanCpfCnpj || (cleanCpfCnpj.length !== 11 && cleanCpfCnpj.length !== 14)) {
        console.error(`❌ CPF/CNPJ inválido: ${data.cpfCnpj}`);
        throw new Error('CPF/CNPJ inválido ou não fornecido');
      }


      // Verifica se cliente já existe pelo CPF/CNPJ
      const existingCustomer = await this.getCustomerByCpfCnpj(cleanCpfCnpj);

      if (existingCustomer) {
        return existingCustomer;
      }

      // Cria novo cliente
      const customerData = {
        name: data.name,
        email: data.email,
        phone: data.phone.replace(/\D/g, ''),
        cpfCnpj: cleanCpfCnpj,
        postalCode: data.postalCode?.replace(/\D/g, ''),
        address: data.address,
        addressNumber: data.addressNumber,
        complement: data.complement,
        province: data.province,
        externalReference: data.externalReference,
        notificationDisabled: false
      };



      const response = await this.api.post('/customers', customerData);

      return response.data;
    } catch (error: any) {
      console.error('❌ Erro ao criar cliente no Asaas:', error.response?.data || error.message);
      throw new Error('Erro ao criar cliente no gateway de pagamento');
    }
  }

  /**
   * Busca cliente pelo CPF/CNPJ
   */
  async getCustomerByCpfCnpj(cpfCnpj: string) {
    try {
      const response = await this.api.get('/customers', {
        params: {
          cpfCnpj: cpfCnpj.replace(/\D/g, '')
        }
      });

      return response.data.data?.[0] || null;
    } catch (error) {
      return null;
    }
  }

  /**
   * Cria cobrança genérica (BOLETO, PIX, CREDIT_CARD, etc)
   */
  async createPayment(data: {
    customer: string;
    billingType: 'BOLETO' | 'CREDIT_CARD' | 'PIX' | 'UNDEFINED';
    value: number;
    dueDate: string; // YYYY-MM-DD
    description: string;
    externalReference?: string;
  }) {
    try {
      const response = await this.api.post('/payments', {
        customer: data.customer,
        billingType: data.billingType,
        value: data.value,
        dueDate: data.dueDate,
        description: data.description,
        externalReference: data.externalReference
      });

      return response.data;
    } catch (error: any) {
      console.error('❌ Erro ao criar cobrança:', error.response?.data || error.message);
      throw new Error(error.response?.data?.errors?.[0]?.description || 'Erro ao criar cobrança');
    }
  }

  /**
   * Cria cobrança com cartão de crédito
   */
  async createCreditCardPayment(data: {
    customer: string; // ID do cliente Asaas
    billingType: 'CREDIT_CARD';
    value: number;
    dueDate: string; // YYYY-MM-DD
    description: string;
    externalReference?: string;
    installmentCount?: number;
    installmentValue?: number;
    creditCard: {
      holderName: string;
      number: string;
      expiryMonth: string;
      expiryYear: string;
      ccv: string;
    };
    creditCardHolderInfo: {
      name: string;
      email: string;
      cpfCnpj: string;
      postalCode: string;
      addressNumber: string;
      addressComplement?: string;
      phone: string;
    };
    split?: {
      walletId: string;
      fixedValue?: number;
      percentualValue?: number;
    }[];
  }) {
    try {
      const response = await this.api.post('/payments', {
        customer: data.customer,
        billingType: 'CREDIT_CARD',
        value: data.value,
        dueDate: data.dueDate,
        description: data.description,
        externalReference: data.externalReference,
        installmentCount: data.installmentCount || 1,
        installmentValue: data.installmentValue || data.value,
        creditCard: {
          holderName: data.creditCard.holderName,
          number: data.creditCard.number.replace(/\s/g, ''),
          expiryMonth: data.creditCard.expiryMonth,
          expiryYear: data.creditCard.expiryYear,
          ccv: data.creditCard.ccv
        },
        creditCardHolderInfo: {
          name: data.creditCardHolderInfo.name,
          email: data.creditCardHolderInfo.email,
          cpfCnpj: data.creditCardHolderInfo.cpfCnpj.replace(/\D/g, ''),
          postalCode: data.creditCardHolderInfo.postalCode.replace(/\D/g, ''),
          addressNumber: data.creditCardHolderInfo.addressNumber,
          addressComplement: data.creditCardHolderInfo.addressComplement,
          phone: data.creditCardHolderInfo.phone.replace(/\D/g, '')
        },
        split: data.split
      });

      return response.data;
    } catch (error: any) {
      console.error('❌ Erro ao criar cobrança com cartão:', error.response?.data || error.message);
      throw new Error(error.response?.data?.errors?.[0]?.description || 'Erro ao processar pagamento com cartão');
    }
  }

  /**
   * Cria cobrança PIX
   */
  async createPixPayment(data: {
    customer: string;
    value: number;
    dueDate: string;
    description: string;
    externalReference?: string;
    split?: {
      walletId: string;
      fixedValue?: number;
      percentualValue?: number;
    }[];
  }) {
    try {
      const response = await this.api.post('/payments', {
        customer: data.customer,
        billingType: 'PIX',
        value: data.value,
        dueDate: data.dueDate,
        description: data.description,
        externalReference: data.externalReference,
        split: data.split
      });


      // Gera QR Code PIX
      const qrCodeResponse = await this.api.get(`/payments/${response.data.id}/pixQrCode`);



      // Garante que o QR Code tem o prefixo data:image
      let qrCodeImage = qrCodeResponse.data.encodedImage;
      if (qrCodeImage && !qrCodeImage.startsWith('data:image')) {
        qrCodeImage = `data:image/png;base64,${qrCodeImage}`;
      }

      return {
        ...response.data,
        pixQrCode: qrCodeImage,
        pixCopyPaste: qrCodeResponse.data.payload
      };
    } catch (error: any) {
      console.error('❌ Erro ao criar cobrança PIX:', error.response?.data || error.message);
      throw new Error('Erro ao gerar cobrança PIX');
    }
  }

  /**
   * Consulta status de um pagamento
   */
  async getPaymentStatus(paymentId: string) {
    try {
      const response = await this.api.get(`/payments/${paymentId}`);
      return response.data;
    } catch (error: any) {
      console.error('❌ Erro ao consultar pagamento:', error.response?.data || error.message);
      throw new Error('Erro ao consultar status do pagamento');
    }
  }

  /**
   * Cria split de pagamento (para múltiplos recebedores)
   * Nota: Requer contas vinculadas (subaccounts)
   */
  async createSplit(paymentId: string, splits: {
    walletId: string;
    fixedValue?: number;
    percentualValue?: number;
  }[]) {
    try {
      const response = await this.api.post(`/payments/${paymentId}/split`, {
        split: splits
      });

      return response.data;
    } catch (error: any) {
      console.error('❌ Erro ao criar split:', error.response?.data || error.message);
      throw new Error('Erro ao configurar divisão de pagamento');
    }
  }

  /**
   * Estorna um pagamento
   */
  async refundPayment(paymentId: string, value?: number, description?: string) {
    try {
      const response = await this.api.post(`/payments/${paymentId}/refund`, {
        value,
        description
      });

      return response.data;
    } catch (error: any) {
      console.error('❌ Erro ao estornar pagamento:', error.response?.data || error.message);
      throw new Error('Erro ao estornar pagamento');
    }
  }

  /**
   * Cria subconta (para emissoras receberem splits)
   */
  async createSubAccount(data: {
    name: string;
    email: string;
    cpfCnpj: string;
    birthDate?: string; // DD/MM/YYYY (pessoa física)
    companyType?: 'MEI' | 'LIMITED' | 'INDIVIDUAL' | 'ASSOCIATION';
    phone: string;
    mobilePhone: string;
    address: string;
    addressNumber: string;
    complement?: string;
    province: string;
    postalCode: string;
    bankAccount?: {
      bank: string;
      accountName: string;
      ownerName: string;
      ownerBirthDate?: string;
      cpfCnpj: string;
      agency: string;
      account: string;
      accountDigit: string;
      bankAccountType: 'CONTA_CORRENTE' | 'CONTA_POUPANCA';
    };
  }) {
    try {
      const response = await this.api.post('/accounts', {
        name: data.name,
        email: data.email,
        cpfCnpj: data.cpfCnpj.replace(/\D/g, ''),
        birthDate: data.birthDate,
        companyType: data.companyType,
        phone: data.phone.replace(/\D/g, ''),
        mobilePhone: data.mobilePhone.replace(/\D/g, ''),
        address: data.address,
        addressNumber: data.addressNumber,
        complement: data.complement,
        province: data.province,
        postalCode: data.postalCode.replace(/\D/g, ''),
        bankAccount: data.bankAccount ? {
          bank: {
            code: data.bankAccount.bank
          },
          accountName: data.bankAccount.accountName,
          ownerName: data.bankAccount.ownerName,
          ownerBirthDate: data.bankAccount.ownerBirthDate,
          cpfCnpj: data.bankAccount.cpfCnpj.replace(/\D/g, ''),
          agency: data.bankAccount.agency,
          account: data.bankAccount.account,
          accountDigit: data.bankAccount.accountDigit,
          bankAccountType: data.bankAccount.bankAccountType
        } : undefined
      });

      return response.data;
    } catch (error: any) {
      console.error('❌ Erro ao criar subconta:', error.response?.data || error.message);
      throw new Error('Erro ao criar subconta no gateway');
    }
  }

  /**
   * Obtém informações da wallet de uma subconta
   */
  async getWalletInfo(accountId: string) {
    try {
      const response = await this.api.get(`/accounts/${accountId}/wallet`);
      return response.data;
    } catch (error: any) {
      console.error('❌ Erro ao buscar wallet:', error.response?.data || error.message);
      throw new Error('Erro ao buscar informações da carteira');
    }
  }

  /**
   * === MÉTODOS DE FATURAMENTO ===
   */

  /**
   * Cria cobrança (boleto) para faturamento
   * Usado quando cliente escolhe "A Faturar"
   */
  async createBillingCharge(data: {
    customer: string; // ID do cliente no Asaas
    value: number;
    dueDate: string; // YYYY-MM-DD
    description: string;
    externalReference: string; // orderNumber
    fine?: number; // % de multa (padrão: 2%)
    interest?: number; // % de juros ao mês (padrão: 1%)
    split?: {
      walletId: string;
      fixedValue?: number;
      percentualValue?: number;
    }[];
  }) {
    try {
      const response = await this.api.post('/payments', {
        customer: data.customer,
        billingType: 'BOLETO',
        value: data.value,
        dueDate: data.dueDate,
        description: data.description,
        externalReference: data.externalReference,
        fine: {
          value: data.fine || 2 // 2% de multa padrão
        },
        interest: {
          value: data.interest || 1 // 1% de juros ao mês padrão
        },
        postalService: false, // Não enviar pelos correios
        split: data.split
      });

      return response.data;
    } catch (error: any) {
      console.error('❌ Erro ao criar cobrança de faturamento:', error.response?.data || error.message);
      throw new Error(error.response?.data?.errors?.[0]?.description || 'Erro ao criar cobrança de faturamento');
    }
  }

  /**
   * Emite nota fiscal de serviço
   * Chamado APÓS o cliente pagar (quando recebemos webhook PAYMENT_RECEIVED)
   */
  async issueServiceInvoice(data: {
    payment: string; // ID do payment no Asaas
    serviceDescription: string;
    observations?: string;
    externalReference?: string;
    municipalServiceCode?: string;
    municipalServiceName?: string;
  }) {
    try {
      const response = await this.api.post('/invoices', {
        payment: data.payment,
        type: 'SERVICE',
        serviceDescription: data.serviceDescription,
        observations: data.observations,
        externalReference: data.externalReference,
        municipalServiceCode: data.municipalServiceCode || '',
        municipalServiceName: data.municipalServiceName || 'Veiculação de mídia publicitária'
      });

      return response.data;
    } catch (error: any) {
      console.error('❌ Erro ao emitir nota fiscal:', error.response?.data || error.message);
      throw new Error(error.response?.data?.errors?.[0]?.description || 'Erro ao emitir nota fiscal');
    }
  }

  /**
   * Consulta nota fiscal
   */
  async getInvoice(invoiceId: string) {
    try {
      const response = await this.api.get(`/invoices/${invoiceId}`);
      return response.data;
    } catch (error: any) {
      console.error('❌ Erro ao consultar nota fiscal:', error.response?.data || error.message);
      throw new Error('Erro ao consultar nota fiscal');
    }
  }

  /**
   * Cancela uma cobrança
   */
  async cancelPayment(paymentId: string) {
    try {
      await this.api.delete(`/payments/${paymentId}`);
    } catch (error: any) {
      console.error('❌ Erro ao cancelar cobrança:', error.response?.data || error.message);
      throw new Error('Erro ao cancelar cobrança');
    }
  }

  /**
   * Calcula data de vencimento do cliente (dia 15 do mês seguinte à veiculação)
   */
  calculateClientDueDate(campaignEndDate: Date): string {
    const dueDate = new Date(campaignEndDate);
    dueDate.setMonth(dueDate.getMonth() + 1); // Mês seguinte
    dueDate.setDate(15); // Dia 15
    return dueDate.toISOString().split('T')[0] || ''; // YYYY-MM-DD
  }

  /**
   * Calcula data de vencimento da emissora (último dia do mês seguinte à veiculação)
   */
  calculateBroadcasterDueDate(campaignEndDate: Date): string {
    const dueDate = new Date(campaignEndDate);
    dueDate.setMonth(dueDate.getMonth() + 2); // Próximo mês
    dueDate.setDate(0); // Último dia do mês anterior (= último dia do mês seguinte à veiculação)
    return dueDate.toISOString().split('T')[0] || ''; // YYYY-MM-DD
  }

  /**
   * Obtém URL do boleto (PDF)
   */
  async getBoletoUrl(paymentId: string): Promise<string> {
    try {
      const response = await this.api.get(`/payments/${paymentId}`);
      return response.data.bankSlipUrl || response.data.invoiceUrl || '';
    } catch (error: any) {
      console.error('❌ Erro ao obter URL do boleto:', error.response?.data || error.message);
      return '';
    }
  }

  /**
   * Emite Nota Fiscal de Serviço automaticamente
   * Documentação: https://docs.asaas.com/reference/criar-nota-fiscal
   */
  async emitirNotaFiscal(data: {
    paymentId: string;
    serviceDescription: string;
    observations?: string;
    externalReference?: string;
    effectiveDate?: string; // YYYY-MM-DD (opcional, padrão: hoje)
  }) {
    try {
      const subaccountApiKey = process.env.ASAAS_SUBACCOUNT_API_KEY;

      if (subaccountApiKey) {
      } else {
        console.warn('⚠️ Subconta não configurada - tentando com conta principal');
      }

      // Payload COMPLETO com todos os campos que a prefeitura de SP pode exigir
      const payload = {
        payment: data.paymentId,
        serviceDescription: data.serviceDescription,
        observations: data.observations || 'Campanha publicitária em rádio',
        externalReference: data.externalReference || `NF-${data.paymentId}`,
        effectiveDate: data.effectiveDate || new Date().toISOString().split('T')[0],

        // Código do serviço municipal (OBRIGATÓRIO para SP)
        municipalServiceCode: '06394',
        municipalServiceName: 'Agenciamento de propaganda e publicidade',

        // Impostos (conforme configuração do painel)
        taxes: {
          retainIss: false, // Tomador não retém ISS
          iss: 5.00,        // 5% conforme configurado
          cofins: 0,
          csll: 0,
          inss: 0,
          ir: 0,
          pis: 0
        }
      };


      // Usa API da subconta se configurada, senão usa conta principal
      const api = subaccountApiKey ? this.getSubaccountApi() : this.api;
      const response = await api.post('/invoices', payload);


      return {
        id: response.data.id,
        number: response.data.number,
        status: response.data.status, // PENDING, PROCESSING, AUTHORIZED, ERROR, CANCELLED
        xmlUrl: response.data.xmlUrl,
        pdfUrl: response.data.pdfUrl,
        effectiveDate: response.data.effectiveDate,
        value: response.data.value
      };
    } catch (error: any) {
      console.error('❌ Erro ao emitir nota fiscal:', error.response?.data || error.message);

      // Log detalhado para debug
      if (error.response?.data?.errors) {
        console.error('Erros detalhados:', error.response.data.errors);
      }

      throw new Error(
        error.response?.data?.errors?.[0]?.description ||
        'Erro ao emitir nota fiscal'
      );
    }
  }

  /**
   * Consulta status de uma nota fiscal
   */
  async consultarNotaFiscal(invoiceId: string) {
    try {
      const response = await this.api.get(`/invoices/${invoiceId}`);
      return response.data;
    } catch (error: any) {
      console.error('❌ Erro ao consultar nota fiscal:', error.response?.data || error.message);
      throw new Error('Erro ao consultar nota fiscal');
    }
  }

  /**
   * Cancela uma nota fiscal
   */
  async cancelarNotaFiscal(invoiceId: string, reason: string) {
    try {
      const response = await this.api.post(`/invoices/${invoiceId}/cancel`, {
        cancellationReason: reason
      });

      return response.data;
    } catch (error: any) {
      console.error('❌ Erro ao cancelar nota fiscal:', error.response?.data || error.message);
      throw new Error('Erro ao cancelar nota fiscal');
    }
  }

  // ========================================
  // TRANSFERÊNCIAS / SAQUES
  // ========================================

  /**
   * Consulta saldo disponível na conta Asaas
   */
  async getAccountBalance(): Promise<{
    balance: number;
    transferable: number;
  }> {
    try {

      const response = await this.api.get('/finance/balance');


      return {
        balance: response.data.balance,
        transferable: response.data.transferable || response.data.balance
      };
    } catch (error: any) {
      console.error('❌ Erro ao consultar saldo Asaas:', error.response?.data || error.message);
      throw new Error('Erro ao consultar saldo no Asaas');
    }
  }

  /**
   * Realiza transferência (saque) para conta bancária
   * Documentação: https://docs.asaas.com/reference/transferir-para-conta-bancaria
   */
  async createTransfer(data: {
    value: number;
    bankAccount: {
      bank: {
        code: string;
      };
      accountName: string;
      ownerName: string;
      ownerBirthDate?: string;
      cpfCnpj: string;
      agency: string;
      agencyDigit?: string;
      account: string;
      accountDigit: string;
      bankAccountType: 'CONTA_CORRENTE' | 'CONTA_POUPANCA';
    };
    operationType: 'PIX' | 'TED' | 'DOC';
    pixAddressKey?: string; // Chave PIX se operationType = PIX
    pixAddressKeyType?: 'CPF' | 'CNPJ' | 'EMAIL' | 'PHONE' | 'EVP';
    description?: string;
    scheduleDate?: string; // YYYY-MM-DD para agendar
  }): Promise<{
    id: string;
    value: number;
    netValue: number;
    status: 'PENDING' | 'BANK_PROCESSING' | 'DONE' | 'CANCELLED' | 'FAILED';
    transferFee: number;
    scheduleDate: string;
    authorized: boolean;
  }> {
    try {

      const payload: any = {
        value: data.value,
        operationType: data.operationType,
        description: data.description || 'Saque Plataforma SignalAds'
      };

      // Se for PIX com chave PIX (mais rápido)
      if (data.operationType === 'PIX' && data.pixAddressKey) {
        payload.pixAddressKey = data.pixAddressKey;
        payload.pixAddressKeyType = data.pixAddressKeyType;
      } else {
        // PIX por dados bancários, TED ou DOC - precisa do bankAccount
        payload.bankAccount = data.bankAccount;
      }

      // Se tiver data agendada
      if (data.scheduleDate) {
        payload.scheduleDate = data.scheduleDate;
      }


      const response = await this.api.post('/transfers', payload);


      return {
        id: response.data.id,
        value: response.data.value,
        netValue: response.data.netValue,
        status: response.data.status,
        transferFee: response.data.transferFee,
        scheduleDate: response.data.scheduleDate,
        authorized: response.data.authorized
      };
    } catch (error: any) {
      console.error('❌ Erro ao criar transferência Asaas:', error.response?.data || error.message);

      if (error.response?.data?.errors) {
        console.error('Erros detalhados:', error.response.data.errors);
        throw new Error(
          error.response.data.errors[0]?.description ||
          'Erro ao criar transferência'
        );
      }

      throw new Error('Erro ao criar transferência no Asaas');
    }
  }

  /**
   * Consulta status de uma transferência
   */
  async getTransferStatus(transferId: string): Promise<{
    id: string;
    value: number;
    netValue: number;
    status: 'PENDING' | 'BANK_PROCESSING' | 'DONE' | 'CANCELLED' | 'FAILED';
    transferFee: number;
    failReason?: string;
  }> {
    try {

      const response = await this.api.get(`/transfers/${transferId}`);


      return {
        id: response.data.id,
        value: response.data.value,
        netValue: response.data.netValue,
        status: response.data.status,
        transferFee: response.data.transferFee,
        failReason: response.data.failReason
      };
    } catch (error: any) {
      console.error('❌ Erro ao consultar transferência:', error.response?.data || error.message);
      throw new Error('Erro ao consultar transferência');
    }
  }

  /**
   * Lista transferências
   */
  async listTransfers(params?: {
    offset?: number;
    limit?: number;
    status?: 'PENDING' | 'BANK_PROCESSING' | 'DONE' | 'CANCELLED' | 'FAILED';
    dateCreatedGe?: string; // Data criação >= YYYY-MM-DD
    dateCreatedLe?: string; // Data criação <= YYYY-MM-DD
  }): Promise<{
    totalCount: number;
    data: Array<{
      id: string;
      value: number;
      netValue: number;
      status: string;
      transferFee: number;
      dateCreated: string;
      operationType: string;
    }>;
  }> {
    try {
      const response = await this.api.get('/transfers', { params });

      return {
        totalCount: response.data.totalCount,
        data: response.data.data
      };
    } catch (error: any) {
      console.error('❌ Erro ao listar transferências:', error.response?.data || error.message);
      throw new Error('Erro ao listar transferências');
    }
  }

  /**
   * Cancela uma transferência pendente
   */
  async cancelTransfer(transferId: string): Promise<{
    id: string;
    status: string;
  }> {
    try {

      const response = await this.api.delete(`/transfers/${transferId}`);


      return {
        id: response.data.id,
        status: response.data.status
      };
    } catch (error: any) {
      console.error('❌ Erro ao cancelar transferência:', error.response?.data || error.message);
      throw new Error('Erro ao cancelar transferência');
    }
  }
}

const asaasServiceInstance = new AsaasService();

export default asaasServiceInstance;
export { AsaasService };
