import { describe, expect, it } from 'vitest';

import {
  alreadyServed,
  companionOffers,
  upgradeOffers,
  upsellDecision,
  type UpsellItem,
} from '../upsell';

const classic: UpsellItem = {
  id: 'classic',
  name: 'Classic Smash',
  price_cents: 30000,
  variants: [
    { id: 'haw', name: 'HAW', price_cents: 30000 },
    { id: 'wagyu', name: 'WAGYU', price_cents: 40000 },
  ],
};

const brisket: UpsellItem = {
  id: 'brisket',
  name: 'Smoked Brisket',
  price_cents: 45000,
  variants: [
    { id: 'b-haw', name: 'HAW', price_cents: 45000 },
    { id: 'b-wagyu', name: 'WAGYU', price_cents: 50000 },
    { id: 'b-gold', name: 'GOLD', price_cents: 80000 },
  ],
};

const coca: UpsellItem = { id: 'coca', name: 'Coca-Cola', price_cents: 10000, is_upsell: true };
const chips: UpsellItem = { id: 'chips', name: "Joe's Chips", price_cents: 15000, is_upsell: true };
const esgotada: UpsellItem = {
  id: 'fanta',
  name: 'Fanta',
  price_cents: 10000,
  is_upsell: true,
  available: false,
};

const items = [classic, brisket, coca, chips, esgotada];

describe('subir de gama', () => {
  it('oferece WAGYU a quem escolheu HAW, com a diferença de preço', () => {
    const [offer] = upgradeOffers([{ menuItemId: 'classic', qty: 2, variantId: 'haw' }], items);
    expect(offer.better.name).toBe('WAGYU');
    expect(offer.extraCents).toBe(10000);
    expect(offer.qty).toBe(2);
    expect(offer.index).toBe(0);
  });

  it('não oferece nada a quem já está no topo', () => {
    expect(upgradeOffers([{ menuItemId: 'classic', qty: 1, variantId: 'wagyu' }], items)).toEqual([]);
  });

  it('oferece só o degrau seguinte, não o mais caro', () => {
    const [offer] = upgradeOffers([{ menuItemId: 'brisket', qty: 1, variantId: 'b-haw' }], items);
    expect(offer.better.name).toBe('WAGYU');
    expect(offer.extraCents).toBe(5000);
  });

  it('ignora linhas sem variante e itens fora do cardápio', () => {
    expect(upgradeOffers([{ menuItemId: 'coca', qty: 1 }], items)).toEqual([]);
    expect(upgradeOffers([{ menuItemId: 'fantasma', qty: 1, variantId: 'x' }], items)).toEqual([]);
  });
});

describe('para acompanhar', () => {
  it('sugere o que está marcado e ainda não está no carrinho', () => {
    const offers = companionOffers([{ menuItemId: 'classic', qty: 1, variantId: 'haw' }], items);
    expect(offers.map((o) => o.id)).toEqual(['coca', 'chips']);
  });

  it('não sugere o que já está no carrinho nem o que está esgotado', () => {
    const offers = companionOffers(
      [
        { menuItemId: 'classic', qty: 1, variantId: 'haw' },
        { menuItemId: 'coca', qty: 1 },
      ],
      items,
    );
    expect(offers.map((o) => o.id)).toEqual(['chips']);
  });

  it('respeita o limite', () => {
    expect(companionOffers([], items, 1)).toHaveLength(1);
  });
});

describe('decisão do ecrã', () => {
  const base = { ready: true, enabled: true, cartLength: 1, upgrades: 0, companions: 2, served: false };

  it('espera enquanto o carrinho não estiver hidratado', () => {
    expect(upsellDecision({ ...base, ready: false, cartLength: 0 })).toBe('wait');
  });

  it('manda para a loja se o carrinho está vazio', () => {
    expect(upsellDecision({ ...base, cartLength: 0 })).toBe('store');
  });

  it('salta para o pagamento com o upsell desligado', () => {
    expect(upsellDecision({ ...base, enabled: false })).toBe('checkout');
  });

  it('mostra quando há subida de gama, mesmo com bebida no carrinho', () => {
    expect(upsellDecision({ ...base, upgrades: 1, served: true, companions: 0 })).toBe('show');
  });

  it('não insiste com quem já tem bebida', () => {
    expect(upsellDecision({ ...base, served: true })).toBe('checkout');
  });

  it('salta quando não há nada para oferecer', () => {
    expect(upsellDecision({ ...base, companions: 0 })).toBe('checkout');
  });

  it('mostra quando há acompanhamentos', () => {
    expect(upsellDecision(base)).toBe('show');
  });
});

describe('já servido', () => {
  it('reconhece um acompanhamento no carrinho', () => {
    expect(alreadyServed([{ menuItemId: 'coca', qty: 1 }], items)).toBe(true);
    expect(alreadyServed([{ menuItemId: 'classic', qty: 1, variantId: 'haw' }], items)).toBe(false);
  });
});
