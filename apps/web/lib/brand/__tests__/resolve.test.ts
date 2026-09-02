import { describe, expect, it } from 'vitest';

import { brand as factory } from '@brand';
import { deepMerge, resolveBrand, type BrandRow } from '../resolve';

/**
 * A regra que estes testes protegem: a marca vem da base de dados, mas a loja
 * **nunca abre sem marca**. Se a BD não responder, se a linha não existir, ou
 * se vier meia preenchida, o que falta cai no fallback de fábrica em vez de
 * deixar um buraco no ecrã de um cliente (CLAUDE.md §18.2 · ROADMAP-PRODUTO P1).
 */

const row = (patch: Partial<BrandRow> = {}): BrandRow => ({
  name: 'Casa Teste',
  tagline: 'Comida a sério',
  locale: 'pt-MZ',
  currency: 'MZN',
  logo_path: null,
  favicon_path: null,
  og_image_path: null,
  receipt_footer_default: null,
  social: {},
  contact: {},
  theme: {},
  storefront: {},
  ...patch,
});

describe('deepMerge', () => {
  it('funde objectos aninhados sem apagar o que não veio', () => {
    const base = { a: 1, nested: { x: 'base', y: 'fica' } };
    const merged = deepMerge(base, { nested: { x: 'novo' } });
    expect(merged).toEqual({ a: 1, nested: { x: 'novo', y: 'fica' } });
  });

  it('substitui listas inteiras em vez de as fundir posição a posição', () => {
    // Um marquee de 3 itens não deve herdar o 4.º do dono anterior.
    const merged = deepMerge({ marquee: ['a', 'b', 'c'] }, { marquee: ['x'] });
    expect(merged.marquee).toEqual(['x']);
  });

  it('ignora null e undefined — não são "apaga isto"', () => {
    const merged = deepMerge({ a: 'fica', b: 'fica' }, { a: null, b: undefined });
    expect(merged).toEqual({ a: 'fica', b: 'fica' });
  });

  it('respeita string vazia, que é uma escolha (esconder o ícone)', () => {
    const merged = deepMerge({ whatsapp: 'https://wa.me/1' }, { whatsapp: '' });
    expect(merged.whatsapp).toBe('');
  });
});

describe('resolveBrand', () => {
  it('sem linha na base de dados devolve a marca de fábrica intacta', () => {
    expect(resolveBrand(factory, null)).toEqual(factory);
  });

  it('a linha manda no que preencheu e herda o resto', () => {
    const resolved = resolveBrand(factory, row({ name: 'Casa Teste', theme: { gold: '#00ff00' } }));

    expect(resolved.name).toBe('Casa Teste');
    expect(resolved.theme.gold).toBe('#00ff00');
    // Não preencheu o resto do tema: continua a haver tema.
    expect(resolved.theme.bg0).toBe(factory.theme.bg0);
    expect(resolved.storefront.hero.cta).toBe(factory.storefront.hero.cta);
  });

  it('mapeia as colunas próprias para onde a loja as lê', () => {
    const resolved = resolveBrand(
      factory,
      row({
        logo_path: 'https://cdn.exemplo/logo.svg',
        contact: { phone: '+258 84 000 0000', instagram: '@casateste' },
      }),
    );

    expect(resolved.storefront.logoImage).toBe('https://cdn.exemplo/logo.svg');
    expect(resolved.storefront.contact.phone).toBe('+258 84 000 0000');
    // O que o contacto não trouxe continua a existir.
    expect(resolved.storefront.contact.addressLine2).toBe(factory.storefront.contact.addressLine2);
  });

  it('uma subárvore vazia não apaga a marca — é "não mexi nisto"', () => {
    const resolved = resolveBrand(factory, row({ theme: {}, storefront: {}, social: {} }));
    expect(resolved.theme).toEqual(factory.theme);
    expect(resolved.storefront.landing).toEqual(factory.storefront.landing);
  });

  it('não deixa o nome ficar vazio, aconteça o que acontecer', () => {
    const resolved = resolveBrand(factory, row({ name: '' as unknown as string }));
    expect(resolved.name).toBe(factory.name);
    expect(resolved.name.length).toBeGreaterThan(0);
  });
});
