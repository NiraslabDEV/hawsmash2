import { describe, expect, it } from 'vitest';

import {
  lastClosedMonth,
  monthLabel,
  monthlyEmailHtml,
  monthlySubject,
  parseMonthParam,
  percentChange,
  reportRecipients,
  reviewsGained,
  type GoogleSection,
  type MonthlyDigest,
  type MonthlyStore,
} from '../monthly';

const store = (overrides: Partial<MonthlyStore> = {}): MonthlyStore => ({
  store_id: 'maputo-id',
  store_name: 'Maputo',
  owner_email: null,
  google_place_id: 'ChIJ-exemplo-maputo',
  orders_count: 255,
  revenue_cents: 32_600_000,
  previous_orders_count: 284,
  previous_revenue_cents: 37_171_000,
  cancelled_count: 3,
  channels: {
    delivery: { orders: 200, revenue_cents: 26_000_000 },
    counter: { orders: 55, revenue_cents: 6_600_000 },
  },
  payments: { mpesa: 20_000_000, cash: 12_600_000 },
  top_items: [
    { name: 'Classic Smash', variant: 'WAGYU', qty: 120, total_cents: 4_800_000 },
    { name: 'Nata', variant: null, qty: 40, total_cents: 360_000 },
  ],
  google_snapshot: null,
  google_previous: null,
  ...overrides,
});

const digest = (stores: MonthlyStore[]): MonthlyDigest => ({
  month: '2026-09-01',
  previous_month: '2026-08-01',
  stores,
});

describe('mês do resumo', () => {
  it('escreve o mês por extenso, sem passar por um Date', () => {
    expect(monthLabel('2026-09-01')).toBe('Setembro de 2026');
    expect(monthLabel('2027-01-01')).toBe('Janeiro de 2027');
  });

  it('aceita ?month=AAAA-MM e recusa o resto', () => {
    expect(parseMonthParam(null)).toEqual({ ok: true, month: null });
    expect(parseMonthParam('2026-09')).toEqual({ ok: true, month: '2026-09-01' });
    expect(parseMonthParam('2026-13')).toEqual({ ok: false });
    expect(parseMonthParam('2026-9')).toEqual({ ok: false });
    expect(parseMonthParam("2026-09'; drop")).toEqual({ ok: false });
  });

  it('o último mês fechado conta no fuso de Maputo, não em UTC', () => {
    // 22h30 UTC de 30 Set já é 1 de Outubro em Maputo: Setembro fechou.
    expect(lastClosedMonth(new Date('2026-09-30T22:30:00Z'))).toBe('2026-09-01');
    // 21h59 UTC de 30 Set ainda é 30 Set em Maputo: o último fechado é Agosto.
    expect(lastClosedMonth(new Date('2026-09-30T21:59:00Z'))).toBe('2026-08-01');
    // Em Janeiro, o último fechado é Dezembro do ano anterior.
    expect(lastClosedMonth(new Date('2027-01-01T06:00:00Z'))).toBe('2026-12-01');
  });
});

describe('comparações', () => {
  it('sem base de comparação não inventa percentagem', () => {
    expect(percentChange(100, 0)).toBeNull();
    expect(percentChange(112, 100)).toBe(12);
    expect(percentChange(32_600_000, 37_171_000)).toBe(-12);
  });

  it('avaliações do mês são a diferença entre duas fotografias seguidas', () => {
    const ok: GoogleSection = {
      status: 'ok',
      rating: 4.7,
      reviewCount: 312,
      previous: { rating: 4.6, review_count: 294, captured_at: '2026-09-01T06:00:00Z' },
      mapsUri: null,
    };
    expect(reviewsGained(ok)).toBe(18);
    expect(reviewsGained({ ...ok, previous: null })).toBeNull();
    expect(reviewsGained({ status: 'no_key' })).toBeNull();
  });

  it('manda para o email da casa e o de cada loja, sem repetir', () => {
    expect(
      reportRecipients('haw@exemplo.co.mz', [
        { owner_email: 'haw@exemplo.co.mz' },
        { owner_email: 'matola@exemplo.co.mz' },
        { owner_email: 'sem-arroba' },
        { owner_email: null },
      ]),
    ).toEqual(['haw@exemplo.co.mz', 'matola@exemplo.co.mz']);
  });
});

