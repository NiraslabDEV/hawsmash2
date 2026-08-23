import { describe, expect, it } from 'vitest';
import { buildPosUpsellFunnel, hasMainItem, type PosUpsellCategory } from '../pos-upsell';
import { upsellScript, upsellScripts } from '../upsell-scripts';

const burger = { id: 'b1', name: 'Classic Smash', price_cents: 30000 };
const chips = { id: 'c1', name: "Joe's Chips", price_cents: 15000, is_upsell: true };
const coca = { id: 'd1', name: 'Coca-Cola', price_cents: 10000, is_upsell: true };
const natas = { id: 's1', name: 'Pastéis de Nata', price_cents: 9000, is_upsell: true };

const categorias: PosUpsellCategory[] = [
  { name: 'Burgers', items: [burger] },
  { name: 'Acompanhamentos', items: [chips] },
  { name: 'Bebidas', items: [coca] },
  { name: 'Sobremesas', items: [natas] },
];

const funil = (cart: Array<{ menuItemId: string; qty: number }>, enabled = true) =>
  buildPosUpsellFunnel({ enabled, categories: categorias, cart, seed: 0 });

describe('funil do balcão', () => {
  it('oferece acompanhar e sobremesa a quem levou só o lanche', () => {
    const passos = funil([{ menuItemId: 'b1', qty: 1 }]);
    expect(passos.map((p) => p.kind)).toEqual(['companion', 'dessert']);
    expect(passos[0].items.map((i) => i.id).sort()).toEqual(['c1', 'd1']);
    expect(passos[1].items.map((i) => i.id)).toEqual(['s1']);
  });

  it('oferece na mesma a quem levou três lanches e nada mais', () => {
    const passos = funil([{ menuItemId: 'b1', qty: 3 }]);
    expect(passos.map((p) => p.kind)).toEqual(['companion', 'dessert']);
  });

  it('não repete o que já está no carrinho', () => {
    const passos = funil([
      { menuItemId: 'b1', qty: 1 },
      { menuItemId: 'd1', qty: 1 },
    ]);
    expect(passos[0].items.map((i) => i.id)).toEqual(['c1']);
  });

  it('salta o passo de acompanhar quando já tem batata e bebida', () => {
    const passos = funil([
      { menuItemId: 'b1', qty: 1 },
      { menuItemId: 'c1', qty: 1 },
      { menuItemId: 'd1', qty: 1 },
    ]);
    expect(passos.map((p) => p.kind)).toEqual(['dessert']);
  });

  it('vai directo ao pagamento com o pedido completo', () => {
    const passos = funil([
      { menuItemId: 'b1', qty: 1 },
      { menuItemId: 'c1', qty: 1 },
      { menuItemId: 'd1', qty: 1 },
      { menuItemId: 's1', qty: 1 },
    ]);
    expect(passos).toEqual([]);
  });

  it('não abre funil a quem leva só uma bebida', () => {
    expect(funil([{ menuItemId: 'd1', qty: 1 }])).toEqual([]);
  });

  it('não abre funil com o carrinho vazio nem com o upsell desligado', () => {
    expect(funil([])).toEqual([]);
    expect(funil([{ menuItemId: 'b1', qty: 1 }], false)).toEqual([]);
  });

  it('ignora o que está esgotado', () => {
    const semBatata: PosUpsellCategory[] = [
      { name: 'Burgers', items: [burger] },
      { name: 'Acompanhamentos', items: [{ ...chips, available: false }] },
      { name: 'Bebidas', items: [coca] },
    ];
    const passos = buildPosUpsellFunnel({
      enabled: true, categories: semBatata, cart: [{ menuItemId: 'b1', qty: 1 }], seed: 0,
    });
    expect(passos[0].items.map((i) => i.id)).toEqual(['d1']);
  });
});

describe('item principal', () => {
  it('reconhece o lanche e não confunde com um acompanhamento', () => {
    const itens = [burger, chips, coca, natas];
    expect(hasMainItem([{ menuItemId: 'b1', qty: 1 }], itens)).toBe(true);
    expect(hasMainItem([{ menuItemId: 'c1', qty: 1 }], itens)).toBe(false);
  });
});

describe('frases de balcão', () => {
  it('dá uma frase para cada passo', () => {
    expect(upsellScript('companion', 0)).toBeTruthy();
    expect(upsellScript('dessert', 0)).toBeTruthy();
    expect(upsellScript('upgrade', 0)).toBeTruthy();
  });

  it('roda entre as frases sem sair do intervalo', () => {
    const frases = upsellScripts('companion');
    const vistas = new Set(frases.map((_, i) => upsellScript('companion', i)));
    expect(vistas.size).toBe(frases.length);
    expect(frases).toContain(upsellScript('companion', 999));
    expect(frases).toContain(upsellScript('companion', -7));
  });

  it('a mesma venda vê sempre a mesma frase', () => {
    expect(upsellScript('dessert', 42)).toBe(upsellScript('dessert', 42));
  });
});
