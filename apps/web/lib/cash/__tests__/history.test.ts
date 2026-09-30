import { describe, expect, it } from 'vitest';

import {
  dayHeading,
  duration,
  groupByDay,
  maputoDay,
  parseDayCloseRow,
  parseShiftReport,
  parseShiftRow,
  paymentShares,
  shiftPeople,
} from '../history';
import { parseCashDayReport } from '../day';

/** O que a `close_cash_session` (1095) grava em `cash_sessions.report`. */
const relatorioDoTurno = {
  total_pedidos: 14,
  total_faturado_cents: 1_627_000,
  payments: { cash: 56_000, mpesa: 360_000, emola: 798_000, credit_card: 413_000 },
  cash_sales_cents: 56_000,
  sangria_cents: 0,
  reforco_cents: 0,
  despesa_cents: 0,
  troco_inicial_cents: 300_000,
  sold: {
    items: [
      { name: 'Batata Frita', variant: null, qty: 7, total_cents: 105_000 },
      { name: 'Classic Smash', variant: 'HAW', qty: 7, total_cents: 210_000 },
    ],
    items_total_cents: 1_522_000,
    delivery_fees_cents: 105_000,
    discounts_cents: 0,
  },
};

const linhaDoTurno = {
  id: 's1',
  store_id: 'loja-maputo',
  shift_label: 'Turno 29/09/2026 10:43',
  opened_at: '2026-09-29T08:43:00Z',
  closed_at: '2026-09-29T19:23:00Z',
  opening_float_cents: 0,
  expected_cash_cents: 356_000,
  counted_cash_cents: 356_000,
  difference_cents: 0,
  difference_reason: null,
  day_close_id: null,
  report: relatorioDoTurno,
};

const relatorioDoDia = {
  day_close_id: 'd1',
  business_date: '2026-09-28',
  shifts_count: 1,
  first_opened_at: '2026-09-28T08:00:00Z',
  last_shift_closed_at: '2026-09-28T19:00:00Z',
  closed_at: '2026-09-28T19:05:00Z',
  closed_by_name: 'Ana',
  opening_float_cents: 0,
  closing_cash_cents: 100_000,
  total_pedidos: 10,
  total_faturado_cents: 500_000,
  payments: { cash: 100_000, mpesa: 400_000, emola: 0, credit_card: 0 },
  cash_sales_cents: 100_000,
  sangria_cents: 0,
  reforco_cents: 0,
  despesa_cents: 0,
  troco_inicial_cents: 0,
  difference_cents: 0,
  shifts: [
    {
      session_id: 's0',
      shift_label: 'Turno 28/09/2026 10:00',
      opened_at: '2026-09-28T08:00:00Z',
      closed_at: '2026-09-28T19:00:00Z',
      opened_by_name: 'Ana',
      closed_by_name: 'Bruna',
      opening_float_cents: 0,
      expected_cash_cents: 100_000,
      counted_cash_cents: 100_000,
      difference_cents: 0,
      difference_reason: null,
      total_pedidos: 10,
      total_faturado_cents: 500_000,
    },
  ],
};

describe('parseShiftReport', () => {
  it('lê o relatório completo de um turno, com os artigos', () => {
    const report = parseShiftReport(relatorioDoTurno);
    expect(report.total_faturado_cents).toBe(1_627_000);
    expect(report.payments).toEqual({ cash: 56_000, mpesa: 360_000, emola: 798_000, credit_card: 413_000 });
    expect(report.troco_inicial_cents).toBe(300_000);
    expect(report.sold?.items).toHaveLength(2);
  });

  it('um turno do motor herdado sem chaves fica a zero, sem rebentar', () => {
    const report = parseShiftReport({ total_pedidos: 3 });
    expect(report.total_pedidos).toBe(3);
    expect(report.total_faturado_cents).toBeNull();
    expect(report.payments).toBeNull();
    expect(report.sangria_cents).toBe(0);
    expect(report.sold).toBeNull();
  });

  it('dinheiro em float não passa por centavos', () => {
    const report = parseShiftReport({ ...relatorioDoTurno, total_faturado_cents: 16.5, payments: { ...relatorioDoTurno.payments, cash: 0.5 } });
    expect(report.total_faturado_cents).toBeNull();
    expect(report.payments).toBeNull();
  });

  it('lixo no lugar do relatório dá um relatório vazio', () => {
    expect(parseShiftReport(null).payments).toBeNull();
    expect(parseShiftReport([1, 2]).cash_sales_cents).toBe(0);
  });
});

