/**
 * Unit tests para asaasService.
 * Mock: axios — nunca chama Asaas real.
 */
import axios from 'axios';
import {
  getOrCreateCustomer,
  sanitizeForLog,
  createCreditCardCharge,
  createPixCharge,
  getPixQrCode,
  getPaymentStatus,
} from '../../services/asaasService';
import { User } from '../../models/User';

jest.mock('axios');
jest.mock('../../models/User', () => ({
  User: {
    findByIdAndUpdate: jest.fn(),
  },
}));

const mockedAxios = axios as jest.Mocked<typeof axios>;
const mockedUser = User as unknown as { findByIdAndUpdate: jest.Mock };

// Single shared axios instance returned by axios.create — lets the service
// call client().post / client().get and our mocks intercept it.
const mockAxiosInstance = {
  post: jest.fn(),
  get: jest.fn(),
};

beforeEach(() => {
  jest.clearAllMocks();
  process.env.ASAAS_API_URL = 'https://sandbox.asaas.com/api/v3';
  process.env.ASAAS_API_KEY = 'test_key';
  mockAxiosInstance.post.mockReset();
  mockAxiosInstance.get.mockReset();
  mockedAxios.create = jest.fn().mockReturnValue(mockAxiosInstance) as any;
});

describe('asaasService.getOrCreateCustomer', () => {
  it('retorna asaasCustomerId existente após validar no Asaas (1 GET, sem POST)', async () => {
    const user: any = {
      _id: 'u1',
      name: 'Joao',
      email: 'joao@test.com',
      cpfOrCnpj: '12345678900',
      phone: '11999999999',
      asaasCustomerId: 'cus_existing_123',
    };
    mockAxiosInstance.get.mockResolvedValueOnce({ data: { id: 'cus_existing_123' } });
    const result = await getOrCreateCustomer(user);
    expect(result).toBe('cus_existing_123');
    expect(mockAxiosInstance.get).toHaveBeenCalledWith('/customers/cus_existing_123');
    expect(mockAxiosInstance.post).not.toHaveBeenCalled();
  });

  it('recria customer quando id antigo não existe no ambiente atual (404)', async () => {
    const user: any = {
      _id: 'u_stale',
      name: 'João',
      email: 'j@x.com',
      cpfOrCnpj: '12345678900',
      phone: '11999999999',
      asaasCustomerId: 'cus_from_sandbox',
    };
    mockAxiosInstance.get.mockRejectedValueOnce({ response: { status: 404, data: { errors: [{ description: 'Not Found' }] } } });
    mockAxiosInstance.post.mockResolvedValueOnce({ data: { id: 'cus_brand_new' } });
    const { User } = require('../../models/User');
    User.findByIdAndUpdate = jest.fn().mockResolvedValue({});

    const result = await getOrCreateCustomer(user);
    expect(result).toBe('cus_brand_new');
    expect(mockAxiosInstance.get).toHaveBeenCalledWith('/customers/cus_from_sandbox');
    expect(mockAxiosInstance.post).toHaveBeenCalledWith('/customers', expect.objectContaining({ cpfCnpj: '12345678900' }));
    expect(User.findByIdAndUpdate).toHaveBeenCalledWith('u_stale', { asaasCustomerId: 'cus_brand_new' });
  });

  it('cria customer no Asaas e persiste no User quando asaasCustomerId vazio', async () => {
    const user: any = {
      _id: 'u2',
      name: 'Maria',
      email: 'maria@test.com',
      cpfOrCnpj: '12345678000190',
      phone: '11988887777',
      asaasCustomerId: null,
    };
    mockAxiosInstance.post.mockResolvedValue({ data: { id: 'cus_new_456' } });
    mockedUser.findByIdAndUpdate.mockResolvedValue({});

    const result = await getOrCreateCustomer(user);

    expect(result).toBe('cus_new_456');
    expect(mockAxiosInstance.post).toHaveBeenCalledWith(
      '/customers',
      expect.objectContaining({ name: 'Maria', email: 'maria@test.com', cpfCnpj: '12345678000190' })
    );
    expect(mockedUser.findByIdAndUpdate).toHaveBeenCalledWith('u2', { asaasCustomerId: 'cus_new_456' });
  });

  it('lanca erro se cpfOrCnpj ausente', async () => {
    const user: any = { _id: 'u3', name: 'Sem Doc', email: 'x@y.com', phone: '11', asaasCustomerId: null };
    await expect(getOrCreateCustomer(user)).rejects.toThrow(/cpfCnpj/i);
  });
});

