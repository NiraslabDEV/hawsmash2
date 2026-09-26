import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';

import { buildCashClosePdf, cashCloseEmailHtml, cashCloseReportFromSession, type CashCloseReport } from '../report';

const report: CashCloseReport = {
  session_id: '00000000-0000-4000-8000-000000000501',
  store_id: '00000000-0000-4000-8000-000000000101',
  store_short_name: 'Maputo',
  shift_label: 'Turno 19/08/2026 18:00',
  opened_at: '2026-08-19T16:00:00.000Z',
  closed_at: '2026-08-19T19:30:00.000Z',
  opening_float_cents: 5000,
  cash_sales_cents: 30000,
  sangria_cents: 5000,
  reforco_cents: 2000,
  despesa_cents: 1000,
  expected_cash_cents: 31000,
  counted_cash_cents: 30000,
  difference_cents: -1000,
  difference_reason: 'Falta confirmada na contagem',
  total_pedidos: 2,
  total_faturado_cents: 60000,
  payments: { cash: 30000, mpesa: 20000, emola: 0, credit_card: 10000 },
  closed_by_name: 'Gerente Maputo',
};

describe('relatório de fecho de caixa', () => {
  it('gera um PDF real e válido com uma página', async () => {
    const bytes = await buildCashClosePdf(report, 'Casa Teste');
    expect(Buffer.from(bytes).subarray(0, 5).toString()).toBe('%PDF-');
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBe(1);
    expect(pdf.getTitle()).toContain('Fecho de Caixa');
  });

  it('gera email com loja, valores da gaveta, digitais e motivo', () => {
    const html = cashCloseEmailHtml(report, 'Casa Teste');
    expect(html).toContain('Casa Teste Maputo');
    expect(html).toContain('Esperado na gaveta');
    expect(html).toContain('M-Pesa');
    expect(html).toContain('Falta confirmada na contagem');
    expect(html).not.toContain('undefined');
  });

  it('o email lista os artigos vendidos, com quantidade e valor', () => {
    const html = cashCloseEmailHtml(
      {
        ...report,
        sold: {
          items: [
            { name: 'Classic Smash', variant: 'WAGYU', qty: 14, total_cents: 560000 },
            { name: 'Pizza <Cheese> & Macon', variant: null, qty: 4, total_cents: 240000 },
          ],
          items_total_cents: 800000,
          delivery_fees_cents: 30000,
          discounts_cents: 0,
        },
      },
      'Casa Teste',
    );
    expect(html).toContain('Artigos vendidos');
    expect(html).toContain('14× Classic Smash WAGYU');
    expect(html).toContain('4× Pizza &lt;Cheese&gt; &amp; Macon');
    expect(html).not.toContain('<Cheese>');
    expect(html).toContain('Total artigos');
    expect(html).toContain('Taxas de entrega');
    expect(html).not.toContain('Descontos');
  });

  it('sem lista (fecho anterior à 1095) o email sai como antes', () => {
    expect(cashCloseEmailHtml(report, 'Casa Teste')).not.toContain('Artigos vendidos');
    expect(cashCloseEmailHtml({ ...report, sold: null }, 'Casa Teste')).toBe(cashCloseEmailHtml(report, 'Casa Teste'));
  });

  it('lê a lista que o fecho congelou no report da sessão', () => {
    const sold = {
      items: [{ name: 'Batata Frita', variant: null, qty: 31, total_cents: 465000 }],
      items_total_cents: 465000,
      delivery_fees_cents: 0,
      discounts_cents: 0,
    };
    const row = {
      id: report.session_id,
      store_id: report.store_id,
      shift_label: report.shift_label,
      opened_at: report.opened_at,
      closed_at: report.closed_at,
      opening_float_cents: 5000,
      counted_cash_cents: 30000,
      difference_cents: -1000,
      difference_reason: null,
      report: { sold },
    };
    expect(cashCloseReportFromSession(row, 'Maputo').sold).toEqual(sold);
    expect(cashCloseReportFromSession({ ...row, report: { sold: { items: 'x' } } }, 'Maputo').sold).toBeNull();
    expect(cashCloseReportFromSession({ ...row, report: {} }, 'Maputo').sold).toBeNull();
  });
});
