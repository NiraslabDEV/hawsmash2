/**
 * F4.4 — Testa a lógica de cálculo do funil de conversão.
 * Replica a lógica da view SQL funnel_rates em TS puro
 * para validar que os cálculos estão corretos com seed conhecido.
 */
import { describe, it, expect } from 'vitest';

interface AnalyticsEvent {
  session_id: string;
  type: string;
  value_cents?: number;
}

interface FunnelRates {
  total_sessions: number;
  step_menu: number;
  step_checkout: number;
  step_payment: number;
  step_purchase: number;
  pct_menu_to_checkout: number | null;
  pct_checkout_to_payment: number | null;
  pct_payment_to_purchase: number | null;
  pct_overall: number | null;
}

/** Replica exacta da view SQL funnel_rates (GROUP BY session_id + bool_or). */
function computeFunnel(events: AnalyticsEvent[]): FunnelRates {
  const sessions = new Map<string, { saw_menu: boolean; began_checkout: boolean; added_payment: boolean; purchased: boolean }>();

  for (const e of events) {
    const s = sessions.get(e.session_id) ?? { saw_menu: false, began_checkout: false, added_payment: false, purchased: false };
    if (e.type === 'view_menu')        s.saw_menu        = true;
    if (e.type === 'begin_checkout')   s.began_checkout  = true;
    if (e.type === 'add_payment_info') s.added_payment   = true;
    if (e.type === 'purchase')         s.purchased       = true;
    sessions.set(e.session_id, s);
  }

  const vals = [...sessions.values()];
  const total    = vals.length;
  const menu     = vals.filter((s) => s.saw_menu).length;
  const checkout = vals.filter((s) => s.began_checkout).length;
  const payment  = vals.filter((s) => s.added_payment).length;
  const purchase = vals.filter((s) => s.purchased).length;

  const pct = (a: number, b: number) => b === 0 ? null : Math.round((a / b) * 1000) / 10;

  return {
    total_sessions: total,
    step_menu: menu,
    step_checkout: checkout,
    step_payment: payment,
    step_purchase: purchase,
    pct_menu_to_checkout:    pct(checkout, menu),
    pct_checkout_to_payment: pct(payment, checkout),
    pct_payment_to_purchase: pct(purchase, payment),
    pct_overall:             pct(purchase, menu),
  };
}

// ── seed conhecido ───────────────────────────────────────────────────────────
// 4 sessões distintas com o funil completo ou parcial:
//   sess-A: percorre funil inteiro (menu → checkout → payment → purchase)
//   sess-B: chega ao checkout mas não ao pagamento
//   sess-C: apenas view_menu
//   sess-D: percorre funil inteiro (outro cliente)
const SEED: AnalyticsEvent[] = [
  { session_id: 'sess-A', type: 'view_menu' },
  { session_id: 'sess-A', type: 'begin_checkout' },
  { session_id: 'sess-A', type: 'add_payment_info' },
  { session_id: 'sess-A', type: 'purchase', value_cents: 45000 },

  { session_id: 'sess-B', type: 'view_menu' },
  { session_id: 'sess-B', type: 'begin_checkout' },

  { session_id: 'sess-C', type: 'view_menu' },

  { session_id: 'sess-D', type: 'view_menu' },
  { session_id: 'sess-D', type: 'begin_checkout' },
  { session_id: 'sess-D', type: 'add_payment_info' },
  { session_id: 'sess-D', type: 'purchase', value_cents: 65000 },
];

describe('computeFunnel — seed conhecido', () => {
  const r = computeFunnel(SEED);

  it('total_sessions = 4 (sessões únicas)', () => {
    expect(r.total_sessions).toBe(4);
  });

  it('step_menu = 4 (todas viram o menu)', () => {
    expect(r.step_menu).toBe(4);
  });

  it('step_checkout = 3 (A, B, D chegaram ao checkout)', () => {
    expect(r.step_checkout).toBe(3);
  });

  it('step_payment = 2 (A e D adicionaram pagamento)', () => {
    expect(r.step_payment).toBe(2);
  });

  it('step_purchase = 2 (A e D compraram)', () => {
    expect(r.step_purchase).toBe(2);
  });

  it('pct_menu_to_checkout = 75% (3/4)', () => {
    expect(r.pct_menu_to_checkout).toBe(75);
  });

  it('pct_checkout_to_payment ≈ 66.7% (2/3)', () => {
    expect(r.pct_checkout_to_payment).toBeCloseTo(66.7, 0);
  });

  it('pct_payment_to_purchase = 100% (2/2)', () => {
    expect(r.pct_payment_to_purchase).toBe(100);
  });

  it('pct_overall = 50% (2/4)', () => {
    expect(r.pct_overall).toBe(50);
  });
});

describe('computeFunnel — edge cases', () => {
  it('sem eventos → tudo 0, percentagens null', () => {
    const r = computeFunnel([]);
    expect(r.total_sessions).toBe(0);
    expect(r.step_menu).toBe(0);
    expect(r.pct_menu_to_checkout).toBeNull();
    expect(r.pct_overall).toBeNull();
  });

  it('sessão com view_menu repetido conta só uma vez', () => {
    const r = computeFunnel([
      { session_id: 'x', type: 'view_menu' },
      { session_id: 'x', type: 'view_menu' },
    ]);
    expect(r.step_menu).toBe(1);
    expect(r.total_sessions).toBe(1);
  });

  it('compra sem view_menu contabiliza purchase mas não menu', () => {
    const r = computeFunnel([
      { session_id: 'ghost', type: 'purchase', value_cents: 1000 },
    ]);
    expect(r.step_purchase).toBe(1);
    expect(r.step_menu).toBe(0);
    // pct_overall = compras/menu → null (divisão por 0)
    expect(r.pct_overall).toBeNull();
  });
});
