import { describe, expect, it } from 'vitest';
import { buildAccountingCsv, type ExportRow } from '../accounting-export';

export const row: ExportRow = {
  store_name: 'PLACEHOLDER_LOJA', sale_date: '2026-09-24', sale_time: '14:05', order_number: 'TESTE-001', daily_number: 1,
  channel: 'counter', order_status: 'paid', customer_name: 'Cliente; "Teste"', customer_phone: '+258000000000',
  subtotal_cents: 43692, delivery_fee_cents: 0, order_total_cents: 43692,
  payment_method: 'cash', payment_amount_cents: 20000, payment_status: 'confirmed', payment_reference: null,
};

describe('ficheiros para contabilidade', () => {
  it('preserva centavos e escapa separadores, aspas e fórmulas em CSV UTF-8', () => {
    const csv = buildAccountingCsv([row], 'payments', 'excel');
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv).toContain('"Cliente; ""Teste"""');
    expect(csv).toContain('436,92');
    expect(csv).toContain("'+258000000000");
    expect(csv).toContain(';200,00;');
    expect(csv).toContain(';MZN');
    expect(csv).toContain('\r\n');
    expect(buildAccountingCsv([{ ...row, customer_name: ' =HYPERLINK("x")' }], 'payments', 'standard')).toContain("' =HYPERLINK");
  });
  it('uma venda com dois pagamentos aparece uma só vez no resumo', () => {
    const csv = buildAccountingCsv([row, { ...row, payment_method: 'mpesa', payment_amount_cents: 23692 }], 'orders', 'standard');
    expect(csv.split('\r\n').filter(Boolean)).toHaveLength(2);
    expect(csv).toContain(',436.92,436.92,0.00,');
    expect(csv).toContain('cash + mpesa');
  });
  it('devolução fica em coluna separada e não é inventada uma nota de crédito', () => {
    const csv = buildAccountingCsv([{ ...row, order_status: 'cancelled', payment_status: 'refunded', payment_amount_cents: 43692 }], 'orders', 'standard');
    expect(csv).toContain(',cancelled,');
    expect(csv).toContain(',436.92,0.00,436.92,');
    expect(csv).not.toContain('NC');
  });
  it('recusa dinheiro fraccionário ou dados incoerentes em vez de exportar totais falsos', () => {
    expect(() => buildAccountingCsv([{ ...row, payment_amount_cents: 1.5 }], 'payments', 'standard')).toThrow();
    expect(() => buildAccountingCsv([row, { ...row, order_total_cents: 1 }], 'orders', 'standard')).toThrow();
  });
  it('gera cabeçalhos mesmo sem vendas e preserva pagamentos idênticos distintos', () => {
    expect(buildAccountingCsv([], 'orders', 'standard')).toContain('total_pedido_mt');
    expect(buildAccountingCsv([row, row], 'payments', 'standard').split('\r\n').filter(Boolean)).toHaveLength(3);
  });
});
