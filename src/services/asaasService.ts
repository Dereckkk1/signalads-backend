/**
 * Asaas API v3 wrapper.
 * Sem armazenar PII de cartão — apenas repassa pro Asaas (PCI Level 1).
 *
 * Configuração:
 * - ASAAS_API_URL: URL base da API (ex: https://sandbox.asaas.com/api/v3)
 * - ASAAS_API_KEY: chave de acesso enviada no header `access_token`
 *
 * Tratamento de erros: extrai `err.response?.data?.errors?.[0]?.description`
 * do retorno do Asaas para mensagens amigáveis. Logs sempre passam por
 * `sanitizeForLog` para evitar vazamento de PII (cartão, CPF/CNPJ, CCV).
 */
import axios, { AxiosInstance } from 'axios';
import { User, IUser } from '../models/User';

const TIMEOUT_MS = 15000;

function client(): AxiosInstance {
  return axios.create({
    baseURL: process.env.ASAAS_API_URL,
    timeout: TIMEOUT_MS,
    headers: {
      access_token: process.env.ASAAS_API_KEY || '',
      'Content-Type': 'application/json',
      'User-Agent': 'E-radios/1.0',
    },
  });
}

/**
 * Mascara campos sensíveis recursivamente (cartão, CPF/CNPJ, CCV)
 * antes de logar payloads do Asaas.
 */
export function sanitizeForLog(obj: any): any {
  if (!obj || typeof obj !== 'object') return obj;
  const masked: any = Array.isArray(obj) ? [] : {};
  const sensitive = ['cpfCnpj', 'number', 'ccv', 'cvv', 'cardNumber'];
  for (const k of Object.keys(obj)) {
    if (sensitive.includes(k)) {
      masked[k] = '***';
    } else if (obj[k] !== null && typeof obj[k] === 'object') {
      masked[k] = sanitizeForLog(obj[k]);
    } else {
      masked[k] = obj[k];
    }
  }
  return masked;
}

/**
 * Retorna o `asaasCustomerId` do usuário, criando-o no Asaas lazy
 * se ainda não existir. Persiste o ID no User model.
 */
export async function getOrCreateCustomer(
  user: Pick<IUser, 'name' | 'email' | 'cpfOrCnpj' | 'phone' | 'asaasCustomerId'> & { _id: any }
): Promise<string> {
  if (!user.cpfOrCnpj) throw new Error('User sem cpfCnpj — impossível criar customer no Asaas');

  // Se já tem um asaasCustomerId, valida que ainda existe no ambiente atual.
  // Customers criados em sandbox NÃO existem em produção (e vice-versa) — sem
  // essa checagem, trocar ASAAS_API_URL quebra checkouts antigos com 'Customer inválido'.
  if (user.asaasCustomerId) {
    try {
      const { data } = await client().get(`/customers/${user.asaasCustomerId}`);
      if (data?.id) return data.id;
    } catch (err: any) {
      const status = err.response?.status;
      if (status === 404 || status === 400) {
        console.warn(
          `[asaasService] asaasCustomerId ${user.asaasCustomerId} não encontrado no ambiente atual — recriando`
        );
        // cai pro fluxo de criação abaixo (sem return aqui)
      } else {
        // erro transitório (network, 5xx) — propaga
        throw new Error(
          err.response?.data?.errors?.[0]?.description || 'Erro ao validar customer no Asaas'
        );
      }
    }
  }

  const payload = {
    name: user.name,
    email: user.email,
    cpfCnpj: user.cpfOrCnpj,
    mobilePhone: user.phone || undefined,
    notificationDisabled: true,
  };

  try {
    const { data } = await client().post('/customers', payload);
    await User.findByIdAndUpdate(user._id, { asaasCustomerId: data.id });
    return data.id;
  } catch (err: any) {
    const reason =
      err.response?.data?.errors?.[0]?.description || 'Erro ao criar customer no Asaas';
    console.error('[asaasService.getOrCreateCustomer]', sanitizeForLog(payload), reason);
    throw new Error(reason);
  }
}

