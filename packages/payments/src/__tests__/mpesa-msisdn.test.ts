import { describe, expect, it } from 'vitest';

import {
  formatMsisdn,
  InvalidMsisdnError,
  isValidMsisdn,
  normalizeMsisdn,
} from '../mpesa/msisdn';

/**
 * Porque é que isto tem tantos testes para uma coisa tão pequena: um número
 * mal normalizado é um pedido de PIN que chega ao telemóvel **de outra
 * pessoa** — e o dinheiro sai na mesma. É o erro mais barato de cometer e o
 * mais caro de explicar.
 */
describe('normalizeMsisdn', () => {
  it('aceita o número como a maioria das pessoas o escreve', () => {
    for (const escrito of [
      '841234567',
      '84 123 4567',
      '84-123-4567',
      '258841234567',
      '+258 84 123 4567',
      '00258841234567',
      '0841234567',
    ]) {
      expect(normalizeMsisdn(escrito), escrito).toBe('258841234567');
    }
  });

  it('aceita 85 (o outro prefixo Vodacom)', () => {
    expect(normalizeMsisdn('851112223')).toBe('258851112223');
  });

  it('recusa número vazio', () => {
    expect(() => normalizeMsisdn('')).toThrow(InvalidMsisdnError);
    expect(() => normalizeMsisdn('   ')).toThrow(/empty/);
  });

  it('recusa comprimento errado — a falha mais comum a escrever à pressa', () => {
    expect(() => normalizeMsisdn('84123456')).toThrow(/wrong_length/);
    expect(() => normalizeMsisdn('8412345678')).toThrow(/wrong_length/);
  });

  it('recusa operadora que não tem M-Pesa, e diz qual é o problema', () => {
    // 82/83 Tmcel, 86/87 Movitel: números moçambicanos a sério, mas o M-Pesa
    // é da Vodacom. Recusar com "número inválido" mandaria a pessoa corrigir
    // um número que está certo.
    expect(() => normalizeMsisdn('821234567')).toThrow(/not_vodacom/);
    expect(() => normalizeMsisdn('871234567')).toThrow(/not_vodacom/);
  });

  it('recusa o que não é sequer um número moçambicano', () => {
    expect(() => normalizeMsisdn('911234567')).toThrow(/not_mozambican/);
  });

  it('não deixa passar lixo com o comprimento certo', () => {
    expect(() => normalizeMsisdn('abcdefghi')).toThrow(/empty/);
  });
});

describe('isValidMsisdn', () => {
  it('responde sem lançar, para validar enquanto se escreve', () => {
    expect(isValidMsisdn('84 123 4567')).toBe(true);
    expect(isValidMsisdn('84 123')).toBe(false);
  });
});

describe('formatMsisdn', () => {
  it('mostra o número como a pessoa o reconhece', () => {
    expect(formatMsisdn('258841234567')).toBe('84 123 4567');
  });

  it('devolve o que recebeu quando não sabe formatar — nunca inventa', () => {
    expect(formatMsisdn('123')).toBe('123');
  });
});
