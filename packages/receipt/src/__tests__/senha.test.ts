import { describe, expect, it } from 'vitest';

import {
  FACTORY_PRINT_LAYOUT,
  buildPrintDocument,
  buildSenhaSlip,
  type Op,
  type SenhaSlipPayload,
} from '../index';

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

describe('senha pequena com o logo e no balcão (1111)', () => {
  /** O que a 1111 põe na fila, no balcão, por cada venda do POS. */
  const balcao: SenhaSlipPayload = {
    ...senha,
    daily_number: 23,
    table_number: null,
    customer_name: 'Ana',
    order_number: 'MPT-0050',
    fulfillment_type: 'counter',
  };

  it('abre com o logo da marca, como o talão completo', () => {
    const ops = buildSenhaSlip(senha);
    expect(ops.findIndex((op) => op.t === 'brand')).toBeGreaterThan(-1);
    expect(ops.findIndex((op) => op.t === 'brand')).toBeLessThan(
      ops.findIndex((op) => op.t === 'text' && op.value.startsWith('SENHA')),
    );
  });

  it('sem logo quando a loja o desligou no talão', () => {
    const semLogo = { ...FACTORY_PRINT_LAYOUT, show: { ...FACTORY_PRINT_LAYOUT.show, logo: false } };
    expect(buildSenhaSlip(senha, semLogo).some((op) => op.t === 'brand')).toBe(false);
    expect(buildPrintDocument('receipt', senha, semLogo).some((op) => op.t === 'brand')).toBe(false);
  });

  it('no balcão: a senha e o nome, sem mesa', () => {
    const linhas = texto(buildSenhaSlip(balcao));
    expect(linhas).toContain('SENHA');
    expect(linhas).toContain('23');
    expect(linhas).toContain('ANA');
    expect(linhas.join(' ')).not.toMatch(/MESA/);
  });

  it('no balcão sem nome escrito: só a senha', () => {
    const linhas = texto(buildSenhaSlip({ ...balcao, customer_name: '' }));
    expect(linhas).toContain('23');
    expect(linhas.join(' ')).not.toMatch(/MESA|BALCÃO/);
  });
});
