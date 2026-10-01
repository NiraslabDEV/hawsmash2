import { describe, expect, it } from 'vitest';

import type { CartLine } from '../cart';
import {
  checkManualDiscount,
  couponErrorText,
  discountPayload,
  posPromotionPreview,
  readCachedPromotions,
  writeCachedPromotions,
  type PosPromotions,
} from '../promotions';

const line = (menuItemId: string, price: number, qty: number): CartLine => ({
  id: menuItemId,
  menuItemId,
  variantId: null,
  name: menuItemId,
  price_cents: price,
  station: 'kitchen',
  photo_url: null,
  notes: null,
  qty,
});

const promos = (includeCounter: boolean): PosPromotions => ({
  bogo: { live: true, label: '2x1', same_item_only: true, include_counter: includeCounter, item_ids: ['classic'] },
  free_delivery: { live: true, label: 'Entrega', min_subtotal_cents: 50000, include_counter: includeCounter },
});

describe('posPromotionPreview — a mesma conta que o create_counter_sale', () => {
  const cart = [line('classic', 45000, 2), line('cola', 8000, 1)];

  it('2x1 do site não corre no balcão sem "também no balcão"', () => {
    const r = posPromotionPreview({ lines: cart, fulfillment: 'counter', zoneFeeCents: 0, promotions: promos(false), coupon: null, manual: null });
    expect(r.totalCents).toBe(98000);
  });

  it('com "também no balcão", sai uma unidade grátis', () => {
    const r = posPromotionPreview({ lines: cart, fulfillment: 'counter', zoneFeeCents: 0, promotions: promos(true), coupon: null, manual: null });
    expect(r.bogoDiscountCents).toBe(45000);
    expect(r.totalCents).toBe(53000);
  });

  it('cupão 10% + 2x1 + manual: a ordem é 2x1 → cupão → manual (igual ao teste SQL 16)', () => {
    const r = posPromotionPreview({
      lines: cart,
      fulfillment: 'counter',
      zoneFeeCents: 0,
      promotions: promos(true),
      coupon: { code: 'X', type: 'discount_pct', value: 10, giftItemId: null },
      manual: null,
    });
    expect(r.totalCents).toBe(47700);
  });

  it('balcão a entregar: a taxa só conta em entrega, e a entrega grátis precisa do opt-in', () => {
    const semOptIn = posPromotionPreview({ lines: cart, fulfillment: 'delivery', zoneFeeCents: 10000, promotions: promos(false), coupon: null, manual: null });
    expect(semOptIn.deliveryFeeCents).toBe(10000);
    const comOptIn = posPromotionPreview({ lines: cart, fulfillment: 'delivery', zoneFeeCents: 10000, promotions: promos(true), coupon: null, manual: null });
    expect(comOptIn.deliveryFeeCents).toBe(0);
    const balcao = posPromotionPreview({ lines: cart, fulfillment: 'counter', zoneFeeCents: 10000, promotions: null, coupon: null, manual: null });
    expect(balcao.deliveryFeeCents).toBe(0);
  });
});

describe('discountPayload', () => {
  it('nada a enviar sem desconto', () => {
    expect(discountPayload({ coupon: null, customerPhone: '84', manual: null })).toEqual({});
  });

  it('cupão leva o telefone; manual leva o motivo limpo', () => {
    expect(
      discountPayload({
        coupon: { code: 'AMIGO', type: 'discount_pct', value: 10, giftItemId: null },
        customerPhone: ' 841234567 ',
        manual: { type: 'cents', value: 1000, reason: '  Cliente habitual ' },
      }),
    ).toEqual({
      referralCode: 'AMIGO',
      customerPhone: '841234567',
      manualDiscount: { type: 'cents', value: 1000, reason: 'Cliente habitual' },
    });
  });
});

describe('checkManualDiscount', () => {
  it('exige valor e motivo', () => {
    expect(checkManualDiscount({ type: 'pct', value: 0, reason: 'x' })).not.toBeNull();
    expect(checkManualDiscount({ type: 'pct', value: 101, reason: 'Amigo' })).not.toBeNull();
    expect(checkManualDiscount({ type: 'pct', value: 10, reason: 'ab' })).not.toBeNull();
    expect(checkManualDiscount({ type: 'cents', value: 1000, reason: 'Amigo' })).toBeNull();
  });
});

describe('cache e mensagens', () => {
  it('guarda e lê por loja; storage partido não rebenta', () => {
    const mem = new Map<string, string>();
    const storage = {
      getItem: (k: string) => mem.get(k) ?? null,
      setItem: (k: string, v: string) => void mem.set(k, v),
    } as unknown as Storage;
    writeCachedPromotions(storage, 'maputo', promos(true));
    expect(readCachedPromotions(storage, 'maputo')?.bogo?.include_counter).toBe(true);
    expect(readCachedPromotions(storage, 'matola')).toBeNull();
    const partido = { getItem: () => { throw new Error('x'); }, setItem: () => { throw new Error('x'); } } as unknown as Storage;
    expect(readCachedPromotions(partido, 'maputo')).toBeNull();
    expect(() => writeCachedPromotions(partido, 'maputo', promos(true))).not.toThrow();
  });

  it('traduz os motivos do servidor e da validação', () => {
    expect(couponErrorText('referral_wrong_store')).toMatch(/loja/);
    expect(couponErrorText('already_redeemed')).toMatch(/já usou/);
    expect(couponErrorText('coupon_requires_phone')).toMatch(/telefone/);
    expect(couponErrorText(undefined)).toMatch(/inválido/);
  });
});
