import { describe, expect, it } from 'vitest';
import {
  cartCount,
  cartKey,
  cartLines,
  cartTotalCents,
  changeQty,
  defaultVariant,
  needsVariantChoice,
  qtyOfItem,
  removeOneOfItem,
  resolveSellable,
  salePayloadItems,
  type Cart,
} from '../cart';
import type { PosMenuItem } from '../offline-store';

const classic: PosMenuItem = {
  id: 'item-classic',
  name: 'Classic Smash',
  description: null,
  photo_url: null,
  price_cents: 30_000,
  station: 'kitchen',
  available: true,
  variants: [
    { id: 'var-haw', name: 'HAW', price_cents: 30_000, is_default: true },
    { id: 'var-wagyu', name: 'WAGYU', price_cents: 40_000 },
  ],
};

const chips: PosMenuItem = {
  id: 'item-chips',
  name: "Joe's Chips",
  description: null,
  photo_url: null,
  price_cents: 15_000,
  station: 'kitchen',
  available: true,
};

const coca: PosMenuItem = {
  id: 'item-coca',
  name: 'Coca-Cola',
  description: null,
  photo_url: null,
  price_cents: 10_000,
  station: 'bar',
  available: true,
  variants: [
    { id: 'var-normal', name: 'Coca-Cola', price_cents: 10_000, is_default: true },
    { id: 'var-zero', name: 'Zero', price_cents: 10_000 },
  ],
};

describe('carrinho do balcão com variantes', () => {
  // O bug que a migration 1018 corrigiu no servidor: um WAGYU cobrado a preço
  // de HAW. O balcão tem de chegar ao mesmo número, ou voltamos a ter duas
  // contas para o mesmo preço.
  it('o preço da variante substitui o do item base', () => {
    expect(resolveSellable(classic, classic.variants![1]).price_cents).toBe(40_000);
    expect(resolveSellable(classic, classic.variants![0]).price_cents).toBe(30_000);
    expect(resolveSellable(chips).price_cents).toBe(15_000);
  });

  it('o nome leva a variante para o ecrã e para o papel', () => {
    expect(resolveSellable(classic, classic.variants![1]).name).toBe('Classic Smash WAGYU');
    expect(resolveSellable(chips).name).toBe("Joe's Chips");
  });

  it('não repete o nome do produto quando a variante já o contém', () => {
    expect(resolveSellable(coca, coca.variants![0]).name).toBe('Coca-Cola');
    expect(resolveSellable(coca, coca.variants![1]).name).toBe('Coca-Cola Zero');
  });

  it('duas variantes do mesmo produto são duas linhas, não uma com qty 2', () => {
    let cart: Cart = {};
    cart = changeQty(cart, resolveSellable(classic, classic.variants![0]), 1);
    cart = changeQty(cart, resolveSellable(classic, classic.variants![1]), 1);

    expect(cartLines(cart)).toHaveLength(2);
    expect(cartTotalCents(cart)).toBe(70_000);
    expect(cartCount(cart)).toBe(2);
  });

  it('o emblema do cartão soma todas as variantes do produto', () => {
    let cart: Cart = {};
    cart = changeQty(cart, resolveSellable(classic, classic.variants![0]), 1);
    cart = changeQty(cart, resolveSellable(classic, classic.variants![1]), 2);
    cart = changeQty(cart, resolveSellable(chips), 1);

    expect(qtyOfItem(cart, 'item-classic')).toBe(3);
    expect(qtyOfItem(cart, 'item-chips')).toBe(1);
    expect(qtyOfItem(cart, 'item-inexistente')).toBe(0);
  });

  it('tirar uma variante não mexe na outra', () => {
    let cart: Cart = {};
    cart = changeQty(cart, resolveSellable(classic, classic.variants![0]), 1);
    cart = changeQty(cart, resolveSellable(classic, classic.variants![1]), 1);
    cart = changeQty(cart, resolveSellable(classic, classic.variants![1]), -1);

    expect(cartLines(cart)).toHaveLength(1);
    expect(cartLines(cart)[0].variantId).toBe('var-haw');
  });

  it('chegar a zero tira a linha do carrinho', () => {
    let cart: Cart = changeQty({}, resolveSellable(chips), 1);
    cart = changeQty(cart, resolveSellable(chips), -1);
    expect(cartLines(cart)).toHaveLength(0);
  });

  // Regra 2: o POS manda ids e quantidades, nunca preços.
  it('o payload leva o variantId e nunca leva preço', () => {
    let cart: Cart = {};
    cart = changeQty(cart, resolveSellable(classic, classic.variants![1]), 2);
    cart = changeQty(cart, resolveSellable(chips), 1);

    const payload = salePayloadItems(cartLines(cart));
    expect(payload).toEqual([
      { menuItemId: 'item-classic', qty: 2, variantId: 'var-wagyu' },
      { menuItemId: 'item-chips', qty: 1 },
    ]);
    expect(JSON.stringify(payload)).not.toContain('rice');
  });

  it('só pergunta a variante quando há escolha a fazer', () => {
    expect(needsVariantChoice(classic)).toBe(true);
    expect(needsVariantChoice(chips)).toBe(false);
    expect(needsVariantChoice({ ...classic, variants: [classic.variants![0]] })).toBe(false);
  });

  it('assume a variante marcada por omissão, senão a primeira', () => {
    expect(defaultVariant(classic)?.id).toBe('var-haw');
    expect(defaultVariant({ ...classic, variants: [classic.variants![1]] })?.id).toBe('var-wagyu');
    expect(defaultVariant(chips)).toBeNull();
  });

  it('o − do funil tira o toque mais recente sem perguntar a variante', () => {
    let cart: Cart = {};
    cart = changeQty(cart, resolveSellable(classic, classic.variants![0]), 1);
    cart = changeQty(cart, resolveSellable(classic, classic.variants![1]), 1);
    cart = removeOneOfItem(cart, 'item-classic');

    expect(qtyOfItem(cart, 'item-classic')).toBe(1);
    expect(cartLines(cart)[0].variantId).toBe('var-haw');
  });

  it('tirar de um produto que não está no carrinho não faz nada', () => {
    const cart: Cart = changeQty({}, resolveSellable(chips), 1);
    expect(removeOneOfItem(cart, 'item-classic')).toBe(cart);
  });

  it('a chave distingue variantes e mantém o item simples legível', () => {
    expect(cartKey('item-chips')).toBe('item-chips');
    expect(cartKey('item-classic', 'var-wagyu')).toBe('item-classic:var-wagyu');
  });
});
