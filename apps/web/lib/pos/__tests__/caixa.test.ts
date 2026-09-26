import { describe, expect, it } from 'vitest';
import {
  CASH_MAX_CENTS,
  cashErrorMessage,
  movementReady,
  openTablesNotice,
  parseCashDay,
  parseCashStore,
  pressCashKey,
} from '../caixa';

describe('teclado do caixa', () => {
  it('escreve meticais inteiros pela ordem em que se tocam', () => {
    let cents = 0;
    for (const key of ['1', '5', '0', '0']) cents = pressCashKey(cents, key);
    expect(cents).toBe(150_000);
  });

  it('o zero à esquerda não conta e o C limpa', () => {
    expect(pressCashKey(0, '0')).toBe(0);
    expect(pressCashKey(150_000, 'C')).toBe(0);
  });

  it('o ⌫ tira o último algarismo dos meticais', () => {
    expect(pressCashKey(150_000, '⌫')).toBe(15_000);
    expect(pressCashKey(500, '⌫')).toBe(0);
  });

  it('não passa do limite nem aceita outras teclas', () => {
    expect(pressCashKey(CASH_MAX_CENTS, '9')).toBe(CASH_MAX_CENTS);
    expect(pressCashKey(1_000, ',')).toBe(1_000);
    expect(pressCashKey(1_000, 'a')).toBe(1_000);
  });
});

const store = {
  store_id: 'maputo-id',
  store_name: 'Maputo',
  has_open_session: true,
  open_session: {
    id: 'sessao-1',
    shift_label: 'Turno 24/09/2026 11:00',
    opened_at: '2026-09-24T09:00:00Z',
    opening_float_cents: 100_000,
  },
  total_pedidos: 12,
  total_faturado_cents: 480_000,
  cash_sales_cents: 300_000,
  mpesa_cents: 120_000,
  emola_cents: 60_000,
  credit_card_cents: 0,
  sangria_cents: 50_000,
  reforco_cents: 0,
  despesa_cents: 10_000,
  troco_inicial_cents: 0,
  expected_cash_cents: 340_000,
  movements: [
    { id: 'm1', type: 'sangria', amount_cents: 50_000, reason: 'Cofre', created_at: '2026-09-24T12:00:00Z' },
  ],
  history: [],
};

describe('leitura do caixa da loja', () => {
  it('escolhe a loja do terminal no painel devolvido pelo servidor', () => {
    const outra = { ...store, store_id: 'matola-id', store_name: 'Matola' };
    const lido = parseCashStore({ stores: [outra, store] }, 'maputo-id');
    expect(lido?.store_name).toBe('Maputo');
    expect(lido?.expected_cash_cents).toBe(340_000);
    expect(lido?.movements).toHaveLength(1);
  });

  it('nunca mostra o caixa de outra loja', () => {
    expect(parseCashStore({ stores: [store] }, 'matola-id')).toBeNull();
    expect(parseCashStore(null, 'maputo-id')).toBeNull();
    expect(parseCashStore({ stores: 'x' }, 'maputo-id')).toBeNull();
  });

  it('um valor de dinheiro que não é inteiro invalida a leitura', () => {
    expect(parseCashStore({ stores: [{ ...store, expected_cash_cents: 3400.5 }] }, 'maputo-id')).toBeNull();
    expect(parseCashStore({ stores: [{ ...store, cash_sales_cents: '300000' }] }, 'maputo-id')).toBeNull();
  });

  it('turno fechado: sem sessão aberta', () => {
    const fechado = { ...store, has_open_session: false, open_session: null };
    const lido = parseCashStore({ stores: [fechado] }, 'maputo-id');
    expect(lido?.open_session).toBeNull();
    expect(lido?.has_open_session).toBe(false);
  });
});

describe('movimento de caixa', () => {
  it('exige valor positivo e motivo com pelo menos 3 letras', () => {
    expect(movementReady(0, 'Cofre')).toBe(false);
    expect(movementReady(50_000, '  ab ')).toBe(false);
    expect(movementReady(50_000, 'Gás')).toBe(true);
  });
});

