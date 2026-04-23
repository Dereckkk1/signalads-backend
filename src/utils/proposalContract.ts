import { getNextSequence } from '../models/Counter';
import type { IProposalContract, IContractInstallment, ContractIntervalUnit } from '../models/Proposal';

/**
 * Gera um numero de contrato sequencial por emissora.
 * Formato: CTR-{broadcasterIdShort}-{seq:0000}
 */
export async function generateContractNumber(broadcasterId: string): Promise<string> {
  const short = broadcasterId.slice(-6).toUpperCase();
  const seq = await getNextSequence(`contract-${broadcasterId}`);
  return `CTR-${short}-${String(seq).padStart(4, '0')}`;
}

/**
 * Adiciona ao `base` um offset baseado na unidade de intervalo (operacoes em UTC para evitar timezone drift).
 * `dueDay` (1-31) eh aplicado apenas para `month` (ajusta para o dia fixo; se nao existir no mes, usa ultimo dia do mes).
 */
function addInterval(base: Date, value: number, unit: ContractIntervalUnit, dueDay?: number): Date {
  const y = base.getUTCFullYear();
  const m = base.getUTCMonth();
  const d = base.getUTCDate();
  switch (unit) {
    case 'day':
      return new Date(Date.UTC(y, m, d + value));
    case 'week':
      return new Date(Date.UTC(y, m, d + value * 7));
    case 'fortnight':
      return new Date(Date.UTC(y, m, d + value * 15));
    case 'month': {
      const targetMonth = m + value;
      const targetYear = y + Math.floor(targetMonth / 12);
      const normalizedMonth = ((targetMonth % 12) + 12) % 12;
      const desiredDay = dueDay ?? d;
      const day = Math.min(desiredDay, lastDayOfMonthUTC(targetYear, normalizedMonth));
      return new Date(Date.UTC(targetYear, normalizedMonth, day));
    }
    default:
      return new Date(base);
  }
}

function lastDayOfMonthUTC(year: number, month: number): number {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

/**
 * Gera as parcelas do contrato a partir dos parametros. Se faltar algum dado
 * obrigatorio (firstDueDate, installmentsCount ou interval), retorna lista vazia.
 */
export function generateInstallments(params: {
  totalValue: number;
  installmentsCount?: number;
  firstDueDate?: Date | string;
  interval?: { value: number; unit: ContractIntervalUnit };
  dueDay?: number;
}): IContractInstallment[] {
  const { totalValue, installmentsCount, firstDueDate, interval, dueDay } = params;
  if (!installmentsCount || installmentsCount < 1) return [];
  if (!firstDueDate) return [];
  if (!interval || !interval.value || !interval.unit) return [];

  const count = Math.max(1, Math.floor(installmentsCount));
  // Distribui centavos remanescentes na ultima parcela
  const baseAmount = Math.floor((totalValue * 100) / count) / 100;
  const remainder = parseFloat((totalValue - baseAmount * count).toFixed(2));

  const firstDate = parseDateAsUTC(firstDueDate);

  const list: IContractInstallment[] = [];
  for (let i = 0; i < count; i++) {
    const dueDate = i === 0
      ? firstDate
      : addInterval(firstDate, interval.value * i, interval.unit, dueDay);
    const amount = i === count - 1 ? parseFloat((baseAmount + remainder).toFixed(2)) : baseAmount;
    list.push({ number: i + 1, dueDate, amount });
  }
  return list;
}

/**
 * Parseia uma data (string 'YYYY-MM-DD' ou Date) como data calendario em UTC,
 * evitando desvios por timezone local.
 */
function parseDateAsUTC(input: Date | string): Date {
  if (input instanceof Date) {
    return new Date(Date.UTC(input.getUTCFullYear(), input.getUTCMonth(), input.getUTCDate()));
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(input));
  if (match) {
    return new Date(Date.UTC(parseInt(match[1]!, 10), parseInt(match[2]!, 10) - 1, parseInt(match[3]!, 10)));
  }
  const d = new Date(input);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/**
 * Normaliza o payload de contrato recebido da requisicao para salvar no model.
 * Nao gera numero (feito em outro lugar para evitar consumir sequencia em atualizacao de draft).
 */
export function normalizeContractPayload(input: any, totalAmount: number): IProposalContract | undefined {
  if (!input || typeof input !== 'object') return undefined;

  const installmentsCount = Math.max(1, Math.floor(Number(input.installmentsCount) || 1));
  const totalValue = typeof input.totalValue === 'number' && input.totalValue >= 0
    ? input.totalValue
    : totalAmount;

  const interval = input.interval && input.interval.unit && input.interval.value
    ? {
      value: Math.max(1, Math.floor(Number(input.interval.value) || 1)),
      unit: input.interval.unit as ContractIntervalUnit
    }
    : undefined;

  const firstDueDate = input.firstDueDate ? new Date(input.firstDueDate) : undefined;
  const dueDay = input.dueDay != null ? Math.min(31, Math.max(1, Math.floor(Number(input.dueDay)))) : undefined;

  // Usa as parcelas enviadas pelo frontend (geradas pelo botao "Gerar"); se nao vier, regenera.
  let installments: IContractInstallment[] = [];
  if (Array.isArray(input.installments) && input.installments.length > 0) {
    installments = input.installments
      .map((i: any, idx: number) => ({
        number: Math.floor(Number(i.number) || idx + 1),
        dueDate: new Date(i.dueDate),
        amount: parseFloat(Number(i.amount || 0).toFixed(2))
      }))
      .filter((i: IContractInstallment) => !isNaN(i.dueDate.getTime()) && i.amount >= 0);
  } else {
    installments = generateInstallments({ totalValue, installmentsCount, firstDueDate, interval, dueDay });
  }

  const descriptionTags = Array.isArray(input.descriptionTags)
    ? input.descriptionTags.map((t: any) => String(t).trim()).filter(Boolean).slice(0, 30)
    : [];

  return {
    contractNumber: input.contractNumber || undefined,
    clientSnapshot: input.clientSnapshot && typeof input.clientSnapshot === 'object'
      ? { name: input.clientSnapshot.name, document: input.clientSnapshot.document }
      : undefined,
    agencySnapshot: input.agencySnapshot && typeof input.agencySnapshot === 'object'
      ? { name: input.agencySnapshot.name, document: input.agencySnapshot.document }
      : undefined,
    validity: input.validity && typeof input.validity === 'object'
      ? {
        start: input.validity.start ? new Date(input.validity.start) : undefined,
        end: input.validity.end ? new Date(input.validity.end) : undefined
      }
      : undefined,
    totalValue,
    installmentsCount,
    firstDueDate,
    carrier: input.carrier ? String(input.carrier).trim() : undefined,
    procedure: input.procedure ? String(input.procedure).trim() : undefined,
    interval,
    dueDay,
    installments,
    description: input.description ? String(input.description) : undefined,
    descriptionTags
  };
}
