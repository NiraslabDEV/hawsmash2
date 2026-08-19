import { describe, expect, it } from 'vitest';

import { parseMTInput } from '../input';

describe('parseMTInput', () => {
  it.each([
    ['0', 0],
    ['10', 1000],
    ['10,5', 1050],
    ['10.50', 1050],
    [' 1 250,25 ', 125025],
  ])('converte %s directamente em centavos inteiros', (input, expected) => {
    expect(parseMTInput(input)).toBe(expected);
  });

  it.each(['', '-1', '1.234', 'abc', '10,2.0'])('recusa valor inválido %s', (input) => {
    expect(parseMTInput(input)).toBeNull();
  });
});
