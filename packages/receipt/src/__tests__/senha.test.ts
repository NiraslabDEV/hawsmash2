import { describe, expect, it } from 'vitest';

import { buildPrintDocument, buildSenhaSlip, type Op, type SenhaSlipPayload } from '../index';

function texto(ops: Op[]): string[] {
  return ops
    .filter((op): op is Extract<Op, { t: 'text' }> => op.t === 'text')
    .map((op) => op.value.replace(/\n$/, ''));
}

/** O que a 1092 põe na fila, no balcão, por cada pedido de mesa. */
const senha: SenhaSlipPayload = {
  template: 'senha',
  store_short_name: 'Maputo',
  daily_number: 17,
  table_number: 5,
  customer_name: 'Mesa 5 · João',
  order_number: 'MPT-0042',
  created_at: '2026-09-25T14:05:00.000Z',
  fulfillment_type: 'dine_in',
  items: [],
  payment_method: 'no_payment',
  total_cents: 40000,
};

describe('senha pequena da mesa (1092)', () => {
  it('leva a senha, a mesa e o nome — nada de artigos nem preços', () => {
    const linhas = texto(buildSenhaSlip(senha));
    expect(linhas).toContain('SENHA');
    expect(linhas).toContain('17');
    expect(linhas).toContain('MESA 5');
    expect(linhas).toContain('JOÃO');
    expect(linhas.join(' ')).not.toMatch(/MT|Total|400/);
  });

  it('sem nome escrito, a mesa não sai duas vezes', () => {
    const linhas = texto(buildSenhaSlip({ ...senha, customer_name: 'Mesa 5' }));
    expect(linhas.filter((l) => /MESA 5/i.test(l))).toEqual(['MESA 5']);
  });

  it('um trabalho `receipt` com este payload sai como senha, não como talão do cliente', () => {
    expect(buildPrintDocument('receipt', senha)).toEqual(buildSenhaSlip(senha));
  });

  it('corta o papel no fim', () => {
    expect(buildSenhaSlip(senha).at(-1)).toEqual({ t: 'cut' });
  });
});
