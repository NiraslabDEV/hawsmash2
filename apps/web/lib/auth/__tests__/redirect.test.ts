import { describe, expect, it } from 'vitest';
import { safeInternalRedirect } from '../redirect';

describe('retorno após login', () => {
  it('aceita apenas caminhos internos absolutos', () => {
    expect(safeInternalRedirect('/pos')).toBe('/pos');
    expect(safeInternalRedirect('/pedidos?loja=maputo')).toBe('/pedidos?loja=maputo');
  });

  it('recusa destinos externos e caminhos ambíguos', () => {
    expect(safeInternalRedirect('https://exemplo.test')).toBe('/pedidos');
    expect(safeInternalRedirect('//exemplo.test/roubar')).toBe('/pedidos');
    expect(safeInternalRedirect('/\\exemplo.test')).toBe('/pedidos');
    expect(safeInternalRedirect(null)).toBe('/pedidos');
  });
});
