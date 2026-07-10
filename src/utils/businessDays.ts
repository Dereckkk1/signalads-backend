/**
 * Utilitários de dias úteis (business days) para prazos de veiculação.
 *
 * "Dia útil" = segunda a sexta (UTC). Feriados não são considerados —
 * mesmo critério já usado no carrinho (cartController.cleanExpiredSchedules).
 */

/** Soma `days` dias úteis a `start`, pulando sábados e domingos. Não muta `start`. */
export function addBusinessDays(start: Date, days: number): Date {
  const d = new Date(start);
  let remaining = days;
  while (remaining > 0) {
    d.setUTCDate(d.getUTCDate() + 1);
    const dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6) remaining--;
  }
  return d;
}

/** Antecedência mínima padrão (dias úteis) para uma campanha ir ao ar. */
export const DEFAULT_LEAD_BUSINESS_DAYS = 3;

/**
 * Data mais cedo em que uma campanha pode ir ao ar para uma emissora.
 * `leadDays` vem de `broadcasterProfile.businessRules.minAdvanceBooking` quando existir;
 * senão usa o default de 3 dias úteis (mesmo valor exibido hoje no carrinho).
 */
export function earliestOnAirDate(leadDays?: number, now: Date = new Date()): Date {
  return addBusinessDays(now, leadDays ?? DEFAULT_LEAD_BUSINESS_DAYS);
}
