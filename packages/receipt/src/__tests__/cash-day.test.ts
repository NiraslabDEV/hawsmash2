import { describe, expect, it } from 'vitest';

import {
  buildPrintDocument,
  isCashDayPayload,
  mt,
  signedMT,
  twoColumns,
  type CashClosePayload,
  type CashDayPayload,
  type Op,
} from '../index';

function texto(ops: Op[]): string {
  return ops
    .filter((op): op is Extract<Op, { t: 'text' }> => op.t === 'text')
    .map((op) => op.value)
    .join('');
}

/** O que a `close_cash_day` (1091) põe na fila: o dia + os campos do talão de turno. */
const dia: CashDayPayload = {
  template: 'cash_close',
  day: true,
  store_short_name: 'Centro',
  shift_label: 'FECHO DO DIA 25/09/2026 - 2 turnos',
  business_date: '2026-09-25',
  shifts_count: 2,
  first_opened_at: '2026-09-25T09:02:00Z',
  opened_at: '2026-09-25T09:02:00Z',
  closed_at: '2026-09-25T19:50:00Z',
  opening_float_cents: 100_000,
  closing_cash_cents: 420_000,
  cash_sales_cents: 700_000,
  sangria_cents: 300_000,
  reforco_cents: 0,
  despesa_cents: 20_000,
  troco_inicial_cents: 0,
  expected_cash_cents: 425_000,
  counted_cash_cents: 420_000,
  difference_cents: -5_000,
  difference_reason: null,
  total_pedidos: 58,
  total_faturado_cents: 1_150_000,
  payments: { cash: 700_000, mpesa: 300_000, emola: 150_000, credit_card: 0 },
  closed_by_name: 'Bruno',
  shifts: [
    {
      session_id: 's1',
      shift_label: 'Turno 25/09/2026 11:02',
      opened_at: '2026-09-25T09:02:00Z',
      closed_at: '2026-09-25T14:00:00Z',
      opened_by_name: 'Ana',
      closed_by_name: 'Ana',
      opening_float_cents: 100_000,
      expected_cash_cents: 380_000,
      counted_cash_cents: 380_000,
      difference_cents: 0,
      difference_reason: null,
      total_pedidos: 25,
      total_faturado_cents: 500_000,
    },
    {
      session_id: 's2',
      shift_label: 'Turno 25/09/2026 16:05',
      opened_at: '2026-09-25T14:05:00Z',
      closed_at: '2026-09-25T19:45:00Z',
      opened_by_name: 'Bruno',
      closed_by_name: 'Bruno',
      opening_float_cents: 100_000,
      expected_cash_cents: 425_000,
      counted_cash_cents: 420_000,
      difference_cents: -5_000,
      difference_reason: 'Troco dado a mais',
      total_pedidos: 33,
      total_faturado_cents: 650_000,
    },
  ],
};

describe('talão do fecho do dia', () => {
  it('reconhece o dia pelo `day` e pela lista de turnos', () => {
    expect(isCashDayPayload(dia)).toBe(true);
    const turno: CashClosePayload = { ...dia, day: undefined, shifts: undefined } as unknown as CashClosePayload;
    expect(isCashDayPayload(turno)).toBe(false);
  });

  it('sai com os turnos, quem abriu e fechou, e a diferença de cada um', () => {
    const papel = texto(buildPrintDocument('cash_close', dia));
    expect(papel).toContain('FECHO DO DIA');
    expect(papel).not.toContain('FECHO DE CAIXA');
    expect(papel).toContain('2 turnos');
    expect(papel).toMatch(/Abriu Ana \/ Fechou Ana/);
    expect(papel).toMatch(/Abriu Bruno \/ Fechou Bruno/);
    expect(papel).toContain('Troco dado a mais');
  });

  it('soma o dia: pedidos, formas de pagamento, movimentos e diferença', () => {
    const linhas = texto(buildPrintDocument('cash_close', dia)).split('\n');
    expect(linhas).toContain(twoColumns('Pedidos', '58'));
    expect(linhas).toContain(twoColumns('M-Pesa', mt(300_000)));
    expect(linhas).toContain(twoColumns('TOTAL', mt(1_150_000)));
    expect(linhas).toContain(twoColumns('Sangrias', `-${mt(300_000)}`));
    expect(linhas).toContain(twoColumns('Na gaveta ao fechar', mt(420_000)));
    expect(linhas).toContain(twoColumns('DIFERENCA DO DIA', signedMT(-5_000)));
    expect(linhas).toContain('Fechado por: Bruno');
  });

  it('nenhuma linha passa das 48 colunas', () => {
    const papel = texto(buildPrintDocument('cash_close', dia));
    for (const linha of papel.split('\n')) expect(linha.length).toBeLessThanOrEqual(48);
  });

  it('o fecho de turno continua igual', () => {
    const { day: _day, shifts: _shifts, ...campos } = dia;
    const turno = { ...campos, shift_label: 'Turno 25/09/2026 11:02' } as CashClosePayload;
    const papel = texto(buildPrintDocument('cash_close', turno));
    expect(papel).toContain('FECHO DE CAIXA');
    expect(papel).not.toContain('FECHO DO DIA');
  });
});
