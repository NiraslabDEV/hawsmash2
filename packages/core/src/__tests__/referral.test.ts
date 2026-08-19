import { describe, it, expect } from 'vitest';

// ─── Tipos que espelham o schema (CLAUDE.md §19) ─────────────────────────────

type RewardType = 'discount_cents' | 'discount_pct' | 'free_item';

interface ReferralCode {
  id: string;
  code: string;
  owner_phone: string | null;
  reward_type: RewardType;
  reward_value: number;
  gift_item_id: string | null;
  max_redemptions: number;
  active: boolean;
  expires_at: Date | null;
}

interface Redemption {
  code_id: string;
  customer_phone: string;
}

// ─── Lógica pura replicada do create_order (passo 7+9) ──────────────────────

interface ValidateResult {
  ok: boolean;
  reason?: string;
  discount?: number;
  gift_item_id?: string | null;
}

function validateReferral(
  code: string | null | undefined,
  customerPhone: string,
  codes: ReferralCode[],
  redemptions: Redemption[],
  now: Date = new Date(),
): ValidateResult {
  if (!code) return { ok: true, discount: 0, gift_item_id: null };

  const rc = codes.find(
    c =>
      c.code === code.toUpperCase().trim() &&
      c.active &&
      (c.expires_at === null || c.expires_at > now),
  );

  if (!rc) return { ok: false, reason: 'referral_invalid_or_expired' };

  if (rc.owner_phone !== null && rc.owner_phone === customerPhone)
    return { ok: false, reason: 'referral_auto_redemption' };

  if (redemptions.some(r => r.code_id === rc.id && r.customer_phone === customerPhone))
    return { ok: false, reason: 'referral_already_redeemed' };

  const redeemed = redemptions.filter(r => r.code_id === rc.id).length;
  if (redeemed >= rc.max_redemptions)
    return { ok: false, reason: 'referral_max_redemptions' };

  if (rc.reward_type === 'free_item')
    return { ok: true, discount: 0, gift_item_id: rc.gift_item_id };

  return { ok: true, discount: 0, gift_item_id: null, reason: rc.reward_type };
}

function applyDiscount(
  rc: ReferralCode,
  subtotalCents: number,
): number {
  if (rc.reward_type === 'discount_cents')
    return Math.min(rc.reward_value, subtotalCents);
  if (rc.reward_type === 'discount_pct')
    return Math.floor(subtotalCents * rc.reward_value / 100);
  return 0; // free_item
}

// ─── Fixture base ─────────────────────────────────────────────────────────────

const BASE_CODE: ReferralCode = {
  id:               'code-1',
  code:             'AMIGO10',
  owner_phone:      '841000000',
  reward_type:      'discount_cents',
  reward_value:     1000,      // 10 MT
  gift_item_id:     null,
  max_redemptions:  1,
  active:           true,
  expires_at:       null,
};

const GIFT_CODE: ReferralCode = {
  id:               'code-2',
  code:             'BRINDE',
  owner_phone:      '841000001',
  reward_type:      'free_item',
  reward_value:     0,
  gift_item_id:     'item-gift-uuid',
  max_redemptions:  5,
  active:           true,
  expires_at:       null,
};

const PCT_CODE: ReferralCode = {
  id:               'code-3',
  code:             'DESC20',
  owner_phone:      null,
  reward_type:      'discount_pct',
  reward_value:     20,        // 20%
  gift_item_id:     null,
  max_redemptions:  100,
  active:           true,
  expires_at:       null,
};

// ─── Testes ──────────────────────────────────────────────────────────────────