describe('asaasService.sanitizeForLog', () => {
  it('mascara cpfCnpj, creditCard.number, ccv', () => {
    const input = {
      cpfCnpj: '12345678900',
      creditCard: { number: '4111111111111111', ccv: '123', holderName: 'Joao' },
    };
    const out = sanitizeForLog(input);
    expect(out.cpfCnpj).toBe('***');
    expect(out.creditCard.number).toBe('***');
    expect(out.creditCard.ccv).toBe('***');
    expect(out.creditCard.holderName).toBe('Joao');
  });
});

describe('asaasService.createCreditCardCharge', () => {
  it('cria cobranca CREDIT_CARD com installments e retorna chargeId + ultimos 4', async () => {
    mockAxiosInstance.post.mockResolvedValue({
      data: {
        id: 'pay_123',
        status: 'CONFIRMED',
        invoiceUrl: 'https://sandbox.asaas.com/i/abc',
        creditCard: { creditCardBrand: 'VISA', creditCardNumber: '1111' },
      },
    });

    const result = await createCreditCardCharge({
      customerId: 'cus_1',
      value: 100,
      dueDate: '2026-05-20',
      installmentCount: 12,
      installmentValue: 8.34,
      externalReference: 'order_1',
      creditCard: { holderName: 'Joao', number: '4111111111111111', expiryMonth: '12', expiryYear: '2030', ccv: '123' },
      creditCardHolderInfo: { name: 'Joao', email: 'j@a.com', cpfCnpj: '12345678900', postalCode: '01310200', addressNumber: '1636', phone: '11999999999' },
    });

    expect(result.asaasPaymentId).toBe('pay_123');
    expect(result.status).toBe('CONFIRMED');
    expect(result.invoiceUrl).toBe('https://sandbox.asaas.com/i/abc');
    expect(result.cardBrand).toBe('VISA');
    expect(result.cardLastDigits).toBe('1111');
  });

  it('propaga erro com mensagem do Asaas se 4xx', async () => {
    // Silenciar console.error so o output de teste fica limpo
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    mockAxiosInstance.post.mockRejectedValue({
      response: { status: 400, data: { errors: [{ description: 'Cartão recusado' }] } },
      isAxiosError: true,
    });

    await expect(
      createCreditCardCharge({
        customerId: 'cus_1', value: 100, dueDate: '2026-05-20', installmentCount: 1, installmentValue: 100,
        externalReference: 'order_2',
        creditCard: { holderName: 'X', number: '4', expiryMonth: '12', expiryYear: '2030', ccv: '1' },
        creditCardHolderInfo: { name: 'X', email: 'x@y.com', cpfCnpj: '1', postalCode: '1', addressNumber: '1', phone: '1' },
      })
    ).rejects.toThrow(/recusado/i);

    errSpy.mockRestore();
  });
});

describe('asaasService.createPixCharge', () => {
  it('cria cobranca PIX e retorna chargeId', async () => {
    mockAxiosInstance.post.mockResolvedValue({
      data: { id: 'pay_pix_1', status: 'PENDING', invoiceUrl: 'https://x/i/pix' },
    });

    const result = await createPixCharge({
      customerId: 'cus_1', value: 100, dueDate: '2026-05-21', externalReference: 'order_3',
    });
    expect(result.asaasPaymentId).toBe('pay_pix_1');
    expect(result.status).toBe('PENDING');
  });
});

describe('asaasService.getPixQrCode', () => {
  it('retorna qrCode e copia-e-cola', async () => {
    mockAxiosInstance.get.mockResolvedValue({
      data: { encodedImage: 'base64xyz', payload: '00020126...', expirationDate: '2026-05-22 10:00:00' },
    });

    const result = await getPixQrCode('pay_pix_1');
    expect(result.pixQrCode).toBe('base64xyz');
    expect(result.pixCopyPaste).toBe('00020126...');
    expect(mockAxiosInstance.get).toHaveBeenCalledWith('/payments/pay_pix_1/pixQrCode');
  });
});

describe('asaasService.getPaymentStatus', () => {
  it('retorna status do payment', async () => {
    mockAxiosInstance.get.mockResolvedValue({
      data: { id: 'pay_1', status: 'RECEIVED', paymentDate: '2026-05-20' },
    });
    const result = await getPaymentStatus('pay_1');
    expect(result.status).toBe('RECEIVED');
    expect(result.paymentDate).toBe('2026-05-20');
  });
});
