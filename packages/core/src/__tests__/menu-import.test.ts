import { describe, it, expect } from 'vitest';
import { normalizeMenuImport } from '../menu-import';

const valid = {
  version: 1,
  currency: 'MZN',
  categories: [
    {
      name: 'Entradas',
      sort: 1,
      items: [
        { name: 'Caril de Camarão', description: 'Coco', price: 130, photo_url: 'https://x.co/a.jpg' },
        { name: 'Sumo de Manga', price: '25.50' },
      ],
    },
  ],
};

describe('normalizeMenuImport', () => {
  it('converte preços MT → centavos (número e string)', () => {
    const menu = normalizeMenuImport(valid);
    const items = menu.categories[0].items;
    expect(items[0].price_cents).toBe(13000);
    expect(items[1].price_cents).toBe(2550);
  });

  it('aplica defaults (description, available, station, stock)', () => {
    const menu = normalizeMenuImport(valid);
    const item = menu.categories[0].items[1];
    expect(item.description).toBe('');
    expect(item.available).toBe(true);
    expect(item.track_stock).toBe(false);
    expect(item.stock_qty).toBe(0);
    expect(menu.categories[0].station).toBe('kitchen');
  });

  it('preserva photo_url e nomes (trim)', () => {
    const menu = normalizeMenuImport({
      categories: [{ name: '  Bebidas  ', items: [{ name: '  Água  ', price: 20 }] }],
    });
    expect(menu.categories[0].name).toBe('Bebidas');
    expect(menu.categories[0].items[0].name).toBe('Água');
  });

  it('lança erro claro com preço inválido (inclui nome do item)', () => {
    expect(() =>
      normalizeMenuImport({ categories: [{ name: 'X', items: [{ name: 'Pizza', price: 'grátis' }] }] })
    ).toThrow(/Pizza/);
  });

  it('rejeita preço negativo', () => {
    expect(() =>
      normalizeMenuImport({ categories: [{ name: 'X', items: [{ name: 'Y', price: -5 }] }] })
    ).toThrow();
  });

  it('rejeita ficheiro sem categorias', () => {
    expect(() => normalizeMenuImport({ categories: [] })).toThrow();
  });

  it('rejeita categoria sem itens', () => {
    expect(() => normalizeMenuImport({ categories: [{ name: 'Vazia', items: [] }] })).toThrow();
  });

  it('rejeita item sem nome', () => {
    expect(() =>
      normalizeMenuImport({ categories: [{ name: 'X', items: [{ name: '', price: 10 }] }] })
    ).toThrow();
  });

  it('aceita station válida e rejeita inválida', () => {
    const ok = normalizeMenuImport({
      categories: [{ name: 'Bar', station: 'bar', items: [{ name: 'Cerveja', price: 80 }] }],
    });
    expect(ok.categories[0].station).toBe('bar');
    expect(() =>
      normalizeMenuImport({
        categories: [{ name: 'X', station: 'garagem', items: [{ name: 'Y', price: 10 }] }],
      })
    ).toThrow();
  });

  it('price null → "preço a confirmar": price_cents=0, available=false, sempre (mesmo se available:true vier no ficheiro)', () => {
    const menu = normalizeMenuImport({
      categories: [{
        name: 'Vinhos',
        items: [{ name: 'Fat Bastard', price: null, available: true }],
      }],
    });
    const item = menu.categories[0].items[0];
    expect(item.price_cents).toBe(0);
    expect(item.available).toBe(false);
    expect(item.description).toContain('preço a confirmar');
  });

  it('price omitido (undefined) tem o mesmo efeito que price null', () => {
    const menu = normalizeMenuImport({
      categories: [{ name: 'Vinhos', items: [{ name: 'Casal Garcia' }] }],
    });
    expect(menu.categories[0].items[0].price_cents).toBe(0);
    expect(menu.categories[0].items[0].available).toBe(false);
  });

  it('não duplica o marcador "(preço a confirmar)" se já estiver na description', () => {
    const menu = normalizeMenuImport({
      categories: [{
        name: 'Vinhos',
        items: [{ name: 'Portada', price: null, description: 'Tinto encorpado (preço a confirmar)' }],
      }],
    });
    expect(menu.categories[0].items[0].description).toBe('Tinto encorpado (preço a confirmar)');
  });
});
