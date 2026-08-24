'use client';

import { useCallback, useEffect, useState } from 'react';
import { formatMT, type Cents } from '@delivery/core';
import { createClient } from '@/utils/supabase/client';
import {
  buildBoard,
  fulfillmentLabel,
  isLate,
  isScheduled,
  nextStep,
  type BoardColumn,
  type BoardOrder,
} from '@/lib/pos/orders-board';

const SELECT =
  'id,daily_number,order_number,status,channel,fulfillment_type,' +
  'customer_name,customer_phone,total_cents,scheduled_for,created_at';

/** Quanto tempo até o quadro se actualizar sozinho sem realtime (CLAUDE §11.3). */
const POLL_MS = 12_000;

const mt = (value: number) => formatMT(value as Cents);

const TONE: Record<BoardColumn['tone'], { head: string; card: string; arrow: string }> = {
  amber: {
    head: 'bg-amber-500/15 text-amber-200 border-amber-500/30',
    card: 'border-amber-500/30 bg-amber-500/[0.07]',
    arrow: 'bg-amber-400 text-black',
  },
  blue: {
    head: 'bg-sky-500/15 text-sky-200 border-sky-500/30',
    card: 'border-sky-500/30 bg-sky-500/[0.07]',
    arrow: 'bg-sky-400 text-black',
  },
  green: {
    head: 'bg-emerald-500/15 text-emerald-200 border-emerald-500/30',
    card: 'border-emerald-500/30 bg-emerald-500/[0.07]',
    arrow: 'bg-emerald-400 text-black',
  },
};

