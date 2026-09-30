import { describe, expect, it } from 'vitest';

import { buildPrintDocument, mt, twoColumns, WIDTH, type CashClosePayload, type Op } from '../index';

function texto(ops: Op[]): string {
  return ops
    .filter((op): op is Extract<Op, { t: 'text' }> => op.t === 'text')
    .map((op) => op.value)
    .join('');
}

/** O talão de fecho de turno, como o trigger da F5 o põe na fila. */
const turno: CashClosePayload = {
  template: 'cash_close',
  store_short_name: 'Centro',
  shift_label: 'Turno 30/09/2026 10:43',
  opened_at: '2026-09-30T08:43:00Z',
  closed_at: '2026-09-30T14:24:00Z',
  opening_float_cents: 0,
  cash_sales_cents: 56_000,
  sangria_cents: 0,
  reforco_cents: 0,
  despesa_cents: 0,
  expected_cash_cents: 356_000,
  counted_cash_cents: 356_000,
  difference_cents: 0,
  payments: { cash: 56_000, mpesa: 360_000, emola: 798_000, credit_card: 413_000 },
  closed_by_name: 'Ana',
};

/** O mesmo turno, como a `reprint_cash_session` (1108) o volta a pôr na fila. */
const reimpresso = {
  ...turno,
  reprint: true,
  shift_label: `REIMPRESSÃO - ${turno.shift_label}`,
} as CashClosePayload;

describe('reimprimir o fecho de turno (1108)', () => {
  it('a marca sai na linha do turno, logo por baixo de FECHO DE CAIXA', () => {
    const linhas = texto(buildPrintDocument('cash_close', reimpresso)).split('\n');
    const titulo = linhas.indexOf('FECHO DE CAIXA');
    expect(titulo).toBeGreaterThanOrEqual(0);
    expect(linhas[titulo + 1]).toBe('REIMPRESSÃO - Turno 30/09/2026 10:43');
  });

  it('o original não leva a marca', () => {
    expect(texto(buildPrintDocument('cash_close', turno))).not.toContain('REIMPRESS');
  });

  it('os números são os do fecho, iguais ao original', () => {
    const original = texto(buildPrintDocument('cash_close', turno)).split('\n');
    const segunda = texto(buildPrintDocument('cash_close', reimpresso)).split('\n');
    for (const linha of [
      twoColumns('Esperado na gaveta', mt(356_000)),
      twoColumns('Contado', mt(356_000)),
      twoColumns('e-Mola', mt(798_000)),
    ]) {
      expect(original).toContain(linha);
      expect(segunda).toContain(linha);
    }
  });

  it('a linha marcada cabe no papel', () => {
    for (const linha of texto(buildPrintDocument('cash_close', reimpresso)).split('\n')) {
      expect(linha.length).toBeLessThanOrEqual(WIDTH);
    }
  });
});
