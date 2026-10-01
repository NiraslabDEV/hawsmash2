'use client';

import { useEffect, useState } from 'react';
import { formatMT, type Cents } from '@delivery/core';

import { createClient } from '@/utils/supabase/client';

type PromoFields = {
  discount_cents: number;
  bogo_discount_cents: number;
  bogo_free_item: string | null;
  delivery_discount_cents: number;
  manual_discount_cents: number;
  discount_reason: string | null;
  referral_code: string | null;
};

const money = (c: number) => formatMT(c as Cents);

/**
 * De onde veio cada abatimento do pedido (1113): 2x1, cupão, entrega grátis.
 *
 * Sem isto o detalhe mostrava um TOTAL mais baixo que subtotal + entrega e
 * mais nada — ao balcão, ninguém conseguia explicar ao cliente porquê. Lê à
 * parte, ao abrir o pedido, para não mexer na `get_orders`. Sem a 1113 aplicada
 * não mostra nada (best-effort).
 */
export function OrderPromoLines({ orderId }: { orderId: string }) {
  const [p, setP] = useState<PromoFields | null>(null);

  useEffect(() => {
    let alive = true;
    void createClient()
      .from('orders')
      .select('discount_cents,bogo_discount_cents,bogo_free_item,delivery_discount_cents,manual_discount_cents,discount_reason,referral_code')
      .eq('id', orderId)
      .maybeSingle()
      .then(({ data, error }) => {
        if (alive && !error && data) setP(data as PromoFields);
      });
    return () => {
      alive = false;
    };
  }, [orderId]);

  if (!p) return null;
  const coupon = p.discount_cents - p.bogo_discount_cents - p.manual_discount_cents;
  const green = 'flex justify-between text-emerald-300';

  return (
    <>
      {p.bogo_discount_cents > 0 && (
        <div className={green}><span>2x1{p.bogo_free_item ? ` — ${p.bogo_free_item} grátis` : ''}</span><span>− {money(p.bogo_discount_cents)}</span></div>
      )}
      {coupon > 0 && (
        <div className={green}><span>Cupão {p.referral_code ?? ''}</span><span>− {money(coupon)}</span></div>
      )}
      {p.referral_code && coupon <= 0 && p.bogo_discount_cents === 0 && (
        <div className="text-xs text-[#8A7A69]">Cupão {p.referral_code} usado — sem abatimento neste pedido.</div>
      )}
      {p.manual_discount_cents > 0 && (
        <div className={green}><span>Desconto manual{p.discount_reason ? ` — ${p.discount_reason}` : ''}</span><span>− {money(p.manual_discount_cents)}</span></div>
      )}
      {p.delivery_discount_cents > 0 && (
        <div className={green}><span>Entrega grátis (promo)</span><span>− {money(p.delivery_discount_cents)}</span></div>
      )}
    </>
  );
}