describe('mesas por fechar no fecho', () => {
  function mesa(number: number, totals: number[]) {
    return {
      id: `mesa-${number}`,
      number,
      active: true,
      orders: totals.map((total_cents, index) => ({ id: `p-${number}-${index}`, total_cents })),
    };
  }

  it('sem contas abertas não há aviso', () => {
    expect(openTablesNotice({ tables: [mesa(1, []), mesa(2, [])] })).toBeNull();
  });

  it('diz que mesas têm conta aberta e quanto falta cobrar', () => {
    const aviso = openTablesNotice({ tables: [mesa(1, []), mesa(2, [30_000, 15_000]), mesa(5, [60_000])] });
    expect(aviso).toEqual({ numbers: [2, 5], totalCents: 105_000 });
  });

  it('sem a lista de mesas (loja sem mesas, RPC por aplicar) não há aviso', () => {
    expect(openTablesNotice(null)).toBeNull();
    expect(openTablesNotice({ tables: 'x' })).toBeNull();
  });
});

describe('fecho do dia no POS', () => {
  const pendente = {
    business_date: '2026-09-25',
    shifts_count: 1,
    first_opened_at: '2026-09-25T09:00:00Z',
    last_shift_closed_at: '2026-09-25T19:00:00Z',
    opening_float_cents: 0,
    closing_cash_cents: 50_000,
    total_pedidos: 3,
    total_faturado_cents: 90_000,
    payments: { cash: 50_000, mpesa: 40_000, emola: 0, credit_card: 0 },
    cash_sales_cents: 50_000,
    sangria_cents: 0,
    reforco_cents: 0,
    despesa_cents: 0,
    troco_inicial_cents: 0,
    difference_cents: 0,
    shifts: [
      {
        session_id: 's1',
        shift_label: 'Turno 25/09/2026 11:00',
        opened_at: '2026-09-25T09:00:00Z',
        closed_at: '2026-09-25T19:00:00Z',
        opened_by_name: 'Ana',
        closed_by_name: 'Ana',
        opening_float_cents: 0,
        expected_cash_cents: 50_000,
        counted_cash_cents: 50_000,
        difference_cents: 0,
        difference_reason: null,
        total_pedidos: 3,
        total_faturado_cents: 90_000,
      },
    ],
  };

  it('lê os turnos por fechar, o turno aberto e o último fecho do dia', () => {
    const dia = parseCashDay({
      open_session: null,
      pending: pendente,
      last_day_close: { id: 'd0', business_date: '2026-09-24', closed_at: '2026-09-24T20:00:00Z' },
    });
    expect(dia?.pending?.shifts_count).toBe(1);
    expect(dia?.hasOpenSession).toBe(false);
    expect(dia?.lastDayClose?.business_date).toBe('2026-09-24');
  });

  it('sem turnos por fechar, nada pendente; com turno aberto, diz que está aberto', () => {
    const dia = parseCashDay({ open_session: { id: 'x' }, pending: null, last_day_close: null });
    expect(dia?.pending).toBeNull();
    expect(dia?.hasOpenSession).toBe(true);
    expect(dia?.lastDayClose).toBeNull();
  });

  it('um resumo do dia mal formado não se mostra como se fosse certo', () => {
    expect(parseCashDay(null)).toBeNull();
    expect(parseCashDay({ open_session: null, pending: { ...pendente, total_faturado_cents: 1.5 } })).toBeNull();
  });
});

describe('mensagens do caixa', () => {
  it('traduz as recusas do servidor para o balcão', () => {
    expect(cashErrorMessage('difference_reason_required')).toMatch(/motivo/i);
    expect(cashErrorMessage('session_already_open')).toMatch(/já está aberto/i);
    expect(cashErrorMessage('no_open_session')).toMatch(/não há caixa aberto/i);
    expect(cashErrorMessage('cash_access_denied')).toMatch(/perfil/i);
    expect(cashErrorMessage('store_access_denied')).toMatch(/loja/i);
    expect(cashErrorMessage('Failed to fetch')).toMatch(/ligação/i);
    expect(cashErrorMessage('session_open')).toMatch(/fecha primeiro o turno/i);
    expect(cashErrorMessage('no_shifts_to_close')).toMatch(/não há turnos/i);
    expect(cashErrorMessage('Could not find the function public.close_cash_day(p_request_id, p_store)')).toMatch(
      /ainda não está disponível/i,
    );
  });
});
