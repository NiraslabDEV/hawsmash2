import { describe, it, expect } from 'vitest';
import { cents, centsToDecimalString, decimalStringToCents, formatMT, orderTotal, type Cents } from '../money';

describe('cents()', () => {
  it('cria cents válidos a partir de inteiro positivo', () => {
    expect(cents(0)).toBe(0);
    expect(cents(100)).toBe(100);
    expect(cents(250050)).toBe(250050);
  });

  it('lança para float', () => {
    expect(() => cents(1.5)).toThrow('invalid cents');
  });

  it('lança para negativo', () => {
    expect(() => cents(-1)).toThrow('invalid cents');
  });

  it('lança para NaN', () => {
    expect(() => cents(NaN)).toThrow('invalid cents');
  });
});

describe('centsToDecimalString()', () => {
  it('converte para string decimal com 2 casas', () => {
    expect(centsToDecimalString(cents(125050))).toBe('1250.50');
    expect(centsToDecimalString(cents(100))).toBe('1.00');
    expect(centsToDecimalString(cents(0))).toBe('0.00');
  });
});

describe('decimalStringToCents()', () => {
  it('converte string decimal para cents arredondando', () => {
    expect(decimalStringToCents('1250.50')).toBe(125050);
    expect(decimalStringToCents('1.00')).toBe(100);
    expect(decimalStringToCents('0.00')).toBe(0);
    expect(decimalStringToCents('99.999')).toBe(10000);
  });
});

describe('formatMT()', () => {
  it('formata valor em MT', () => {
    const result = formatMT(cents(150000));
    expect(result).toContain('MT');
    expect(result).toContain('1');
  });

  // Os preços de restaurante em MZN são valores redondos. Arrastar ",00" em
  // cada linha do cardápio é ruído — o cartaz do cliente escreve "1200MT".
  it('não mostra casas decimais quando o valor é redondo', () => {
    expect(formatMT(cents(49500))).toBe('495 MT');
    expect(formatMT(cents(120000))).not.toContain(',00');
  });

  it('mostra os centavos quando existem de facto', () => {
    expect(formatMT(cents(123456))).toContain(',56');
  });
});

describe('orderTotal()', () => {
  it('soma itens corretamente', () => {
    const items = [
      { qty: 2, unitPriceCents: cents(3500) as Cents },
      { qty: 1, unitPriceCents: cents(2000) as Cents },
    ];
    expect(orderTotal(items)).toBe(9000);
  });

  it('retorna 0 para array vazio', () => {
    expect(orderTotal([])).toBe(0);
  });

  it('respeita qty > 1', () => {
    const items = [{ qty: 3, unitPriceCents: cents(1000) as Cents }];
    expect(orderTotal(items)).toBe(3000);
  });
});
