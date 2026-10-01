'use client';

/**
 * Promoções — descontos, 2x1, entrega grátis e cupões (1113).
 *
 * Só o dono (promoção mexe no preço, CLAUDE §6). O que aqui se grava é regra;
 * a conta de cada pedido é feita no create_order, nunca no browser.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { formatMT, type Cents } from '@delivery/core';

import { createClient } from '@/utils/supabase/client';

import { CouponsSection } from './coupons-section';
import { RulesSection } from './rules-section';

type Store = { id: string; short_name: string };

type Summary = {
  orders: number;
  promo_orders: number;
  bogo_orders: number;
  bogo_discount_cents: number;
  coupon_orders: number;
  coupon_discount_cents: number;
  free_delivery_orders: number;
  free_delivery_cents: number;
  manual_orders?: number;
  manual_discount_cents?: number;
  promo_revenue_cents: number;
};

type DiscountedOrder = {
  id: string;
  order_number: string;
  created_at: string;
  status: string;
  total_cents: number;
  discount_cents: number;
  bogo_discount_cents: number;
  bogo_free_item: string | null;
  delivery_discount_cents: number;
  manual_discount_cents: number;
  discount_reason: string | null;
  channel: string;
  referral_code: string | null;
};

const mt = (c: number) => formatMT(c as Cents);

export default function PromocoesPage() {
  const supabase = useMemo(() => createClient(), []);
  const [stores, setStores] = useState<Store[]>([]);
  const [storeId, setStoreId] = useState<string | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [orders, setOrders] = useState<DiscountedOrder[]>([]);

  useEffect(() => {
    void supabase
      .from('stores')
      .select('id,short_name')
      .eq('active', true)
      .order('sort')
      .then(({ data }) => {
        const list = (data ?? []) as Store[];
        setStores(list);
        setStoreId((cur) => cur ?? list[0]?.id ?? null);
      });
  }, [supabase]);

  const loadActivity = useCallback(async () => {
    if (!storeId) return;
    const [sumRes, ordersRes] = await Promise.all([
      supabase.rpc('get_promotions_summary', { p_store_id: storeId }),
      supabase
        .from('orders')
        .select('id,order_number,created_at,status,total_cents,discount_cents,bogo_discount_cents,bogo_free_item,delivery_discount_cents,manual_discount_cents,discount_reason,channel,referral_code')
        .eq('store_id', storeId)
        .or('discount_cents.gt.0,delivery_discount_cents.gt.0,referral_code.not.is.null')
        .order('created_at', { ascending: false })
        .limit(30),
    ]);
    setSummary(sumRes.error ? null : (sumRes.data as Summary));
    setOrders(ordersRes.error ? [] : ((ordersRes.data ?? []) as DiscountedOrder[]));
  }, [storeId, supabase]);

  useEffect(() => {
    void loadActivity();
  }, [loadActivity]);

  const store = stores.find((s) => s.id === storeId);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-white">Promoções</h1>
          <p className="text-sm text-[#8b8378]">
            2x1, entrega grátis e cupões — no site e no caixa do POS. O desconto é sempre calculado pelo servidor no momento do pedido.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {stores.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setStoreId(s.id)}
              className={`rounded-xl border px-4 py-2 text-sm font-bold transition ${s.id === storeId ? 'border-[#e5a93c] bg-[#e5a93c] text-black' : 'border-white/10 text-[#C9BCAC]'}`}
            >
              {s.short_name}
            </button>
          ))}
        </div>
      </header>

      {summary && (
        <section className="grid grid-cols-2 gap-3 md:grid-cols-5">
          <Stat label="Pedidos com promoção (30 dias)" value={`${summary.promo_orders} de ${summary.orders}`} />
          <Stat label={`2x1 · ${summary.bogo_orders} pedidos`} value={mt(summary.bogo_discount_cents)} />
          <Stat label={`Cupões · ${summary.coupon_orders} pedidos`} value={mt(summary.coupon_discount_cents)} />
          <Stat label={`Entrega grátis · ${summary.free_delivery_orders}`} value={mt(summary.free_delivery_cents)} />
          <Stat label={`Desconto manual (balcão) · ${summary.manual_orders ?? 0}`} value={mt(summary.manual_discount_cents ?? 0)} />
        </section>
      )}

      {storeId && store && <RulesSection storeId={storeId} storeName={store.short_name} onSaved={() => void loadActivity()} />}

      <CouponsSection stores={stores} />

      <section className="rounded-2xl border border-white/[0.08] p-5">
        <h3 className="text-lg font-black text-white">O que saiu com desconto{store ? ` · ${store.short_name}` : ''}</h3>
        <p className="mb-3 text-xs text-[#8b8378]">Os últimos 30 pedidos (site e balcão) com 2x1, cupão, desconto manual ou entrega grátis.</p>
        {orders.length === 0 ? (
          <p className="text-sm text-[#6f6a62]">Ainda não há pedidos com promoção nesta loja.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/[0.08] text-left text-[#8b8378]">
                  <th className="px-3 py-2 font-medium">Quando</th>
                  <th className="px-3 py-2 font-medium">Pedido</th>
                  <th className="px-3 py-2 font-medium">Promoção</th>
                  <th className="px-3 py-2 text-right font-medium">Abatido</th>
                  <th className="px-3 py-2 text-right font-medium">Total</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((o) => (
                  <tr key={o.id} className={`border-b border-white/[0.04] ${o.status === 'cancelled' ? 'text-[#6f6a62] line-through' : 'text-[#e8e2d9]'}`}>
                    <td className="whitespace-nowrap px-3 py-2 text-[#8b8378]">
                      {new Date(o.created_at).toLocaleString('pt-PT', { timeZone: 'Africa/Maputo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                    </td>
                    <td className="px-3 py-2 font-mono">{o.order_number}</td>
                    <td className="px-3 py-2">{describeOrderPromo(o)}</td>
                    <td className="px-3 py-2 text-right">{mt(o.discount_cents + o.delivery_discount_cents)}</td>
                    <td className="px-3 py-2 text-right font-bold">{mt(o.total_cents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function describeOrderPromo(o: DiscountedOrder): string {
  const parts: string[] = [];
  if (o.bogo_discount_cents > 0) parts.push(`2x1${o.bogo_free_item ? ` (${o.bogo_free_item})` : ''}`);
  if (o.referral_code) {
    const coupon = o.discount_cents - o.bogo_discount_cents - o.manual_discount_cents;
    parts.push(coupon > 0 ? `Cupão ${o.referral_code}` : `Cupão ${o.referral_code} (sem abatimento)`);
  }
  if (o.manual_discount_cents > 0) parts.push(`Desconto manual${o.discount_reason ? ` (${o.discount_reason})` : ''}`);
  if (o.delivery_discount_cents > 0) parts.push('Entrega grátis');
  if (o.channel === 'counter') parts.push('balcão');
  return parts.join(' · ') || '—';
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/[0.08] bg-white/[0.03] p-4">
      <p className="text-xl font-black text-white">{value}</p>
      <p className="text-[11px] text-[#8b8378]">{label}</p>
    </div>
  );
}
