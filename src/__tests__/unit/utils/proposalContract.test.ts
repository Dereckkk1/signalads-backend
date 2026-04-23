/**
 * Unit tests para utils/proposalContract.
 * Testa generateInstallments e normalizeContractPayload (gerador de numero eh integration).
 */

import { generateInstallments, normalizeContractPayload } from '../../../utils/proposalContract';

describe('generateInstallments', () => {
  it('gera lista vazia quando parametros obrigatorios faltam', () => {
    expect(generateInstallments({ totalValue: 1000 })).toEqual([]);
    expect(generateInstallments({ totalValue: 1000, installmentsCount: 3 })).toEqual([]);
    expect(generateInstallments({ totalValue: 1000, installmentsCount: 3, firstDueDate: '2026-05-01' })).toEqual([]);
  });

  it('gera 1 parcela quando installmentsCount=1', () => {
    const res = generateInstallments({
      totalValue: 500,
      installmentsCount: 1,
      firstDueDate: '2026-05-10',
      interval: { value: 30, unit: 'day' },
    });
    expect(res).toHaveLength(1);
    expect(res[0]!.number).toBe(1);
    expect(res[0]!.amount).toBe(500);
    expect(res[0]!.dueDate.toISOString().slice(0, 10)).toBe('2026-05-10');
  });

  it('distribui valores iguais e soma total igual ao totalValue', () => {
    const res = generateInstallments({
      totalValue: 300,
      installmentsCount: 3,
      firstDueDate: '2026-05-01',
      interval: { value: 30, unit: 'day' },
    });
    expect(res).toHaveLength(3);
    const sum = res.reduce((acc, i) => acc + i.amount, 0);
    expect(parseFloat(sum.toFixed(2))).toBe(300);
    expect(res[0]!.amount).toBe(100);
  });

  it('coloca centavos remanescentes na ultima parcela', () => {
    const res = generateInstallments({
      totalValue: 100,
      installmentsCount: 3,
      firstDueDate: '2026-05-01',
      interval: { value: 30, unit: 'day' },
    });
    expect(res).toHaveLength(3);
    const sum = res.reduce((acc, i) => acc + i.amount, 0);
    expect(parseFloat(sum.toFixed(2))).toBe(100);
    // As duas primeiras sao iguais e a ultima absorve diferenca
    expect(res[0]!.amount).toBe(res[1]!.amount);
    expect(res[2]!.amount).toBeGreaterThanOrEqual(res[0]!.amount);
  });

  it('avanca por dias corretamente', () => {
    const res = generateInstallments({
      totalValue: 100,
      installmentsCount: 3,
      firstDueDate: '2026-01-01',
      interval: { value: 15, unit: 'day' },
    });
    expect(res[0]!.dueDate.toISOString().slice(0, 10)).toBe('2026-01-01');
    expect(res[1]!.dueDate.toISOString().slice(0, 10)).toBe('2026-01-16');
    expect(res[2]!.dueDate.toISOString().slice(0, 10)).toBe('2026-01-31');
  });

  it('avanca por semanas corretamente', () => {
    const res = generateInstallments({
      totalValue: 100,
      installmentsCount: 3,
      firstDueDate: '2026-01-05',
      interval: { value: 1, unit: 'week' },
    });
    expect(res[1]!.dueDate.toISOString().slice(0, 10)).toBe('2026-01-12');
    expect(res[2]!.dueDate.toISOString().slice(0, 10)).toBe('2026-01-19');
  });

  it('avanca por quinzenas (15 dias) corretamente', () => {
    const res = generateInstallments({
      totalValue: 100,
      installmentsCount: 2,
      firstDueDate: '2026-01-10',
      interval: { value: 1, unit: 'fortnight' },
    });
    expect(res[1]!.dueDate.toISOString().slice(0, 10)).toBe('2026-01-25');
  });

  it('avanca por meses ajustando ao dueDay', () => {
    const res = generateInstallments({
      totalValue: 300,
      installmentsCount: 3,
      firstDueDate: '2026-01-10',
      interval: { value: 1, unit: 'month' },
      dueDay: 15,
    });
    expect(res[0]!.dueDate.toISOString().slice(0, 10)).toBe('2026-01-10');
    expect(res[1]!.dueDate.toISOString().slice(0, 10)).toBe('2026-02-15');
    expect(res[2]!.dueDate.toISOString().slice(0, 10)).toBe('2026-03-15');
  });

  it('ajusta dueDay=31 para ultimo dia de fevereiro', () => {
    const res = generateInstallments({
      totalValue: 100,
      installmentsCount: 2,
      firstDueDate: '2026-01-31',
      interval: { value: 1, unit: 'month' },
      dueDay: 31,
    });
    expect(res[1]!.dueDate.toISOString().slice(0, 10)).toBe('2026-02-28');
  });
});

describe('normalizeContractPayload', () => {
  it('retorna undefined quando input eh invalido', () => {
    expect(normalizeContractPayload(null, 1000)).toBeUndefined();
    expect(normalizeContractPayload(undefined, 1000)).toBeUndefined();
    expect(normalizeContractPayload('string', 1000)).toBeUndefined();
  });

  it('usa totalAmount quando totalValue nao vem no payload', () => {
    const res = normalizeContractPayload({
      installmentsCount: 2,
      firstDueDate: '2026-05-01',
      interval: { value: 30, unit: 'day' },
    }, 500);
    expect(res?.totalValue).toBe(500);
  });

  it('gera parcelas quando nao vierem no payload', () => {
    const res = normalizeContractPayload({
      installmentsCount: 2,
      firstDueDate: '2026-05-01',
      interval: { value: 30, unit: 'day' },
    }, 200);
    expect(res?.installments).toHaveLength(2);
  });

  it('preserva parcelas quando vierem do cliente', () => {
    const res = normalizeContractPayload({
      installmentsCount: 2,
      firstDueDate: '2026-05-01',
      interval: { value: 30, unit: 'day' },
      installments: [
        { number: 1, dueDate: '2026-05-01', amount: 100 },
        { number: 2, dueDate: '2026-05-31', amount: 100 },
      ],
    }, 200);
    expect(res?.installments).toHaveLength(2);
    expect(res?.installments[0]!.amount).toBe(100);
  });

  it('limita descriptionTags a 30 e filtra vazias', () => {
    const manyTags = Array.from({ length: 50 }, (_, i) => `tag-${i}`);
    const res = normalizeContractPayload({
      installmentsCount: 1,
      firstDueDate: '2026-05-01',
      interval: { value: 30, unit: 'day' },
      descriptionTags: [...manyTags, '', '   ', null, undefined],
    }, 100);
    expect(res?.descriptionTags).toHaveLength(30);
  });

  it('clampa dueDay entre 1 e 31', () => {
    const low = normalizeContractPayload({ dueDay: 0 }, 100);
    const high = normalizeContractPayload({ dueDay: 99 }, 100);
    expect(low?.dueDay).toBe(1);
    expect(high?.dueDay).toBe(31);
  });
});
