import { describe, expect, it } from 'vitest';

import { buildFullTicket, renderPreview, type KitchenTicketPayload } from '../index';

/**
 * O talão diz de onde veio cada abatimento (1113). Com um total mais baixo que
 * a soma e só "Desconto:" ao lado, ao balcão isso virava discussão com o
 * cliente e suspeita sobre a caixa.
 */
const base: KitchenTicketPayload = {
  template: 'kitchen',
  formato: 'talao_completo',
  store_short_name: 'Loja',
  order_number: 'TST-0001',
  daily_number: 1,
  channel: 'counter',
  fulfillment_type: 'pickup',
  customer_name: 'Cliente',
  items: [{ name: 'Classic', quantity: 2, line_total_cents: 90000 }],
  subtotal_cents: 90000,
  delivery_fee_cents: 0,
  discount_cents: 0,
  total_cents: 90000,
  payment_method: 'cash',
  created_at: '2026-09-30T13:00:00.000Z',
};

const texto = (p: KitchenTicketPayload) =>
  renderPreview(buildFullTicket(p))
    .map((l) => ('spans' in l ? l.spans.map((s) => s.text).join('') : ''))
    .join('\n');

describe('linhas de promoção no talão', () => {
  it('sem promoção, nada muda', () => {
    const t = texto(base);
    expect(t).not.toMatch(/Desconto|2x1|Cupão/);
  });

  it('bridge/BD antiga (só discount_cents): continua a linha única "Desconto:"', () => {
    const t = texto({ ...base, discount_cents: 9000, total_cents: 81000 });
    expect(t).toContain('Desconto:');
  });

  it('com a origem, uma linha por cada abatimento e sem a linha genérica', () => {
    const t = texto({
      ...base,
      discount_cents: 55500,
      total_cents: 34500,
      bogo_discount_cents: 45000,
      bogo_free_item: 'Classic',
      coupon_code: 'AMIGO10',
      coupon_discount_cents: 5000,
      manual_discount_cents: 5500,
      discount_reason: 'Cliente habitual',
    });
    expect(t).toContain('2x1');
    expect(t).toContain('Classic GRÁTIS');
    expect(t).toContain('Cupão AMIGO10');
    expect(t).toContain('Desconto gerente');
    expect(t).toContain('Cliente habitual');
    expect(t).not.toContain('Desconto:');
  });

  it('entrega perdoada sai como GRÁTIS', () => {
    const t = texto({
      ...base,
      fulfillment_type: 'delivery',
      delivery_fee_cents: 0,
      delivery_discount_cents: 10000,
    });
    expect(t).toMatch(/Entrega:.*GRÁTIS/);
  });
});
