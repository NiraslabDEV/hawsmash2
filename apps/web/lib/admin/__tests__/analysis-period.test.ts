import { describe, expect, it } from 'vitest';
import { analysisPeriodStart, maputoDate, nextMaputoDay } from '../analysis-period';

describe('períodos da análise', () => {
  const now = new Date('2026-09-24T22:30:00Z');
  it('usa as mesmas janelas móveis de vendas e aquisição', () => {
    expect(analysisPeriodStart('day', now)).toBe('2026-09-23T22:30:00.000Z');
    expect(analysisPeriodStart('week', now)).toBe('2026-09-17T22:30:00.000Z');
    expect(analysisPeriodStart('month', now)).toBe('2026-08-25T22:30:00.000Z');
    expect(analysisPeriodStart('all', now)).toBe('1970-01-01T00:00:00.000Z');
  });
  it('usa a data de Maputo mesmo se o navegador estiver noutro fuso', () => {
    expect(maputoDate(now)).toBe('2026-09-25');
    expect(nextMaputoDay('2026-09-30')).toBe('2026-09-30T22:00:00.000Z');
  });
});
