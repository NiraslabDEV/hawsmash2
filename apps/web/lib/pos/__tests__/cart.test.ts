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
  setLineNotes,
  toggleLineAddon,
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

  // O pedido do dono: quem quer sem jalapeño tem de conseguir pedir sem.
  it('a nota faz da linha uma linha própria e vai no payload', () => {
    let cart: Cart = changeQty({}, resolveSellable(chips), 1);
    const [linha] = cartLines(cart);
    cart = setLineNotes(cart, linha, 'SEM JALAPENO');
    cart = changeQty(cart, resolveSellable(chips), 1);

    const linhas = cartLines(cart);
    expect(linhas).toHaveLength(2);
    expect(linhas.map((l) => l.notes)).toEqual(expect.arrayContaining([null, 'SEM JALAPENO']));
    // Contas e emblema continuam a ver os dois como o mesmo produto.
    expect(qtyOfItem(cart, 'item-chips')).toBe(2);
    expect(cartTotalCents(cart)).toBe(chips.price_cents * 2);

    expect(salePayloadItems(linhas)).toContainEqual({
      menuItemId: 'item-chips',
      qty: 1,
      notes: 'SEM JALAPENO',
    });
  });

  it('mudar a nota move a quantidade, e voltar à nota anterior soma', () => {
    let cart: Cart = changeQty({}, resolveSellable(chips), 2);
    cart = setLineNotes(cart, cartLines(cart)[0], 'SEM SAL');
    expect(cartLines(cart)).toHaveLength(1);
    expect(cartLines(cart)[0].qty).toBe(2);

    // Uma segunda linha sem nota, depois marcada com a mesma nota: junta-se.
    cart = changeQty(cart, resolveSellable(chips), 1);
    const semNota = cartLines(cart).find((l) => l.notes === null)!;
    cart = setLineNotes(cart, semNota, 'SEM SAL');
    expect(cartLines(cart)).toHaveLength(1);
    expect(cartLines(cart)[0].qty).toBe(3);
  });

  it('tirar a nota devolve a linha ao estado normal', () => {
    let cart: Cart = changeQty({}, resolveSellable(chips), 1);
    cart = setLineNotes(cart, cartLines(cart)[0], 'SEM SAL');
    cart = setLineNotes(cart, cartLines(cart)[0], null);
    expect(cartLines(cart)[0].notes).toBeNull();
    expect(salePayloadItems(cartLines(cart))[0]).toEqual({
      menuItemId: 'item-chips',
      qty: 1,
    });
  });
});

it('atribui só unidades adicionadas pela oferta e preserva notas',()=>{
 const product=resolveSellable(classic);
 const first=changeQty({},product,1);
 const accepted=changeQty(first,{...product,upsell:{kind:'companion',qty:1,placement:'pos_companion'}},1);
 expect(salePayloadItems(cartLines(accepted))[0].upsell?.qty).toBe(1);
 const normal=changeQty(accepted,product,1);
 expect(cartLines(normal)[0].upsell?.qty).toBe(1);
 const reduced=changeQty(normal,product,-1);
 expect(cartLines(reduced)[0].upsell).toBeUndefined();
 expect(cartTotalCents(normal)).toBe(90000);
});

describe('extras no lanche (1077)', () => {
  const queijo = { id: 'add-queijo', name: 'Queijo', price_cents: 5_000 };
  const bacon = { id: 'add-bacon', name: 'Bacon', price_cents: 8_000 };
  const comExtras: PosMenuItem = { ...classic, addons: [queijo, bacon] };
  const wagyu = comExtras.variants![1];

  function doisClassic(): Cart {
    return changeQty({}, resolveSellable(comExtras, wagyu), 2);
  }

  it('o extra vai para UM lanche: dois WAGYU viram um com queijo e um sem', () => {
    const cart = doisClassic();
    const [linha] = cartLines(cart);
    const { cart: seguinte, lineId } = toggleLineAddon(cart, linha, queijo, comExtras.addons!);
    const linhas = cartLines(seguinte);
    expect(linhas).toHaveLength(2);
    const comQueijo = seguinte[lineId];
    expect(comQueijo.qty).toBe(1);
    expect(comQueijo.addons?.map((a) => a.name)).toEqual(['Queijo']);
    expect(comQueijo.price_cents).toBe(45_000);
    expect(linhas.find((l) => l.id !== lineId)?.qty).toBe(1);
    // 400 + (400 + 50): o extra soma ao preço da variante, não ao do item base.
    expect(cartTotalCents(seguinte)).toBe(85_000);
    expect(cartCount(seguinte)).toBe(2);
  });

  it('tocar outra vez tira o extra e o lanche volta a juntar-se ao igual', () => {
    const cart = doisClassic();
    const { cart: comQueijo, lineId } = toggleLineAddon(cart, cartLines(cart)[0], queijo, comExtras.addons!);
    const { cart: semQueijo } = toggleLineAddon(comQueijo, comQueijo[lineId], queijo, comExtras.addons!);
    expect(cartLines(semQueijo)).toHaveLength(1);
    expect(cartLines(semQueijo)[0].qty).toBe(2);
    expect(cartTotalCents(semQueijo)).toBe(80_000);
  });

  it('a ordem dos extras é a do Cardápio, seja qual for a ordem dos toques', () => {
    const cart = changeQty({}, resolveSellable(comExtras, wagyu), 1);
    const a = toggleLineAddon(cart, cartLines(cart)[0], bacon, comExtras.addons!);
    const b = toggleLineAddon(a.cart, a.cart[a.lineId], queijo, comExtras.addons!);
    expect(b.cart[b.lineId].addons?.map((x) => x.name)).toEqual(['Queijo', 'Bacon']);
    expect(b.cart[b.lineId].price_cents).toBe(53_000);
  });

  it('manda só os ids dos extras ao servidor, nunca o preço (Regra 2)', () => {
    const cart = changeQty({}, resolveSellable(comExtras, wagyu), 1);
    const { cart: seguinte } = toggleLineAddon(cart, cartLines(cart)[0], bacon, comExtras.addons!);
    const [item] = salePayloadItems(cartLines(seguinte));
    expect(item).toEqual({ menuItemId: 'item-classic', qty: 1, variantId: 'var-wagyu', addonIds: ['add-bacon'] });
    expect(JSON.stringify(item)).not.toContain('price');
  });

  it('mudar a nota de um lanche com extra não lhe tira o extra', () => {
    const cart = changeQty({}, resolveSellable(comExtras, wagyu), 1);
    const { cart: comQueijo, lineId } = toggleLineAddon(cart, cartLines(cart)[0], queijo, comExtras.addons!);
    const comNota = setLineNotes(comQueijo, comQueijo[lineId], 'sem cebola');
    const [linha] = cartLines(comNota);
    expect(linha.addons?.map((a) => a.name)).toEqual(['Queijo']);
    expect(linha.notes).toBe('sem cebola');
    expect(linha.price_cents).toBe(45_000);
  });

  it('a chave não muda para quem não tem extras (carrinhos e testes antigos)', () => {
    expect(cartKey('x', 'v', null, [])).toBe(cartKey('x', 'v', null));
    expect(cartKey('x', null, null, ['b', 'a'])).toBe(cartKey('x', null, null, ['a', 'b']));
  });
});
