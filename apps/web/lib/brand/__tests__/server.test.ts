import { describe, expect, it } from 'vitest';

import { brand as factory } from '@brand';
import { loadBrand } from '../server';

/**
 * O contrato do §1: nada — nem a base de dados da própria marca — pode deixar
 * a loja fechada. Se `get_brand()` falhar, a montra abre com a fábrica.
 */
describe('loadBrand', () => {
  it('serve a marca da base de dados quando ela responde', async () => {
    const resolved = await loadBrand(async () => ({
      name: 'Casa Teste',
      tagline: 'Aberta',
      locale: 'pt-MZ',
      currency: 'MZN',
      theme: { gold: '#00ff00' },
    }));

    expect(resolved.name).toBe('Casa Teste');
    expect(resolved.theme.gold).toBe('#00ff00');
  });

  it('cai no fallback de fábrica quando a base de dados rebenta', async () => {
    const resolved = await loadBrand(async () => {
      throw new Error('BD em baixo');
    });

    expect(resolved.name).toBe(factory.name);
    expect(resolved.storefront.hero.cta).toBe(factory.storefront.hero.cta);
  });

  it('cai no fallback quando ainda não há marca gravada', async () => {
    const resolved = await loadBrand(async () => null);
    expect(resolved).toEqual(await loadBrand(async () => null));
    expect(resolved.name).toBe(factory.name);
  });
});
