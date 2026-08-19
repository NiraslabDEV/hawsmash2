import { describe, it, expect } from 'vitest';
import { createReceipt, decodeReceipt, CUT_FULL } from '../escpos';
import type { PrintJobPayload } from '../types';

const baseJob: PrintJobPayload = {
  order_number: 'ENC-0001',
  customer_name: 'João Silva',
  fulfillment_type: 'pickup',
  items: [{ name: 'Frango Grelhado', quantity: 2 }],
  payment_method: 'mpesa',
  payment_status: 'paid',
  total_cents: 45000,
  created_at: new Date().toISOString(),
};

describe('createReceipt()', () => {
  it('retorna Buffer com bytes ESC/POS', () => {
    const buf = createReceipt(baseJob);
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.length).toBeGreaterThan(0);
  });

  it('contém o número do pedido', () => {
    const buf = createReceipt(baseJob);
    const text = decodeReceipt(buf);
    expect(text).toContain('ENC-0001');
  });

  it('contém o nome do cliente', () => {
    const buf = createReceipt(baseJob);
    const text = decodeReceipt(buf);
    expect(text.toUpperCase()).toContain('JOÃO');
  });

  it('contém LEVANTAMENTO para pickup', () => {
    const buf = createReceipt(baseJob);
    const text = decodeReceipt(buf);
    expect(text).toContain('LEVANTAMENTO');
  });

  it('contém ENTREGA e zona para delivery', () => {
    const job: PrintJobPayload = {
      ...baseJob,
      fulfillment_type: 'delivery',
      delivery_zone: 'Polana',
      address: 'Av. Julius Nyerere, 123',
    };
    const text = decodeReceipt(createReceipt(job));
    expect(text).toContain('ENTREGA');
    expect(text).toContain('Polana');
  });

  it('destaca o número da MESA em vez de levantamento/entrega no dine_in', () => {
    const job: PrintJobPayload = {
      ...baseJob,
      fulfillment_type: 'dine_in',
      table_number: 7,
      payment_method: 'no_payment',
      payment_status: undefined,
    };
    const text = decodeReceipt(createReceipt(job));
    expect(text).toContain('MESA 07');
    expect(text).not.toContain('LEVANTAMENTO');
    expect(text).not.toContain('ENTREGA');
  });

  it('agrupa os itens por pessoa quando o pedido da mesa as identifica', () => {
    const job: PrintJobPayload = {
      ...baseJob,
      fulfillment_type: 'dine_in',
      table_number: 7,
      payment_method: 'no_payment',
      items: [
        { name: 'Bitoque', quantity: 1, person: 'Ana' },
        { name: 'Tomahawk 500 gr', quantity: 1, person: 'Rui' },
        { name: 'Salada Grega', quantity: 2, person: 'Ana' },
      ],
    };
    const text = decodeReceipt(createReceipt(job));

    // Cada pessoa aparece uma só vez, como cabeçalho do seu bloco.
    expect(text.match(/ANA/g)).toHaveLength(1);
    expect(text.match(/RUI/g)).toHaveLength(1);

    // Os dois pratos da Ana ficam juntos, antes do bloco do Rui.
    const ana = text.indexOf('ANA');
    const rui = text.indexOf('RUI');
    expect(ana).toBeLessThan(rui);
    expect(text.indexOf('Bitoque')).toBeGreaterThan(ana);
    expect(text.indexOf('Salada Grega')).toBeLessThan(rui);
    expect(text.indexOf('Tomahawk 500 gr')).toBeGreaterThan(rui);
  });

  it('não inventa cabeçalho de pessoa quando a mesa pediu sem distinção', () => {
    const job: PrintJobPayload = {
      ...baseJob,
      fulfillment_type: 'dine_in',
      table_number: 3,
      payment_method: 'no_payment',
      items: [{ name: 'Bitoque', quantity: 1 }],
    };
    const text = decodeReceipt(createReceipt(job));
    expect(text).toContain('--- ITENS ---');   // lista simples, como sempre
    expect(text).toContain('1x Bitoque');
    expect(text).not.toContain('PARA A MESA'); // não inventa bloco de pessoa
  });

  it('imprime as escolhas do item (molho, acompanhamentos) na comanda', () => {
    const job: PrintJobPayload = {
      ...baseJob,
      fulfillment_type: 'dine_in',
      table_number: 7,
      payment_method: 'no_payment',
      items: [
        {
          name: 'Bitoque',
          quantity: 1,
          person: 'Ana',
          modifiers: [
            { group_name: 'Acompanhamentos', options: [{ name: 'Batata Frita' }, { name: 'Salada' }] },
            { group_name: 'Molho', options: [{ name: 'Molho de Manteiga' }] },
          ],
        },
      ],
    };
    const text = decodeReceipt(createReceipt(job));
    expect(text).toContain('Batata Frita');
    expect(text).toContain('Molho de Manteiga');
  });

  it('termina com bytes de corte total', () => {
    const buf = createReceipt(baseJob);
    const cutBytes = Array.from(CUT_FULL);
    const end = Array.from(buf.subarray(-cutBytes.length));
    expect(end).toEqual(cutBytes);
  });

  it('teste de impressão', () => {
    const buf = createReceipt({ test: true, message: 'Olá mundo' });
    const text = decodeReceipt(buf);
    expect(text).toContain('Olá mundo');
  });
});
