import { LOGO_RASTER } from '../logo';
import { describe, expect, it } from 'vitest';

import {
  createCashCloseReceipt,
  createCustomerReceipt,
  createKitchenTicket,
  createReceipt,
  decodeReceipt,
} from '../escpos';
import type { CashClosePayload, CustomerReceiptPayload, KitchenTicketPayload } from '../types';

const kitchen: KitchenTicketPayload = {
  template: 'kitchen',
  store_short_name: 'Maputo',
  order_number: 'MPT-0042',
  daily_number: 42,
  channel: 'counter',
  customer_name: 'Balcão',
  items: [{ name: 'Classic Smash', quantity: 2, notes: 'Sem cebola' }],
  notes: 'Levar',
  created_at: '2026-08-19T17:05:00.000Z',
};

const receipt: CustomerReceiptPayload = {
  template: 'receipt',
  store_short_name: 'Maputo',
  store_address: 'Av. 24 de Julho, Maputo',
  store_phone: '86 076 0009',
  receipt_footer: 'Obrigado! Bom apetite.',
  order_number: 'MPT-0042',
  daily_number: 42,
  customer_name: 'Balcão',
  items: [
    {
      name: 'Classic Smash',
      quantity: 2,
      unit_price_cents: 30000,
      line_total_cents: 60000,
    },
  ],
  subtotal_cents: 60000,
  delivery_fee_cents: 0,
  total_cents: 60000,
  payments: [{ method: 'cash', amount_cents: 60000 }],
  cash_received_cents: 100000,
  change_cents: 40000,
  created_at: '2026-08-19T17:05:00.000Z',
};

const cashClose: CashClosePayload = {
  template: 'cash_close',
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
  payments: { cash: 30000, mpesa: 20000, emola: 0, credit_card: 10000 },
  closed_by_name: 'Gerente Maputo',
};

describe('formatos HAWSMASH de 80 mm', () => {
  it('faz a comanda com número diário grande e sem qualquer preço', () => {
    const document = createKitchenTicket(kitchen);
    const text = decodeReceipt(document);

    // 'HAWSMASH' passou a ser o logo em raster; no texto fica so a loja.
    expect(document.includes(LOGO_RASTER)).toBe(true);
    expect(text).toContain('MAPUTO');
    expect(text).toContain('Nº 42');
    expect(text).toContain('BALCÃO');
    expect(text).toContain('2x Classic Smash');
    expect(text).toContain('NOTA: Sem cebola');
    expect(text).not.toContain('MT');
    expect(text).not.toContain('TOTAL');
    expect(text).not.toContain('300');
    expect({ text, hex: document.toString('hex') }).toMatchSnapshot();
  });

  it('faz o talão do cliente com preços, pagamento e troco', () => {
    const document = createCustomerReceipt(receipt);
    const text = decodeReceipt(document);

    // 'HAWSMASH' passou a ser o logo em raster; no texto fica so a loja.
    expect(document.includes(LOGO_RASTER)).toBe(true);
    expect(text).toContain('MAPUTO');
    expect(text).toContain('Av. 24 de Julho, Maputo');
    expect(text).toContain('PEDIDO MPT-0042');
    expect(text).toContain('2x Classic Smash');
    expect(text).toContain('600 MT');
    expect(text).toContain('TOTAL');
    expect(text).toContain('Dinheiro');
    expect(text).toContain('Recebido');
    expect(text).toContain('1000 MT');
    expect(text).toContain('Troco');
    expect(text).toContain('400 MT');
    expect(text).toContain('Obrigado! Bom apetite.');
    expect({ text, hex: document.toString('hex') }).toMatchSnapshot();
  });

  it('faz o fecho de caixa com gaveta e pagamentos digitais separados', () => {
    const document = createCashCloseReceipt(cashClose);
    const text = decodeReceipt(document);

    expect(text).toContain('FECHO DE CAIXA');
    // 'HAWSMASH' passou a ser o logo em raster; no texto fica so a loja.
    expect(document.includes(LOGO_RASTER)).toBe(true);
    expect(text).toContain('MAPUTO');
    expect(text).toContain('Fundo inicial');
    expect(text).toContain('Vendas dinheiro');
    expect(text).toContain('Esperado na gaveta');
    expect(text).toContain('M-Pesa');
    expect(text).toContain('Cartao');
    expect(text).toContain('Diferenca');
    expect(text).toContain('Falta confirmada na contagem');
    expect({ text, hex: document.toString('hex') }).toMatchSnapshot();
  });

  it('encaminha qualquer payload conhecido sem cair no formato herdado', () => {
    expect(decodeReceipt(createReceipt(cashClose))).toContain('FECHO DE CAIXA');
    expect(decodeReceipt(createReceipt(kitchen))).toContain('Nº 42');
    expect(decodeReceipt(createReceipt(receipt))).toContain('TOTAL');
  });

  // Um agendamento que passa despercebido no meio do talao vira comida feita a
  // hora errada, ou um cliente a chegar e a esperar de pe.
  it("poe a hora marcada em destaque, e nao poe nada quando e para ja", () => {
    const comHora = decodeReceipt(
      createKitchenTicket({ ...kitchen, scheduled_for: "2026-08-24T18:30:00.000Z" }),
    );
    expect(comHora).toContain("HORARIO:");
    expect(comHora).toContain("20:30");

    const paraJa = decodeReceipt(createKitchenTicket(kitchen));
    expect(paraJa).not.toContain("HORARIO:");
  });
});

describe('entrega vendida ao balcão', () => {
  const entrega: KitchenTicketPayload = {
    ...kitchen,
    // É este o caso que saía errado: vendida ao balcão (channel), mas entregue.
    channel: 'counter',
    fulfillment_type: 'delivery',
    customer_name: 'Ridwan',
    customer_phone: '84 000 0000',
    delivery_zone: 'Baixa',
    address: 'Av. Julius Nyerere 1234, 3.º andar',
  };

  it('a comanda carimba ENTREGA, não BALCÃO, e leva a morada', () => {
    const texto = decodeReceipt(createKitchenTicket(entrega));
    expect(texto).toContain('ENTREGA');
    expect(texto).not.toContain('BALCÃO');
    expect(texto).toContain('Ridwan');
    expect(texto).toContain('84 000 0000');
    expect(texto).toContain('Baixa');
    expect(texto).toContain('Av. Julius Nyerere 1234');
  });

  // Sem morada o entregador tem de telefonar — e o papel tem de o dizer,
  // em vez de deixar um espaço em branco que ninguém repara.
  it('sem morada, o talão diz que é preciso telefonar', () => {
    const texto = decodeReceipt(createKitchenTicket({ ...entrega, address: null }));
    expect(texto).toContain('MORADA: A CONFIRMAR POR TELEFONE');
  });

  it('a venda de balcão normal não ganha bloco de entrega nenhum', () => {
    const texto = decodeReceipt(createKitchenTicket(kitchen));
    expect(texto).toContain('BALCÃO');
    expect(texto).not.toContain('ENTREGA');
  });

  it('o talão do cliente leva a mesma morada', () => {
    const texto = decodeReceipt(
      createCustomerReceipt({
        ...receipt,
        fulfillment_type: 'delivery',
        customer_name: 'Ridwan',
        customer_phone: '84 000 0000',
        delivery_zone: 'Baixa',
        address: 'Av. Julius Nyerere 1234',
      }),
    );
    expect(texto).toContain('Morada: Av. Julius Nyerere 1234');
  });
});

