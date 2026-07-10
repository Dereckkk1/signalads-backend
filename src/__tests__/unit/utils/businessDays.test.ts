import { addBusinessDays, earliestOnAirDate, DEFAULT_LEAD_BUSINESS_DAYS } from '../../../utils/businessDays';

describe('addBusinessDays', () => {
  it('pula fim de semana', () => {
    // sexta 2026-07-10 + 3 dias úteis = quarta 2026-07-15
    const d = addBusinessDays(new Date('2026-07-10T12:00:00Z'), 3);
    expect(d.toISOString().slice(0, 10)).toBe('2026-07-15');
  });

  it('zero dias devolve o mesmo dia', () => {
    const d = addBusinessDays(new Date('2026-07-08T12:00:00Z'), 0);
    expect(d.toISOString().slice(0, 10)).toBe('2026-07-08');
  });

  it('não muta a data de entrada', () => {
    const start = new Date('2026-07-10T12:00:00Z');
    addBusinessDays(start, 5);
    expect(start.toISOString().slice(0, 10)).toBe('2026-07-10');
  });
});

describe('earliestOnAirDate', () => {
  it('usa 3 dias úteis como default', () => {
    const d = earliestOnAirDate(undefined, new Date('2026-07-10T12:00:00Z'));
    expect(d.toISOString().slice(0, 10)).toBe('2026-07-15');
    expect(DEFAULT_LEAD_BUSINESS_DAYS).toBe(3);
  });

  it('respeita leadDays customizado da emissora', () => {
    // segunda 2026-07-13 + 5 dias úteis = segunda 2026-07-20
    const d = earliestOnAirDate(5, new Date('2026-07-13T12:00:00Z'));
    expect(d.toISOString().slice(0, 10)).toBe('2026-07-20');
  });
});
