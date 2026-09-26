import { describe, expect, it } from 'vitest';

import { dayShiftsLabel, parseCashDayReport } from '../day';
import { cashDayEmailHtml } from '../report';

/** O que a `close_cash_day` (1091) grava em `cash_day_closes.report`. */
const relatorioDoDia = {
  day_close_id: '00000000-0000-4000-8000-000000000901',
  store_id: '00000000-0000-4000-8000-000000000101',
  business_date: '2026-09-25',
  shifts_count: 2,
  first_opened_at: '2026-09-25T09:02:00Z',
  last_shift_closed_at: '2026-09-25T19:45:00Z',
  closed_at: '2026-09-25T19:50:00Z',
  closed_by_name: 'Bruno',
  opening_float_cents: 100_000,
  closing_cash_cents: 420_000,
  total_pedidos: 58,
  total_faturado_cents: 1_150_000,
  payments: { cash: 700_000, mpesa: 300_000, emola: 150_000, credit_card: 0 },
  cash_sales_cents: 700_000,
  sangria_cents: 300_000,
  reforco_cents: 0,
  despesa_cents: 20_000,
  troco_inicial_cents: 0,
  difference_cents: -5_000,
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
      opened_by_name: '<b>Bruno</b>',
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

describe('relatório do fecho do dia', () => {
  it('lê o dia com os turnos e quem os abriu e fechou', () => {
    const dia = parseCashDayReport(relatorioDoDia);
    expect(dia?.shifts_count).toBe(2);
    expect(dia?.total_faturado_cents).toBe(1_150_000);
    expect(dia?.shifts.map((shift) => shift.closed_by_name)).toEqual(['Ana', 'Bruno']);
    expect(dia?.payments.mpesa).toBe(300_000);
  });

  it('dinheiro que não vem em centavos inteiros invalida a leitura', () => {
    expect(parseCashDayReport({ ...relatorioDoDia, total_faturado_cents: 11500.5 })).toBeNull();
    expect(parseCashDayReport({ ...relatorioDoDia, payments: { ...relatorioDoDia.payments, cash: '7000' } })).toBeNull();
    expect(
      parseCashDayReport({
        ...relatorioDoDia,
        shifts: [{ ...relatorioDoDia.shifts[0], difference_cents: null }],
      }),
    ).toBeNull();
    expect(parseCashDayReport(null)).toBeNull();
    expect(parseCashDayReport({ ...relatorioDoDia, shifts: 'x' })).toBeNull();
  });

  it('diz quantos turnos em português', () => {
    expect(dayShiftsLabel(1)).toBe('1 turno');
    expect(dayShiftsLabel(3)).toBe('3 turnos');
  });

  it('email com os turnos, quem os fez, vendas e a diferença do dia', () => {
    const dia = parseCashDayReport(relatorioDoDia)!;
    const html = cashDayEmailHtml(dia, 'Maputo', 'Casa Teste');
    expect(html).toContain('Casa Teste Maputo — Fecho do Dia');
    expect(html).toContain('25/09/2026');
    expect(html).toContain('Ana');
    expect(html).toContain('Troco dado a mais');
    expect(html).toContain('M-Pesa');
    expect(html).toContain('Diferença do dia');
    expect(html).toContain('Fechado por: Bruno');
    expect(html).toContain('&lt;b&gt;Bruno&lt;/b&gt;');
    expect(html).not.toContain('<b>Bruno</b>');
    expect(html).not.toContain('undefined');
  });
});
