'use client';

import { formatMT, type Cents, type PromotionResult } from '@delivery/core';

import type { PosCoupon } from '@/lib/pos/promotions';

const mt = (value: number) => formatMT(value as Cents);

/**
 * Descontos no ecrã de pagamento do POS (1113): cupão, promoções da loja e
 * desconto manual. Só mostra e recolhe — a conta é do servidor.
 *
 * O desconto manual só aparece a gerente/dono (a BD recusa a quem não é). O
 * cupão pede o telefone: cada pessoa usa cada código uma vez.
 */
export function DiscountPanel({
  promo,
  coupon,
  couponCode,
  couponError,
  couponBusy,
  online,
  hasPhone,
  canManual,
  manualType,
  manualValue,
  manualReason,
  manualError,
  onEditCoupon,
  onApplyCoupon,
  onRemoveCoupon,
  onEditPhone,
  onManualType,
  onEditManualValue,
  onEditManualReason,
  onClearManual,
}: {
  promo: PromotionResult;
  coupon: PosCoupon | null;
  couponCode: string;
  couponError: string | null;
  couponBusy: boolean;
  online: boolean;
  hasPhone: boolean;
  canManual: boolean;
  manualType: 'pct' | 'cents';
  manualValue: string;
  manualReason: string;
  manualError: string | null;
  onEditCoupon: () => void;
  onApplyCoupon: () => void;
  onRemoveCoupon: () => void;
  onEditPhone: () => void;
  onManualType: (type: 'pct' | 'cents') => void;
  onEditManualValue: () => void;
  onEditManualReason: () => void;
  onClearManual: () => void;
}) {
  return (
    <div className="pos-card !p-4 space-y-3">
      <p className="pos-eyebrow">DESCONTOS</p>

      {promo.bogoDiscountCents > 0 && (
        <p className="flex items-baseline justify-between gap-3 text-[0.9375rem] font-semibold text-emerald-300">
          <span>2x1 — {promo.bogoFreeItem} grátis</span>
          <span className="pos-num">− {mt(promo.bogoDiscountCents)}</span>
        </p>
      )}
      {promo.bogoOneAway && (
        <p className="pos-note pos-note--warn">2x1: mais um igual e o segundo sai grátis.</p>
      )}
      {promo.deliveryDiscountCents > 0 && (
        <p className="flex items-baseline justify-between gap-3 text-[0.9375rem] font-semibold text-emerald-300">
          <span>Entrega grátis</span>
          <span className="pos-num">− {mt(promo.deliveryDiscountCents)}</span>
        </p>
      )}

      {/* Cupão */}
      {coupon ? (
        <div className="flex items-center justify-between gap-3">
          <span className="min-w-0 text-[0.9375rem] font-semibold text-emerald-300">
            Cupão <span className="pos-num">{coupon.code}</span>
            {coupon.type === 'free_item' && coupon.giftName ? ` — ${coupon.giftName} grátis` : ''}
            {coupon.type === 'bogo' ? ' — 2x1' : ''}
          </span>
          <span className="pos-num shrink-0 text-emerald-300">
            {promo.couponDiscountCents > 0 ? `− ${mt(promo.couponDiscountCents)}` : ''}
          </span>
          <button type="button" onClick={onRemoveCoupon} className="pos-btn pos-btn--quiet !min-h-11 !px-3 text-sm">Tirar</button>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="grid grid-cols-[1fr_auto] gap-2">
            <button type="button" onClick={onEditCoupon} disabled={!online} className="pos-choice !min-h-14 !justify-start !px-4 !text-base">
              {couponCode ? <span className="pos-num">{couponCode}</span> : <span className="opacity-70">Código de cupão</span>}
            </button>
            <button
              type="button"
              onClick={onApplyCoupon}
              disabled={!online || couponBusy || !couponCode.trim()}
              className="pos-choice !min-h-14 !px-5 !text-base"
            >
              {couponBusy ? '…' : 'Aplicar'}
            </button>
          </div>
          {!online && <p className="text-xs text-ink-dim">Cupões precisam de rede para validar.</p>}
          {couponCode && !hasPhone && (
            <button type="button" onClick={onEditPhone} className="pos-note pos-note--warn w-full text-left">
              Cupão no balcão pede o telefone do cliente — tocar para escrever.
            </button>
          )}
          {couponError && <p role="alert" className="pos-note pos-note--danger">{couponError}</p>}
        </div>
      )}

      {/* Desconto manual */}
      {canManual && (
        <div className="space-y-2 border-t border-white/[0.07] pt-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-semibold">Desconto do gerente</span>
            <div className="flex gap-1">
              {(['pct', 'cents'] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  aria-pressed={manualType === t}
                  onClick={() => onManualType(t)}
                  className="pos-choice !min-h-11 !px-4 !text-sm"
                >
                  {t === 'pct' ? '%' : 'MT'}
                </button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-[7rem_1fr] gap-2">
            <button type="button" onClick={onEditManualValue} className="pos-choice !min-h-14 !justify-start !px-4 !text-base">
              {manualValue ? <span className="pos-num">{manualValue}{manualType === 'pct' ? '%' : ' MT'}</span> : <span className="opacity-70">Valor</span>}
            </button>
            <button type="button" onClick={onEditManualReason} className="pos-choice !min-h-14 !justify-start !px-4 !text-base">
              {manualReason ? <span className="truncate">{manualReason}</span> : <span className="opacity-70">Motivo (obrigatório)</span>}
            </button>
          </div>
          {promo.manualDiscountCents > 0 && (
            <p className="flex items-baseline justify-between gap-3 text-[0.9375rem] font-semibold text-emerald-300">
              <span>Desconto manual</span>
              <span className="pos-num">− {mt(promo.manualDiscountCents)}</span>
            </p>
          )}
          {manualError && <p role="alert" className="pos-note pos-note--warn">{manualError}</p>}
          {(manualValue || manualReason) && (
            <button type="button" onClick={onClearManual} className="pos-btn pos-btn--quiet !min-h-11 !px-3 text-sm">Tirar desconto</button>
          )}
        </div>
      )}
    </div>
  );
}
