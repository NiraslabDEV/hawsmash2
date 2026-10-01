/**
 * Descontos no caixa do POS (1113): cupão, promoções "também no balcão" e
 * desconto manual do gerente/dono.
 *
 * O servidor recalcula tudo no create_counter_sale ANTES de conferir o
 * pagamento (Regra 2). Isto é a pré-visualização — tem de dar exactamente o
 * mesmo número, senão o plano de pagamento não fecha e a venda é recusada com
 * payment_total_mismatch. Por isso usa a mesma conta (`applyPromotions`).
 */
import { applyPromotions, type PromotionResult } from '@delivery/core';

import type { CartLine } from './cart';

export type PosPromotions = {
  bogo: {
    live: boolean;
    label: string;
    same_item_only: boolean;
    include_counter?: boolean;
    item_ids: string[];
  } | null;
  free_delivery: {
    live: boolean;
    label: string;
    min_subtotal_cents: number;
    include_counter?: boolean;
  } | null;
};

/** Cupão já validado no servidor (validate_referral com a loja). */
export type PosCoupon = {
  code: string;
  type: 'discount_pct' | 'discount_cents' | 'free_item' | 'bogo';
  value: number;
  giftItemId: string | null;
  giftName?: string | null;
};

export type PosManualDiscount = { type: 'pct' | 'cents'; value: number; reason: string };

const cacheKey = (storeSlug: string) => `hs_pos_promotions:${storeSlug}`;

/** Última lista conhecida — para o POS sem rede continuar a mostrar o 2x1. */
export function readCachedPromotions(storage: Storage, storeSlug: string): PosPromotions | null {
  try {
    const raw = storage.getItem(cacheKey(storeSlug));
    return raw ? (JSON.parse(raw) as PosPromotions) : null;
  } catch {
    return null;
  }
}

export function writeCachedPromotions(storage: Storage, storeSlug: string, value: PosPromotions | null): void {
  try {
    if (value) storage.setItem(cacheKey(storeSlug), JSON.stringify(value));
  } catch {
    // Conveniência: sem cache, o POS só não mostra o 2x1 sem rede.
  }
}

export function posPromotionPreview(input: {
  lines: CartLine[];
  fulfillment: 'counter' | 'pickup' | 'delivery';
  zoneFeeCents: number;
  promotions: PosPromotions | null;
  coupon: PosCoupon | null;
  manual: PosManualDiscount | null;
}): PromotionResult {
  const bogo = input.promotions?.bogo;
  const fd = input.promotions?.free_delivery;
  const eligible = new Set(bogo?.item_ids ?? []);
  return applyPromotions({
    lines: input.lines.map((l) => ({
      itemId: l.menuItemId,
      name: l.name,
      unitPriceCents: l.price_cents,
      qty: l.qty,
      bogoEligible: eligible.has(l.menuItemId),
    })),
    fulfillment: input.fulfillment === 'delivery' ? 'delivery' : 'counter',
    deliveryFeeCents: input.fulfillment === 'delivery' ? input.zoneFeeCents : 0,
    // Só as promoções que a loja marcou "também no balcão".
    bogo: bogo && bogo.include_counter ? { live: bogo.live, sameItemOnly: bogo.same_item_only } : null,
    freeDeliveryMinCents: fd && fd.include_counter && fd.live ? fd.min_subtotal_cents : null,
    coupon: input.coupon
      ? { type: input.coupon.type, value: input.coupon.value, giftItemId: input.coupon.giftItemId }
      : null,
    manual: input.manual ? { type: input.manual.type, value: input.manual.value } : null,
  });
}

/** O que a venda leva ao servidor (e à fila offline). */
export function discountPayload(input: {
  coupon: PosCoupon | null;
  customerPhone: string;
  manual: PosManualDiscount | null;
}): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (input.coupon) {
    out.referralCode = input.coupon.code;
    if (input.customerPhone.trim()) out.customerPhone = input.customerPhone.trim();
  }
  if (input.manual) {
    out.manualDiscount = { type: input.manual.type, value: input.manual.value, reason: input.manual.reason.trim() };
  }
  return out;
}

/** Valida o desconto manual escrito no ecrã. `value` em % inteiro ou em centavos. */
export function checkManualDiscount(d: PosManualDiscount): string | null {
  if (!Number.isInteger(d.value) || d.value <= 0) return 'Indica o valor do desconto.';
  if (d.type === 'pct' && d.value > 100) return 'A percentagem vai até 100.';
  const reason = d.reason.trim();
  if (reason.length < 3) return 'Escreve o motivo (fica no registo).';
  if (reason.length > 200) return 'O motivo tem no máximo 200 caracteres.';
  return null;
}

export function couponErrorText(reason: string | undefined): string {
  switch (reason) {
    case 'auto_redemption':
    case 'referral_auto_redemption':
      return 'O dono do código não o pode usar.';
    case 'already_redeemed':
    case 'referral_already_redeemed':
      return 'Este telefone já usou este código.';
    case 'max_redemptions_reached':
    case 'referral_max_redemptions':
      return 'O código atingiu o limite de utilizações.';
    case 'wrong_store':
    case 'referral_wrong_store':
      return 'Este código não vale nesta loja.';
    case 'coupon_requires_phone':
      return 'Cupão no balcão pede o telefone do cliente.';
    default:
      return 'Código inválido ou expirado.';
  }
}
