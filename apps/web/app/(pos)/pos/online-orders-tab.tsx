'use client';

import { useState } from 'react';
import { formatMT, type Cents } from '@delivery/core';
import {
  canDecide,
  fulfillmentLabel,
  paymentLabel,
  type BoardOrder,
} from '@/lib/pos/orders-board';
import type { DeliveryZoneOption } from '@/lib/pos/order-edit';
import { DetalhePedido } from './orders-board';
import { OrderDecision } from './order-decision';

export type OnlineOrder = BoardOrder & { items: Array<{ id: string; name: string; qty: number }> };

const STATUS_META: Record<string, { label: string; className: string }> = {
  awaiting_approval: { label: 'Novo', className: 'bg-amber-500/15 text-amber-300' },
  awaiting_payment: { label: 'A pagar', className: 'bg-blue-500/15 text-blue-300' },
  paid: { label: 'Pago', className: 'bg-blue-500/15 text-blue-300' },
  approved: { label: 'Aceite', className: 'bg-emerald-500/15 text-emerald-300' },
  in_preparation: { label: 'Em preparo', className: 'bg-orange-500/15 text-orange-300' },
  ready: { label: 'Pronto', className: 'bg-purple-500/15 text-purple-300' },
};

const mt = (value: number) => formatMT(value as Cents);

/**
 * A aba Delivery do POS: tudo o que chegou da internet — entrega e
 * levantamento — com Aprovar e Recusar no próprio cartão.
 *
 * É a porta de entrada do fluxo: o que se aprova aqui aparece no quadro de
 * Pedidos em A FAZER. Tocar no cartão abre a conferência (itens, morada e
 * comprovativo) com os mesmos dois botões.
 */
export function OnlineOrdersTab({
  storeName,
  orders,
  loading,
  error,
  zones,
  closesAt,
  onRefresh,
}: {
  storeName: string;
  orders: OnlineOrder[];
  loading: boolean;
  error: string | null;
  zones: DeliveryZoneOption[];
  closesAt: string | null;
  onRefresh: () => void;
}) {
  const [aberto, setAberto] = useState<string | null>(null);
  const [erroDecisao, setErroDecisao] = useState<string | null>(null);
  const abertoAtual = aberto ? orders.find((o) => o.id === aberto) ?? null : null;
  const porDecidir = orders.filter(canDecide).length;

  function decidido() {
    setErroDecisao(null);
    setAberto(null);
    onRefresh();
  }

  function falhou({ texto, mudouDeEstado }: { texto: string; mudouDeEstado: boolean }) {
    setErroDecisao(texto);
    if (mudouDeEstado) setAberto(null);
    onRefresh();
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-xl font-bold">Pedidos da internet · {storeName}</h2>
          <p className="text-sm text-ink-mute">
            Entrega e levantamento{porDecidir > 0 ? ` · ${porDecidir} por aprovar` : ''}
          </p>
        </div>
        <button
          type="button"
          onClick={onRefresh}
          disabled={loading}
          className="min-h-12 shrink-0 rounded-xl bg-white/[0.07] px-4 text-sm font-bold active:bg-white/15 disabled:opacity-40"
        >
          {loading ? 'A actualizar…' : 'Actualizar'}
        </button>
      </div>
      {error && <p role="alert" className="rounded-xl border border-amber-400/30 p-3 text-sm text-amber-200">{error}</p>}
      {erroDecisao && !abertoAtual && (
        <p role="alert" className="rounded-xl border border-red-500/40 bg-red-500/15 p-3 text-base font-bold text-red-100">
          {erroDecisao}
        </p>
      )}
      {orders.length === 0 && !loading && !error && (
        <p className="rounded-2xl border border-white/[0.07] bg-bg2 p-6 text-center text-ink-mute">
          Sem pedidos da internet neste momento.
        </p>
      )}
      {orders.map((order) => {
        const meta =
          STATUS_META[order.status] ?? ({ label: order.status, className: 'bg-white/10 text-white' } as const);
        const decidir = canDecide(order);
        const numero = String(order.daily_number ?? order.order_number);
        return (
          <div
            key={order.id}
            className={`rounded-2xl border p-4 ${
              decidir ? 'border-violet-500/40 bg-violet-500/[0.07]' : 'border-white/[0.07] bg-bg2'
            }`}
          >
            <button
              type="button"
              onClick={() => {
                setErroDecisao(null);
                setAberto(order.id);
              }}
              aria-label={`Ver detalhe do pedido ${numero}`}
              className="block w-full text-left"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-lg font-bold">
                    #{numero} · {order.customer_name}
                  </p>
                  <p className="text-[11px] font-bold tracking-[0.15em] text-ink-dim">
                    {fulfillmentLabel(order)} · {paymentLabel(order)}
                  </p>
                  <p className="truncate text-sm text-ink-mute">
                    {order.customer_phone}
                    {order.fulfillment_type === 'delivery' && order.address ? ` · ${order.address}` : ''}
                  </p>
                </div>
                <span className={`shrink-0 rounded-full px-3 py-1 text-xs font-bold uppercase ${meta.className}`}>
                  {meta.label}
                </span>
              </div>
              <p className="mt-2 text-sm text-ink-dim">
                {order.items.map((it) => `${it.qty}× ${it.name}`).join(', ')}
              </p>
              <div className="mt-2 flex items-center justify-between gap-3">
                <p className="text-lg font-bold text-gold">{mt(order.total_cents)}</p>
                {decidir && order.flow !== 'digital' && (
                  <p className="text-xs font-bold tracking-[0.15em] text-gold">
                    {order.payment_proof_path ? '📎 VER COMPROVATIVO' : 'SEM COMPROVATIVO'}
                  </p>
                )}
              </div>
            </button>
            {decidir && (
              <div className="mt-3">
                <OrderDecision orderId={order.id} numero={numero} onDone={decidido} onError={falhou} />
              </div>
            )}
          </div>
        );
      })}

      {abertoAtual && (
        <DetalhePedido
          order={abertoAtual}
          zones={zones}
          closesAt={closesAt}
          onAlterado={onRefresh}
          erro={erroDecisao}
          onFechar={() => {
            setErroDecisao(null);
            setAberto(null);
          }}
          onDecidido={decidido}
          onErroDecisao={falhou}
        />
      )}
    </div>
  );
}
