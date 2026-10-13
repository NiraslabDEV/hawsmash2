/**
 * Regras do ecrã Promoções (painel). A BD volta a recusar o que aqui passar
 * mal (constraints da 1113) — isto existe para o dono ver o erro em português
 * antes de carregar em Guardar, e não um "violates check constraint".
 */
import { formatMT, type Cents } from '@delivery/core';

import { parseMTInput } from '@/lib/cash/input';

export type CouponRewardType = 'discount_pct' | 'discount_cents' | 'free_item' | 'bogo';

export const REWARD_LABEL: Record<CouponRewardType, string> = {
  discount_pct: 'Desconto %',
  discount_cents: 'Desconto em MT',
  free_item: 'Produto grátis',
  bogo: '2x1',
};

export const WEEKDAY_SHORT = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

export type CouponRow = {
  code: string;
  owner_name: string;
  owner_phone: string | null;
  reward_type: CouponRewardType;
  reward_value: number;
  gift_item_id: string | null;
  max_redemptions: number;
  active: boolean;
  expires_at: string | null;
  store_id: string | null;
};

export type CouponDraft = {
  code: string;
  ownerName: string;
  ownerPhone: string;
  rewardType: CouponRewardType;
  pct: string;
  valueMT: string;
  giftItemId: string;
  maxRedemptions: string;
  /** yyyy-mm-dd (último dia válido, em Maputo) ou '' */
  expiresOn: string;
  /** '' = todas as lojas */
  storeId: string;
};

type Result<T> = { ok: true; value: T } | { ok: false; error: string };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Início do dia em Maputo (UTC+2, sem horário de verão), em ISO UTC. */
export function maputoDayStart(date: string): string {
  return new Date(`${date}T00:00:00+02:00`).toISOString();
}

/** Fim EXCLUSIVO do dia em Maputo — a meia-noite do dia seguinte. */
export function maputoDayEnd(date: string): string {
  const start = new Date(`${date}T00:00:00+02:00`);
  return new Date(start.getTime() + 24 * 60 * 60 * 1000).toISOString();
}

/** O dia (yyyy-mm-dd, Maputo) de um instante; com `endExclusive` devolve o último dia válido. */
export function maputoDateInput(iso: string | null | undefined, endExclusive = false): string {
  if (!iso) return '';
  const t = new Date(iso).getTime() - (endExclusive ? 1 : 0) + 2 * 60 * 60 * 1000;
  return new Date(t).toISOString().slice(0, 10);
}

export function buildCouponRow(d: CouponDraft): Result<CouponRow> {
  const code = d.code.trim().toUpperCase();
  if (!/^[A-Z0-9_-]{2,40}$/.test(code)) {
    return { ok: false, error: 'O código só leva letras, números, - ou _ (2 a 40, sem espaços).' };
  }

  let reward_value = 0;
  let gift_item_id: string | null = null;
  if (d.rewardType === 'discount_pct') {
    const pct = Number(d.pct);
    if (!Number.isInteger(pct) || pct < 1 || pct > 100) return { ok: false, error: 'A percentagem vai de 1 a 100.' };
    reward_value = pct;
  } else if (d.rewardType === 'discount_cents') {
    const cents = parseMTInput(d.valueMT);
    if (cents === null || cents <= 0) return { ok: false, error: 'Indica o valor do desconto em MT.' };
    reward_value = cents;
  } else if (d.rewardType === 'free_item') {
    if (!d.giftItemId) return { ok: false, error: 'Escolhe o produto que sai grátis.' };
    gift_item_id = d.giftItemId;
  }

  const max = Number(d.maxRedemptions);
  if (!Number.isInteger(max) || max < 1) return { ok: false, error: 'O máximo de utilizações é pelo menos 1.' };

  if (d.expiresOn && !DATE_RE.test(d.expiresOn)) return { ok: false, error: 'Data de validade inválida.' };

  return {
    ok: true,
    value: {
      code,
      owner_name: d.ownerName.trim(),
      owner_phone: d.ownerPhone.trim() || null,
      reward_type: d.rewardType,
      reward_value,
      gift_item_id,
      max_redemptions: max,
      active: true,
      // Vale o dia inteiro escolhido, em Maputo.
      expires_at: d.expiresOn ? maputoDayEnd(d.expiresOn) : null,
      store_id: d.storeId || null,
    },
  };
}

/** O benefício de um cupão, numa palavra — para a lista e para o talão do painel. */
export function describeCoupon(
  c: { reward_type: CouponRewardType; reward_value: number },
  giftName?: string | null,
): string {
  if (c.reward_type === 'discount_pct') return `−${c.reward_value}%`;
  if (c.reward_type === 'discount_cents') return `−${formatMT(c.reward_value as Cents)}`;
  if (c.reward_type === 'bogo') return '2x1 (leve o 2.º grátis)';
  return `Grátis: ${giftName ?? 'produto'}`;
}

export type PromotionKind = 'bogo' | 'free_delivery';

export type PromotionRow = {
  store_id: string;
  kind: PromotionKind;
  active: boolean;
  label: string;
  weekdays: number[];
  same_item_only: boolean;
  include_counter: boolean;
  min_subtotal_cents: number | null;
  starts_at: string | null;
  ends_at: string | null;
};

export type PromotionDraft = {
  active: boolean;
  label: string;
  weekdays: number[];
  sameItemOnly: boolean;
  /** Também no balcão (POS) e pedidos QR de mesa. */
  includeCounter?: boolean;
  minMT: string;
  startsOn: string;
  endsOn: string;
};

export function buildPromotionRow(storeId: string, kind: PromotionKind, d: PromotionDraft): Result<PromotionRow> {
  const label = d.label.trim();
  if (label.length > 120) return { ok: false, error: 'A frase da promoção tem no máximo 120 caracteres.' };
  const weekdays = Array.from(new Set(d.weekdays)).filter((w) => w >= 0 && w <= 6).sort((a, b) => a - b);
  if (d.active && weekdays.length === 0) return { ok: false, error: 'Marca pelo menos um dia da semana.' };

  let min: number | null = null;
  if (kind === 'free_delivery') {
    min = d.minMT.trim() ? parseMTInput(d.minMT) : null;
    if (d.minMT.trim() && min === null) return { ok: false, error: 'Valor mínimo inválido.' };
    if (d.active && (!min || min <= 0)) return { ok: false, error: 'Indica a partir de quanto a entrega é grátis.' };
  }

  if ((d.startsOn && !DATE_RE.test(d.startsOn)) || (d.endsOn && !DATE_RE.test(d.endsOn))) {
    return { ok: false, error: 'Data inválida.' };
  }
  const starts_at = d.startsOn ? maputoDayStart(d.startsOn) : null;
  const ends_at = d.endsOn ? maputoDayEnd(d.endsOn) : null;
  if (starts_at && ends_at && ends_at <= starts_at) return { ok: false, error: 'O fim tem de ser depois do início.' };

  return {
    ok: true,
    value: {
      store_id: storeId,
      kind,
      active: d.active,
      label,
      weekdays,
      same_item_only: d.sameItemOnly,
      include_counter: Boolean(d.includeCounter),
      min_subtotal_cents: min,
      starts_at,
      ends_at,
    },
  };
}

/** "Ter, Sex" / "Todos os dias" — resumo dos dias numa linha. */
export function describeWeekdays(days: number[]): string {
  const sorted = Array.from(new Set(days)).sort((a, b) => a - b);
  if (sorted.length === 7) return 'Todos os dias';
  if (sorted.length === 0) return 'Nenhum dia';
  return sorted.map((d) => WEEKDAY_SHORT[d]).join(', ');
}
