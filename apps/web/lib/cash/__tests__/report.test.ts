import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';

import { buildCashClosePdf, cashCloseEmailHtml, type CashCloseReport } from '../report';

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
    const bytes = await buildCashClosePdf(report);
    expect(Buffer.from(bytes).subarray(0, 5).toString()).toBe('%PDF-');
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBe(1);
    expect(pdf.getTitle()).toContain('Fecho de Caixa');
  });

  it('gera email com loja, valores da gaveta, digitais e motivo', () => {
    const html = cashCloseEmailHtml(report);
    expect(html).toContain('HAWSMASH Maputo');
    expect(html).toContain('Esperado na gaveta');
    expect(html).toContain('M-Pesa');
    expect(html).toContain('Falta confirmada na contagem');
    expect(html).not.toContain('undefined');
  });
});
