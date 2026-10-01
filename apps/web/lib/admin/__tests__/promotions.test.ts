import { describe, expect, it } from 'vitest';

import {
  buildCouponRow,
  buildPromotionRow,
  describeCoupon,
  describeWeekdays,
  maputoDateInput,
  maputoDayEnd,
  maputoDayStart,
  type CouponDraft,
  type PromotionDraft,
} from '../promotions';

const coupon = (patch: Partial<CouponDraft> = {}): CouponDraft => ({
  code: 'amigo10',
  ownerName: ' Campanha ',
  ownerPhone: '',
  rewardType: 'discount_pct',
  pct: '10',
  valueMT: '',
  giftItemId: '',
  maxRedemptions: '100',
  expiresOn: '',
  storeId: '',
  ...patch,
});

describe('buildCouponRow', () => {
  it('normaliza o código para maiúsculas e sem espaços à volta', () => {
    const r = buildCouponRow(coupon({ code: '  amigo10 ' }));
    expect(r.ok && r.value.code).toBe('AMIGO10');
    expect(r.ok && r.value.owner_name).toBe('Campanha');
  });

  it('recusa códigos com espaços ou símbolos (o cliente não os conseguia escrever igual)', () => {
    expect(buildCouponRow(coupon({ code: 'AMIGO 10' })).ok).toBe(false);
    expect(buildCouponRow(coupon({ code: 'A' })).ok).toBe(false);
  });

  it('% só de 1 a 100, inteiro', () => {
    expect(buildCouponRow(coupon({ pct: '0' })).ok).toBe(false);
    expect(buildCouponRow(coupon({ pct: '101' })).ok).toBe(false);
    expect(buildCouponRow(coupon({ pct: '12.5' })).ok).toBe(false);
    const r = buildCouponRow(coupon({ pct: '15' }));
    expect(r.ok && r.value.reward_value).toBe(15);
  });

  it('valor em MT vira centavos, sem float', () => {
    const r = buildCouponRow(coupon({ rewardType: 'discount_cents', valueMT: '150,50' }));
    expect(r.ok && r.value.reward_value).toBe(15050);
    expect(buildCouponRow(coupon({ rewardType: 'discount_cents', valueMT: '0' })).ok).toBe(false);
  });

  it('produto grátis exige o produto', () => {
    expect(buildCouponRow(coupon({ rewardType: 'free_item' })).ok).toBe(false);
    const r = buildCouponRow(coupon({ rewardType: 'free_item', giftItemId: 'item-1' }));
    expect(r.ok && r.value.gift_item_id).toBe('item-1');
    expect(r.ok && r.value.reward_value).toBe(0);
  });

  it('2x1 não leva valor nem produto', () => {
    const r = buildCouponRow(coupon({ rewardType: 'bogo', pct: 'x' }));
    expect(r.ok && r.value).toMatchObject({ reward_type: 'bogo', reward_value: 0, gift_item_id: null });
  });

  it('a validade vale o dia inteiro escolhido, em Maputo', () => {
    const r = buildCouponRow(coupon({ expiresOn: '2026-10-15' }));
    expect(r.ok && r.value.expires_at).toBe('2026-10-15T22:00:00.000Z');
  });

  it('loja vazia = todas as lojas', () => {
    expect(buildCouponRow(coupon()).ok && (buildCouponRow(coupon()) as { value: { store_id: null } }).value.store_id).toBeNull();
    const r = buildCouponRow(coupon({ storeId: 'loja-1' }));
    expect(r.ok && r.value.store_id).toBe('loja-1');
  });

  it('máximo de utilizações pelo menos 1', () => {
    expect(buildCouponRow(coupon({ maxRedemptions: '0' })).ok).toBe(false);
  });
});

const promo = (patch: Partial<PromotionDraft> = {}): PromotionDraft => ({
  active: true,
  label: '2x1 às terças',
  weekdays: [2],
  sameItemOnly: true,
  minMT: '',
  startsOn: '',
  endsOn: '',
  ...patch,
});

describe('buildPromotionRow', () => {
  it('liga um 2x1 às terças', () => {
    const r = buildPromotionRow('s1', 'bogo', promo());
    expect(r.ok && r.value).toMatchObject({ store_id: 's1', kind: 'bogo', active: true, weekdays: [2], min_subtotal_cents: null });
  });

  it('ligada sem dias é recusada; desligada pode ficar sem dias', () => {
    expect(buildPromotionRow('s1', 'bogo', promo({ weekdays: [] })).ok).toBe(false);
    expect(buildPromotionRow('s1', 'bogo', promo({ weekdays: [], active: false })).ok).toBe(true);
  });

  it('dias sem repetidos e por ordem', () => {
    const r = buildPromotionRow('s1', 'bogo', promo({ weekdays: [5, 2, 5] }));
    expect(r.ok && r.value.weekdays).toEqual([2, 5]);
  });

  it('entrega grátis ligada exige o mínimo, em centavos', () => {
    expect(buildPromotionRow('s1', 'free_delivery', promo({ minMT: '' })).ok).toBe(false);
    const r = buildPromotionRow('s1', 'free_delivery', promo({ minMT: '1500' }));
    expect(r.ok && r.value.min_subtotal_cents).toBe(150000);
  });

  it('datas em Maputo: início à meia-noite, fim exclusivo no dia seguinte', () => {
    const r = buildPromotionRow('s1', 'bogo', promo({ startsOn: '2026-10-01', endsOn: '2026-10-31' }));
    expect(r.ok && r.value.starts_at).toBe('2026-09-30T22:00:00.000Z');
    expect(r.ok && r.value.ends_at).toBe('2026-10-31T22:00:00.000Z');
    expect(buildPromotionRow('s1', 'bogo', promo({ startsOn: '2026-10-31', endsOn: '2026-10-01' })).ok).toBe(false);
  });
});

describe('datas de Maputo', () => {
  it('ida e volta do dia de fim', () => {
    expect(maputoDayStart('2026-10-01')).toBe('2026-09-30T22:00:00.000Z');
    expect(maputoDateInput(maputoDayEnd('2026-10-31'), true)).toBe('2026-10-31');
    expect(maputoDateInput(maputoDayStart('2026-10-01'))).toBe('2026-10-01');
    expect(maputoDateInput(null)).toBe('');
  });
});

describe('textos', () => {
  it('descreve cada tipo de cupão', () => {
    expect(describeCoupon({ reward_type: 'discount_pct', reward_value: 10 })).toBe('−10%');
    expect(describeCoupon({ reward_type: 'discount_cents', reward_value: 10000 })).toMatch(/100.*MT/);
    expect(describeCoupon({ reward_type: 'free_item', reward_value: 0 }, 'Batata')).toBe('Grátis: Batata');
    expect(describeCoupon({ reward_type: 'bogo', reward_value: 0 })).toMatch(/2x1/);
  });

  it('resume os dias', () => {
    expect(describeWeekdays([0, 1, 2, 3, 4, 5, 6])).toBe('Todos os dias');
    expect(describeWeekdays([5, 2])).toBe('Ter, Sex');
    expect(describeWeekdays([])).toBe('Nenhum dia');
  });
});