describe('referral validation', () => {
  it('rejeita auto-resgate (owner usa o próprio código)', () => {
    const result = validateReferral('AMIGO10', '841000000', [BASE_CODE], []);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('referral_auto_redemption');
  });

  it('rejeita se o mesmo telefone já resgatou o código', () => {
    const redemptions: Redemption[] = [
      { code_id: 'code-1', customer_phone: '841999999' },
    ];
    const result = validateReferral('AMIGO10', '841999999', [BASE_CODE], redemptions);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('referral_already_redeemed');
  });

  it('rejeita se max_redemptions foi atingido', () => {
    const redemptions: Redemption[] = [
      { code_id: 'code-1', customer_phone: '841111111' }, // outro cliente já resgatou
    ];
    // max_redemptions = 1, já há 1 resgate → próximo cliente diferente é rejeitado
    const result = validateReferral('AMIGO10', '841222222', [BASE_CODE], redemptions);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('referral_max_redemptions');
  });

  it('rejeita código inativo', () => {
    const inactive = { ...BASE_CODE, active: false };
    const result = validateReferral('AMIGO10', '841999999', [inactive], []);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('referral_invalid_or_expired');
  });

  it('rejeita código expirado', () => {
    const expired = { ...BASE_CODE, expires_at: new Date('2020-01-01') };
    const result = validateReferral('AMIGO10', '841999999', [expired], []);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('referral_invalid_or_expired');
  });

  it('aceita código válido (discount_cents) e calcula desconto correto', () => {
    const result = validateReferral('AMIGO10', '841999999', [BASE_CODE], []);
    expect(result.ok).toBe(true);
    // Aplicar desconto: 10 MT de 200 MT subtotal
    const discount = applyDiscount(BASE_CODE, 20000);
    expect(discount).toBe(1000); // 10 MT
  });

  it('desconto em % calculado pelo servidor ignora valor do client', () => {
    // O client poderia enviar qualquer número; o servidor recalcula
    const discount = applyDiscount(PCT_CODE, 50000); // 500 MT subtotal
    expect(discount).toBe(10000); // 20% de 500 MT = 100 MT
  });

  it('desconto nunca negativo (discount_cents > subtotal)', () => {
    const discount = applyDiscount(BASE_CODE, 500); // 5 MT subtotal, cupom = 10 MT
    expect(discount).toBe(500); // clamp: máximo = subtotal
  });

  it('free_item devolve gift_item_id e discount = 0', () => {
    const result = validateReferral('BRINDE', '841999999', [GIFT_CODE], []);
    expect(result.ok).toBe(true);
    expect(result.gift_item_id).toBe('item-gift-uuid');
    const discount = applyDiscount(GIFT_CODE, 30000);
    expect(discount).toBe(0);
  });
});

describe('is_gift guard (server-side)', () => {
  // Simula o que create_order faz ao encontrar um item com is_gift = true

  function checkGiftItem(
    isGift: boolean,
    giftItemId: string,
    authorizedGiftItemId: string | null, // v_gift_item_id em create_order
    qty: number,
  ): { allowed: boolean; reason?: string } {
    if (!isGift) return { allowed: true };
    if (authorizedGiftItemId === null || authorizedGiftItemId !== giftItemId)
      return { allowed: false, reason: 'gift_item_not_authorized' };
    if (qty > 1)
      return { allowed: false, reason: 'gift_item_max_one' };
    return { allowed: true };
  }

  it('is_gift sem cupom → rejeitado', () => {
    const r = checkGiftItem(true, 'item-gift-uuid', null, 1);
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe('gift_item_not_authorized');
  });

  it('is_gift com cupom válido + qty 1 → permitido', () => {
    const r = checkGiftItem(true, 'item-gift-uuid', 'item-gift-uuid', 1);
    expect(r.allowed).toBe(true);
  });

  it('is_gift com cupom válido mas qty > 1 → rejeitado', () => {
    const r = checkGiftItem(true, 'item-gift-uuid', 'item-gift-uuid', 2);
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe('gift_item_max_one');
  });

  it('is_gift com cupom diferente do item → rejeitado', () => {
    const r = checkGiftItem(true, 'item-gift-uuid', 'outro-item-uuid', 1);
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe('gift_item_not_authorized');
  });
});
