import { describe, expect, it } from 'vitest';

import { marketingAllowedOn } from '../surfaces';

describe('marketing — onde o aviso de cookies e o rastreio entram', () => {
  it('na loja online, sim', () => {
    expect(marketingAllowedOn('/')).toBe(true);
    expect(marketingAllowedOn('/l/maputo')).toBe(true);
    expect(marketingAllowedOn('/checkout')).toBe(true);
    expect(marketingAllowedOn('/tvs-promo')).toBe(true);
  });

  it('nos ecrãs de parede, não: ninguém aceita cookies numa TV, e a TV não é visita', () => {
    expect(marketingAllowedOn('/tv/maputo/tv1')).toBe(false);
    expect(marketingAllowedOn('/tv/maputo/senhas')).toBe(false);
    expect(marketingAllowedOn('/tv')).toBe(false);
    expect(marketingAllowedOn('/kds/maputo')).toBe(false);
  });

  it('sem caminho conhecido, fica como estava', () => {
    expect(marketingAllowedOn(null)).toBe(true);
  });
});