describe('email do resumo', () => {
  it('assunto com a marca e o mês', () => {
    expect(monthlySubject('Marca', '2026-09-01')).toBe('Marca · resumo de Setembro de 2026');
  });

  it('mostra vendas, comparação com o mês anterior e os mais vendidos', () => {
    const html = monthlyEmailHtml({
      brandName: 'Marca',
      digest: digest([store()]),
      google: { 'maputo-id': { status: 'no_place_id' } },
    });
    expect(html).toContain('Setembro de 2026');
    expect(html).toContain('facturado');
    expect(html).toContain('↓ 12% face a Agosto');
    expect(html).toContain('(Agosto: 284)');
    expect(html).toContain('3 anulado(s)');
    expect(html).toContain('Classic Smash WAGYU');
    expect(html).toContain('120×');
    expect(html).toContain('Entrega 200');
    expect(html).toContain('M-Pesa');
  });

  it('o Google diz a nota, as avaliações e o que entrou no mês', () => {
    const html = monthlyEmailHtml({
      brandName: 'Marca',
      digest: digest([store()]),
      google: {
        'maputo-id': {
          status: 'ok',
          rating: 4.7,
          reviewCount: 312,
          previous: { rating: 4.6, review_count: 294, captured_at: '2026-09-01T06:00:00Z' },
          mapsUri: 'https://maps.google.com/?cid=1',
        },
      },
    });
    expect(html).toContain('4,7');
    expect(html).toContain('312 avaliações');
    expect(html).toContain('+18 este mês');
    expect(html).toContain('nota era 4,6');
    expect(html).toContain('ver perfil');
  });

  it('na primeira leitura diz que ainda não há variação, em vez de inventar uma', () => {
    const html = monthlyEmailHtml({
      brandName: 'Marca',
      digest: digest([store()]),
      google: {
        'maputo-id': { status: 'ok', rating: 4.7, reviewCount: 312, previous: null, mapsUri: null },
      },
    });
    expect(html).toContain('primeira leitura');
    expect(html).not.toContain('este mês');
  });

  it('sem Google, diz porquê — e o resto do resumo sai na mesma', () => {
    for (const [status, text] of [
      ['no_place_id', 'falta o Place ID'],
      ['no_key', 'falta a chave'],
      ['failed', 'não respondeu'],
      ['not_captured', 'sem leitura guardada'],
    ] as const) {
      const html = monthlyEmailHtml({
        brandName: 'Marca',
        digest: digest([store()]),
        google: { 'maputo-id': { status } },
      });
      expect(html).toContain(text);
      expect(html).toContain('facturado');
    }
  });

  it('com duas lojas mostra o total das duas', () => {
    const html = monthlyEmailHtml({
      brandName: 'Marca',
      digest: digest([
        store(),
        store({ store_id: 'matola-id', store_name: 'Matola', orders_count: 45, revenue_cents: 5_400_000 }),
      ]),
      google: {},
    });
    expect(html).toContain('As 2 lojas');
    expect(html).toContain('300 pedidos');
  });

  it('escapa o que vem da base de dados', () => {
    const html = monthlyEmailHtml({
      brandName: '<b>Marca</b>',
      digest: digest([
        store({
          store_name: '<script>x</script>',
          top_items: [{ name: 'Smash <img>', variant: null, qty: 1, total_cents: 100 }],
        }),
      ]),
      google: {},
    });
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img>');
    expect(html).not.toContain('<b>Marca</b>');
    expect(html).toContain('&lt;script&gt;');
  });
});