describe('parseShiftRow e parseDayCloseRow', () => {
  it('lê a linha de cash_sessions', () => {
    const row = parseShiftRow(linhaDoTurno);
    expect(row.id).toBe('s1');
    expect(row.expected_cash_cents).toBe(356_000);
    expect(row.day_close_id).toBeNull();
    expect(row.report.sold?.delivery_fees_cents).toBe(105_000);
  });

  it('marca os fechos do dia reconstruídos (backfill)', () => {
    const day = parseDayCloseRow({
      id: 'd1',
      store_id: 'loja-maputo',
      business_date: '2026-09-28',
      closed_at: '2026-09-28T19:05:00Z',
      report: { ...relatorioDoDia, backfill: true },
    });
    expect(day.backfill).toBe(true);
    expect(day.report?.total_faturado_cents).toBe(500_000);
  });

  it('um relatório do dia estragado fica null, a linha aparece na mesma', () => {
    const day = parseDayCloseRow({ id: 'd2', store_id: 'x', business_date: '2026-09-27', closed_at: '2026-09-27T20:00:00Z', report: { total: 'muito' } });
    expect(day.report).toBeNull();
    expect(day.backfill).toBe(false);
  });
});

describe('shiftPeople', () => {
  it('junta quem abriu e fechou, dos fechos do dia e do dia por fechar', () => {
    const fechado = parseCashDayReport(relatorioDoDia);
    const pendente = parseCashDayReport({
      ...relatorioDoDia,
      day_close_id: null,
      shifts: [{ ...relatorioDoDia.shifts[0], session_id: 's1', opened_by_name: 'Carla', closed_by_name: 'Carla' }],
    });
    const people = shiftPeople([fechado, pendente, null]);
    expect(people.get('s0')).toEqual({ opened: 'Ana', closed: 'Bruna' });
    expect(people.get('s1')).toEqual({ opened: 'Carla', closed: 'Carla' });
    expect(people.size).toBe(2);
  });
});

describe('datas de Maputo', () => {
  it('o dia é o de Maputo, não o de UTC', () => {
    // 23:30 UTC do dia 28 já é dia 29 em Maputo (UTC+2).
    expect(maputoDay('2026-09-28T23:30:00Z')).toBe('2026-09-29');
  });

  it('Hoje, Ontem e depois o dia da semana', () => {
    const agora = new Date('2026-09-29T12:00:00Z');
    expect(dayHeading('2026-09-29', agora)).toBe('Hoje');
    expect(dayHeading('2026-09-28', agora)).toBe('Ontem');
    expect(dayHeading('2026-09-26', agora)).toMatch(/26\/09/);
  });

  it('a duração do turno', () => {
    expect(duration('2026-09-29T08:43:00Z', '2026-09-29T19:23:00Z')).toBe('10h40');
    expect(duration('2026-09-29T08:00:00Z', '2026-09-29T08:45:00Z')).toBe('45 min');
  });
});

describe('groupByDay', () => {
  it('agrupa seguidos do mesmo dia e mantém a ordem', () => {
    const groups = groupByDay(['29a', '29b', '28a', '29c'], (item) => item.slice(0, 2));
    expect(groups.map((group) => [group.day, group.items])).toEqual([
      ['29', ['29a', '29b']],
      ['28', ['28a']],
      ['29', ['29c']],
    ]);
  });
});

describe('paymentShares', () => {
  it('a parte de cada meio em % inteiros', () => {
    expect(paymentShares(relatorioDoTurno.payments)).toEqual({ cash: 3, mpesa: 22, emola: 49, credit_card: 25 });
  });

  it('sem vendas, tudo a zero', () => {
    expect(paymentShares({ cash: 0, mpesa: 0, emola: 0, credit_card: 0 })).toEqual({ cash: 0, mpesa: 0, emola: 0, credit_card: 0 });
  });
});