function hora(iso: string | null): string {
  if (!iso) return '';
  return new Intl.DateTimeFormat('pt-PT', {
    timeZone: 'Africa/Maputo',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(iso));
}

export function OrdersBoard({ storeId, onClose }: { storeId: string; onClose: () => void }) {
  const [supabase] = useState(() => createClient());
  const [orders, setOrders] = useState<BoardOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  /** Pedidos com um toque em curso: a seta desliga-se para não avançar dois passos. */
  const [moving, setMoving] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    const { data, error: loadError } = await supabase
      .from('orders')
      .select(SELECT)
      .eq('store_id', storeId)
      .in('status', ['awaiting_approval', 'awaiting_payment', 'approved', 'paid', 'in_preparation', 'ready'])
      .order('created_at', { ascending: true })
      .limit(120);

    if (loadError) {
      setError('Não foi possível carregar os pedidos.');
      setLoading(false);
      return;
    }
    setError(null);
    setOrders((data ?? []) as unknown as BoardOrder[]);
    setLoading(false);
  }, [storeId, supabase]);

  useEffect(() => {
    void load();
  }, [load]);

  // Polling é a base, não o remendo: se o realtime cair — ou nunca chegar a
  // ligar — o quadro continua a andar sozinho. Um pedido aprovado pelo dono no
  // email aparece aqui em 12 segundos, no pior caso.
  useEffect(() => {
    const timer = window.setInterval(() => void load(), POLL_MS);
    return () => window.clearInterval(timer);
  }, [load]);

  // Realtime por cima, e só para disparar refetch. O payload do evento nunca
  // constrói estado (CLAUDE §11.3): um pedido meio construído no ecrã é pior
  // do que um pedido que chega 12 segundos depois.
  useEffect(() => {
    const channel = supabase
      .channel(`pos-board-${storeId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'orders', filter: `store_id=eq.${storeId}` },
        () => void load(),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [load, storeId, supabase]);

  async function advance(order: BoardOrder) {
    const passo = nextStep(order.status);
    if (!passo || moving.has(order.id)) return;

    setMoving((current) => new Set(current).add(order.id));
    const { error: advanceError } = await supabase.rpc('advance_order', {
      p_order_id: order.id,
      p_event: passo.event,
    });
    setMoving((current) => {
      const next = new Set(current);
      next.delete(order.id);
      return next;
    });

    if (advanceError) {
      // Pode ter sido a cozinha a avançar o mesmo pedido primeiro. Recarregar
      // diz a verdade melhor do que qualquer mensagem que eu invente aqui.
      setError('Esse pedido já mudou de estado. Actualizei o quadro.');
      void load();
      return;
    }
    setError(null);
    void load();
  }

  const board = buildBoard(orders);
  const agora = Date.now();

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-[#0a0807] text-[#f6f1e6]">
      <header className="flex shrink-0 items-center justify-between gap-4 border-b border-white/10 px-6 py-4">
        <div>
          <p className="text-xs font-black tracking-[0.25em] text-[#847e72]">PEDIDOS</p>
          <h2 className="text-3xl font-black">
            {orders.length} {orders.length === 1 ? 'em curso' : 'em curso'}
          </h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="min-h-16 shrink-0 rounded-2xl bg-white/10 px-6 text-lg font-black active:bg-white/20"
        >
          ← Voltar a vender
        </button>
      </header>

      {error && (
        <p role="alert" className="shrink-0 bg-amber-500/10 px-6 py-3 text-base font-bold text-amber-200">
          {error}
        </p>
      )}

      <div className="grid min-h-0 flex-1 grid-cols-3 gap-3 overflow-hidden p-3">
        {board.map((coluna) => (
          <section key={coluna.id} className="flex min-h-0 flex-col">
            <h3
              className={`shrink-0 rounded-t-2xl border px-4 py-3 text-center text-sm font-black tracking-[0.2em] ${TONE[coluna.tone].head}`}
            >
              {coluna.title} · {coluna.orders.length}
            </h3>

            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto rounded-b-2xl bg-white/[0.03] p-3">
              {coluna.orders.length === 0 && (
                <p className="py-8 text-center text-sm font-bold text-[#847e72]">vazio</p>
              )}

              {coluna.orders.map((order) => {
                const passo = nextStep(order.status);
                const atrasado = isLate(order, agora);
                const aMexer = moving.has(order.id);
                return (
                  <article
                    key={order.id}
                    className={`rounded-2xl border p-3 ${TONE[coluna.tone].card} ${
                      atrasado ? 'ring-2 ring-red-500' : ''
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-3xl font-black leading-none">
                          {order.daily_number ?? '—'}
                        </p>
                        <p className="mt-1 text-[11px] font-black tracking-[0.15em] text-[#c8bfb0]">
                          {fulfillmentLabel(order)}
                        </p>
                      </div>
                      <p className="shrink-0 text-right text-base font-black text-[#e5a93c]">
                        {mt(order.total_cents)}
                      </p>
                    </div>

                    {order.customer_name && (
                      <p className="mt-2 truncate text-sm font-bold">{order.customer_name}</p>
                    )}
                    {order.customer_phone && (
                      <p className="truncate text-xs text-[#847e72]">{order.customer_phone}</p>
                    )}

                    {/* A hora marcada só aparece quando existe e é para mais
                        tarde. Um "agora" escrito em todos os cartões deixa de
                        se ver, e é justamente o que não pode passar despercebido. */}
                    {isScheduled(order, agora) && (
                      <p className="mt-2 rounded-lg bg-black/30 px-2 py-1 text-center text-sm font-black">
                        {hora(order.scheduled_for)}
                      </p>
                    )}
                    {atrasado && (
                      <p className="mt-2 rounded-lg bg-red-500/20 px-2 py-1 text-center text-sm font-black text-red-200">
                        ATRASADO · {hora(order.scheduled_for)}
                      </p>
                    )}

                    {passo && (
                      <button
                        type="button"
                        disabled={aMexer}
                        onClick={() => void advance(order)}
                        aria-label={`${passo.label} — pedido ${order.daily_number ?? order.order_number}`}
                        className={`mt-3 flex min-h-16 w-full items-center justify-center gap-2 rounded-xl text-lg font-black active:scale-[0.98] disabled:opacity-40 ${TONE[coluna.tone].arrow}`}
                      >
                        {aMexer ? '…' : `${passo.label} →`}
                      </button>
                    )}
                  </article>
                );
              })}
            </div>
          </section>
        ))}
      </div>

      {loading && (
        <p className="shrink-0 border-t border-white/10 px-6 py-3 text-sm text-[#847e72]">
          A carregar pedidos…
        </p>
      )}
    </div>
  );
}