// ─── Credit Card ─────────────────────────────────────────────────────

export interface CreditCardChargeParams {
  customerId: string;
  value: number;
  dueDate: string; // YYYY-MM-DD
  installmentCount: number;
  installmentValue: number;
  externalReference: string;
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
    phone: string;
  };
}

export interface ChargeResult {
  asaasPaymentId: string;
  status: string;
  invoiceUrl?: string;
  cardBrand?: string;
  cardLastDigits?: string;
}

export async function createCreditCardCharge(params: CreditCardChargeParams): Promise<ChargeResult> {
  const payload: any = {
    customer: params.customerId,
    billingType: 'CREDIT_CARD',
    value: params.value,
    dueDate: params.dueDate,
    description: `Pedido ${params.externalReference}`,
    externalReference: params.externalReference,
    creditCard: params.creditCard,
    creditCardHolderInfo: params.creditCardHolderInfo,
  };
  if (params.installmentCount > 1) {
    payload.installmentCount = params.installmentCount;
    payload.installmentValue = params.installmentValue;
    delete payload.value;
  }

  try {
    const { data } = await client().post('/payments', payload);
    return {
      asaasPaymentId: data.id,
      status: data.status,
      invoiceUrl: data.invoiceUrl,
      cardBrand: data.creditCard?.creditCardBrand,
      cardLastDigits: data.creditCard?.creditCardNumber,
    };
  } catch (err: any) {
    const reason = err.response?.data?.errors?.[0]?.description || 'Erro ao processar cartão';
    console.error('[asaasService.createCreditCardCharge]', sanitizeForLog(payload), reason);
    throw new Error(reason);
  }
}

// ─── PIX ─────────────────────────────────────────────────────────────

export interface PixChargeParams {
  customerId: string;
  value: number;
  dueDate: string;
  externalReference: string;
}

export interface PixChargeResult {
  asaasPaymentId: string;
  status: string;
  invoiceUrl?: string;
}

export async function createPixCharge(params: PixChargeParams): Promise<PixChargeResult> {
  try {
    const { data } = await client().post('/payments', {
      customer: params.customerId,
      billingType: 'PIX',
      value: params.value,
      dueDate: params.dueDate,
      description: `Pedido ${params.externalReference}`,
      externalReference: params.externalReference,
    });
    return { asaasPaymentId: data.id, status: data.status, invoiceUrl: data.invoiceUrl };
  } catch (err: any) {
    const reason = err.response?.data?.errors?.[0]?.description || 'Erro ao criar cobrança PIX';
    console.error('[asaasService.createPixCharge]', reason);
    throw new Error(reason);
  }
}

export async function getPixQrCode(
  asaasPaymentId: string
): Promise<{ pixQrCode: string; pixCopyPaste: string; expiresAt?: string }> {
  try {
    const { data } = await client().get(`/payments/${asaasPaymentId}/pixQrCode`);
    return {
      pixQrCode: data.encodedImage,
      pixCopyPaste: data.payload,
      expiresAt: data.expirationDate,
    };
  } catch (err: any) {
    const reason = err.response?.data?.errors?.[0]?.description || 'Erro ao obter QR Code PIX';
    console.error('[asaasService.getPixQrCode]', reason);
    throw new Error(reason);
  }
}

// ─── Status ──────────────────────────────────────────────────────────

export interface PaymentStatusResult {
  status: string;
  paymentDate?: string;
  netValue?: number;
  invoiceUrl?: string;
}

export async function getPaymentStatus(asaasPaymentId: string): Promise<PaymentStatusResult> {
  try {
    const { data } = await client().get(`/payments/${asaasPaymentId}`);
    return {
      status: data.status,
      paymentDate: data.paymentDate,
      netValue: data.netValue,
      invoiceUrl: data.invoiceUrl,
    };
  } catch (err: any) {
    const reason = err.response?.data?.errors?.[0]?.description || 'Erro ao consultar pagamento';
    console.error('[asaasService.getPaymentStatus]', reason);
    throw new Error(reason);
  }
}
