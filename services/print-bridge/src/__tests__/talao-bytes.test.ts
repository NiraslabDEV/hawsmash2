import { describe, expect, it } from 'vitest';

import { createCashCloseReceipt, createCustomerReceipt, createKitchenTicket, createReceipt } from '../escpos';
import type {
  CashClosePayload,
  CustomerReceiptPayload,
  KitchenTicketPayload,
  PrintJobPayload,
} from '../types';

/**
 * O papel byte a byte — o retrato que guarda o talão validado em papel.
 *
 * Os testes de texto dizem o que o talão diz; estes dizem que ele sai
 * EXACTAMENTE igual. Foram gravados antes de os modelos de impressão (aba POS)
 * existirem: com o modelo de fábrica, cada formato tem de continuar a produzir
 * os mesmos bytes. Se um destes mudar, o papel das lojas mudou — de propósito
 * ou não. Corre sem o logo da instalação (BRAND_LOGO_FILE a apontar para nada
 * no CI), como os outros testes de formato.
 */

const online: KitchenTicketPayload = {
  template: 'kitchen',
  formato: 'talao_completo',
  via: 'controlo',
  store_short_name: 'Maputo',
  store_address: 'Av. 24 de Julho, 141, Maputo',
  store_phone: '86 076 0009',
  order_number: 'MPT-0042',
  daily_number: 7,
  channel: 'pickup',
  fulfillment_type: 'pickup',
  customer_name: 'MARIA ALBERTINA',
  customer_phone: '840000001',
  items: [
    { name: 'Classic Smash HAW', quantity: 2, notes: 'Sem cebola, sem molho', line_total_cents: 60000 },
    { name: 'Coca-Cola', quantity: 1, line_total_cents: 10000 },
  ],
  notes: 'Chego às 20h',
  subtotal_cents: 70000,
  delivery_fee_cents: 0,
  discount_cents: 0,
  total_cents: 70000,
  payment_method: 'mpesa',
  review_url: 'https://g.page/r/exemplo/review',
  instagram: '@marca',
  instagram_url: 'https://instagram.com/marca',
  receipt_footer: 'NUIT 000000000 · Obrigado pela preferência',
  created_at: '2026-09-23T13:04:00.000Z',
};

const entrega: KitchenTicketPayload = {
  ...online,
  via: 'cliente',
  channel: 'delivery',
  fulfillment_type: 'delivery',
  delivery_zone: 'Sommerschield',
  address: 'Rua da Sé 114, 2.º andar, portão verde ao lado da farmácia',
  delivery_fee_cents: 15000,
  discount_cents: 5000,
  total_cents: 80000,
  scheduled_for: '2026-09-23T18:00:00.000Z',
  review_url: null,
};

const balcao: KitchenTicketPayload = {
  ...online,
  via: 'cozinha',
  channel: 'counter',
  fulfillment_type: 'counter',
  customer_name: null,
  customer_phone: null,
  notes: null,
  payment_method: 'cash',
  payments: [{ method: 'cash', amount_cents: 70000 }],
  cash_received_cents: 100000,
  change_cents: 30000,
  receipt_footer: null,
};

const misto: KitchenTicketPayload = {
  ...balcao,
  via: 'reimpressao',
  payments: [
    { method: 'cash', amount_cents: 20000 },
    { method: 'mpesa', amount_cents: 50000 },
  ],
  cash_received_cents: 20000,
  change_cents: 0,
  review_url: null,
  instagram_url: null,
};

const viaUnica: KitchenTicketPayload = { ...online, via: null, customer_name: 'Ana', address: null };

const comanda: KitchenTicketPayload = {
  template: 'kitchen',
  store_short_name: 'Maputo',
  order_number: 'MPT-0042',
  daily_number: 42,
  channel: 'counter',
  fulfillment_type: 'delivery',
  customer_name: 'Ridwan',
  customer_phone: '84 000 0000',
  delivery_zone: 'Baixa',
  address: null,
  scheduled_for: '2026-08-24T18:30:00.000Z',
  items: [{ name: 'Double Smash WAGYU', quantity: 1, notes: 'Bem passado' }],
  notes: 'Levar',
  created_at: '2026-08-19T17:05:00.000Z',
};

const recibo: CustomerReceiptPayload = {
  template: 'receipt',
  store_short_name: 'Maputo',
  store_address: 'Av. 24 de Julho, Maputo',
  store_phone: '86 076 0009',
  receipt_footer: 'Obrigado! Bom apetite.',
  order_number: 'MPT-0042',
  daily_number: 42,
  customer_name: 'Balcão',
  fulfillment_type: 'delivery',
  delivery_zone: 'Baixa',
  address: 'Av. Julius Nyerere 1234',
  items: [{ name: 'Classic Smash', quantity: 2, unit_price_cents: 30000, line_total_cents: 60000, notes: 'Sem sal' }],
  subtotal_cents: 60000,
  delivery_fee_cents: 15000,
  total_cents: 75000,
  payments: [{ method: 'cash', amount_cents: 75000 }],
  cash_received_cents: 100000,
  change_cents: 25000,
  created_at: '2026-08-19T17:05:00.000Z',
};

const fecho: CashClosePayload = {
  template: 'cash_close',
  store_short_name: 'Maputo',
  shift_label: 'Turno da noite',
  opened_at: '2026-08-19T16:00:00.000Z',
  closed_at: '2026-08-19T21:30:00.000Z',
  opening_float_cents: 50000,
  cash_sales_cents: 120000,
  sangria_cents: 20000,
  reforco_cents: 10000,
  despesa_cents: 5000,
  expected_cash_cents: 155000,
  counted_cash_cents: 150000,
  difference_cents: -5000,
  difference_reason: 'Troco dado a mais',
  payments: { cash: 120000, mpesa: 80000, emola: 10000, credit_card: 0 },
  closed_by_name: 'Gerente',
};

const mesa: PrintJobPayload = {
  order_number: 'MPT-0043',
  customer_name: 'Mesa 4',
  fulfillment_type: 'dine_in',
  table_number: 4,
  items: [
    { name: 'Classic Smash', quantity: 1, person: 'Ana', notes: 'sem cebola' },
    { name: 'Coca-Cola', quantity: 2, modifiers: [{ group_name: 'Gelo', options: [{ name: 'Sem gelo' }] }] },
  ],
  payment_method: 'no_payment',
  total_cents: 50000,
  created_at: '2026-08-19T17:05:00.000Z',
};

const hex = (buffer: Buffer) => buffer.toString('hex');

describe('o papel byte a byte (modelo de fábrica)', () => {
  it.each([
    ['talão completo · levantamento · via de controlo', online],
    ['talão completo · entrega agendada · via do cliente', entrega],
    ['talão completo · balcão em dinheiro · via da cozinha', balcao],
    ['talão completo · pagamento misto · reimpressão', misto],
    ['talão completo · via única sem rótulo', viaUnica],
    ['comanda curta · entrega sem morada', comanda],
  ])('%s', (_nome, payload) => {
    expect(hex(createKitchenTicket(payload))).toMatchSnapshot();
  });

  it('talão curto do cliente', () => {
    expect(hex(createCustomerReceipt(recibo))).toMatchSnapshot();
  });

  it('fecho de caixa', () => {
    expect(hex(createCashCloseReceipt(fecho))).toMatchSnapshot();
  });

  it('comanda de mesa (formato herdado)', () => {
    expect(hex(createReceipt(mesa))).toMatchSnapshot();
  });
});
