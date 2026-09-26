import { describe, expect, it } from 'vitest';

import {
  WIDTH,
  buildPrintDocument,
  mt,
  parseCashSold,
  twoColumns,
  type CashClosePayload,
  type CashSold,
  type Op,
} from '../index';

function texto(ops: Op[]): string {
  return ops
    .filter((op): op is Extract<Op, { t: 'text' }> => op.t === 'text')
    .map((op) => op.value)
    .join('');
}

/** O que a `close_cash_session` (1095) congela em `report.sold`. */
const sold: CashSold = {
  items: [
    { name: 'Classic Smash', variant: 'WAGYU', qty: 14, total_cents: 560_000 },
    { name: 'Batata Frita', variant: null, qty: 31, total_cents: 465_000 },
    { name: 'Água', variant: '300 ml', qty: 24, total_cents: 72_000 },
  ],
  items_total_cents: 1_097_000,
  delivery_fees_cents: 0,
  discounts_cents: 0,
};

const turno: CashClosePayload = {
  template: 'cash_close',
  store_short_name: 'Centro',
  shift_label: 'Turno 25/09/2026 14:19',
  opened_at: '2026-09-25T12:19:00Z',
  closed_at: '2026-09-26T09:59:00Z',
  opening_float_cents: 300_000,
  cash_sales_cents: 711_000,
  sangria_cents: 0,
  reforco_cents: 0,
  despesa_cents: 50_000,
  expected_cash_cents: 961_000,
  counted_cash_cents: 961_000,
  difference_cents: 0,
  difference_reason: null,
  payments: { cash: 711_000, mpesa: 200_000, emola: 186_000, credit_card: 0 },
  closed_by_name: 'Ana',
};

const comLista = { ...turno, sold } as CashClosePayload;

describe('artigos vendidos no talão do fecho', () => {
  it('o fecho de turno lista cada artigo com a quantidade e o valor', () => {
    const linhas = texto(buildPrintDocument('cash_close', comLista)).split('\n');
    expect(linhas).toContain('ARTIGOS VENDIDOS');
    expect(linhas).toContain(twoColumns('14x Classic Smash WAGYU', mt(560_000)));
    expect(linhas).toContain(twoColumns('31x Batata Frita', mt(465_000)));
    expect(linhas).toContain(twoColumns('24x Água 300 ml', mt(72_000)));
    expect(linhas).toContain(twoColumns('Total artigos', mt(1_097_000)));
  });

  it('a lista sai depois do dinheiro, antes de quem fechou', () => {
    const papel = texto(buildPrintDocument('cash_close', comLista));
    expect(papel.indexOf('PAGAMENTOS')).toBeLessThan(papel.indexOf('ARTIGOS VENDIDOS'));
    expect(papel.indexOf('ARTIGOS VENDIDOS')).toBeLessThan(papel.indexOf('Fechado por: Ana'));
  });

  it('taxas de entrega e descontos só aparecem quando existem', () => {
    const semExtras = texto(buildPrintDocument('cash_close', comLista));
    expect(semExtras).not.toContain('Taxas de entrega');
    expect(semExtras).not.toContain('Descontos');

    const comExtras = {
      ...turno,
      sold: { ...sold, delivery_fees_cents: 30_000, discounts_cents: 5_000 },
    } as CashClosePayload;
    const linhas = texto(buildPrintDocument('cash_close', comExtras)).split('\n');
    expect(linhas).toContain(twoColumns('Taxas de entrega', mt(30_000)));
    expect(linhas).toContain(twoColumns('Descontos', `-${mt(5_000)}`));
  });

  it('um nome comprido parte-se em linhas, sem cortar o valor', () => {
    const longo = {
      ...turno,
      sold: {
        ...sold,
        items: [{ name: 'Pizza Margherita Picante com Borda Recheada', variant: 'Familiar', qty: 12, total_cents: 1_234_500 }],
      },
    } as CashClosePayload;
    const papel = texto(buildPrintDocument('cash_close', longo));
    for (const linha of papel.split('\n')) expect(linha.length).toBeLessThanOrEqual(WIDTH);
    expect(papel).toContain('12x Pizza Margherita Picante');
    expect(papel).toContain('Familiar');
    expect(papel).toContain(mt(1_234_500));
  });

  it('turno sem vendas diz que não houve artigos', () => {
    const vazio = { ...turno, sold: { ...sold, items: [], items_total_cents: 0 } } as CashClosePayload;
    const papel = texto(buildPrintDocument('cash_close', vazio));
    expect(papel).toContain('ARTIGOS VENDIDOS');
    expect(papel).toContain('Nenhum artigo vendido');
  });

  it('sem lista (fecho anterior à 1095) o talão sai como antes', () => {
    expect(buildPrintDocument('cash_close', turno)).toEqual(
      buildPrintDocument('cash_close', { ...turno, sold: null } as CashClosePayload),
    );
    expect(texto(buildPrintDocument('cash_close', turno))).not.toContain('ARTIGOS VENDIDOS');
  });

  it('o fecho do dia também leva a lista', () => {
    const dia = {
      ...comLista,
      day: true,
      business_date: '2026-09-25',
      shifts_count: 1,
      first_opened_at: turno.opened_at,
      closing_cash_cents: 961_000,
      total_pedidos: 71,
      total_faturado_cents: 1_097_000,
      troco_inicial_cents: 0,
      shifts: [],
    } as unknown as CashClosePayload;
    const papel = texto(buildPrintDocument('cash_close', dia));
    expect(papel).toContain('FECHO DO DIA');
    expect(papel).toContain('ARTIGOS VENDIDOS');
    expect(papel.indexOf('DIFERENCA DO DIA')).toBeLessThan(papel.indexOf('ARTIGOS VENDIDOS'));
  });
});

describe('parseCashSold', () => {
  it('lê a lista que o servidor grava', () => {
    expect(parseCashSold(sold)).toEqual(sold);
  });

  it('dinheiro que não vem em centavos inteiros descarta a lista inteira', () => {
    expect(parseCashSold({ ...sold, items_total_cents: 10.5 })).toBeNull();
    expect(parseCashSold({ ...sold, items: [{ name: 'X', variant: null, qty: 1, total_cents: '100' }] })).toBeNull();
    expect(parseCashSold({ ...sold, items: [{ name: '', variant: null, qty: 1, total_cents: 100 }] })).toBeNull();
    expect(parseCashSold(null)).toBeNull();
    expect(parseCashSold('lista')).toBeNull();
  });
});
