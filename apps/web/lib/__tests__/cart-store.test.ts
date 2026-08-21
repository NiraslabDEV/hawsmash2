import { describe, expect, it } from 'vitest';

import { cartHasItems, shouldClearCart } from '../cart-store';

describe('carrinho pertence a uma loja', () => {
  it('esvazia quando o carrinho é de outra loja', () => {
    expect(shouldClearCart('maputo', 'matola', '[{"menuItemId":"x","qty":1}]')).toBe(true);
  });

  it('não mexe no carrinho da própria loja', () => {
    expect(shouldClearCart('matola', 'matola', '[{"menuItemId":"x","qty":1}]')).toBe(false);
  });

  it('primeira visita (sem dono) não esvazia nada', () => {
    expect(shouldClearCart(null, 'maputo', '[{"menuItemId":"x","qty":1}]')).toBe(false);
  });

  it('carrinho vazio de outra loja não gera aviso', () => {
    expect(shouldClearCart('maputo', 'matola', '[]')).toBe(false);
  });

  it('JSON corrompido não conta como carrinho', () => {
    expect(cartHasItems('{isto não é json')).toBe(false);
    expect(shouldClearCart('maputo', 'matola', '{isto não é json')).toBe(false);
  });
});
