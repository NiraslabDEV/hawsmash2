'use client';

import { useCallback, useEffect, useState } from 'react';
import { formatMT, type Cents } from '@delivery/core';
import { createClient } from '@/utils/supabase/client';
import {
  BOARD_LIMIT,
  BOARD_ORDER,
  BOARD_SELECT,
  BOARD_STATUSES,
  buildBoard,
  fulfillmentLabel,
  isLate,
  isScheduled,
  needsProofCheck,
  nextStep,
  paymentLabel,
  type BoardColumn,
  type BoardOrder,
} from '@/lib/pos/orders-board';

type OrderLine = { name_snapshot: string; qty: number; unit_price_cents: number; notes: string | null };

/** O comprovativo abre por url assinado, e só dura o tempo de o conferir. */
const PROOF_TTL_S = 600;

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
  /** O pedido aberto em detalhe — itens, pagamento e comprovativo. */
  const [aberto, setAberto] = useState<BoardOrder | null>(null);

  const load = useCallback(async () => {
    const { data, error: loadError } = await supabase
      .from('orders')
      .select(BOARD_SELECT)
      .eq('store_id', storeId)
      .in('status', BOARD_STATUSES)
      .order(BOARD_ORDER.column, { ascending: BOARD_ORDER.ascending })
      .limit(BOARD_LIMIT);

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
      setAberto(null);
      void load();
      return;
    }
    setError(null);
    setAberto(null);
    void load();
  }

  /**
   * A seta do cartão. Num pedido manual por aprovar não aprova directamente:
   * abre o comprovativo. Aprovar sem olhar para o recibo é mandar fazer comida
   * que pode não estar paga — e o botão de aprovar vive dentro da conferência.
   */
  function tocarSeta(order: BoardOrder) {
    if (needsProofCheck(order)) setAberto(order);
    else void advance(order);
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
                const conferir = needsProofCheck(order);
                return (
                  <article
                    key={order.id}
                    className={`rounded-2xl border p-3 ${TONE[coluna.tone].card} ${
                      atrasado ? 'ring-2 ring-red-500' : ''
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => setAberto(order)}
                      aria-label={`Ver detalhe do pedido ${order.daily_number ?? order.order_number}`}
                      className="block w-full text-left"
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
                    {conferir && (
                      <p className="mt-2 rounded-lg bg-black/30 px-2 py-1 text-center text-xs font-black tracking-[0.15em] text-[#e5a93c]">
                        {order.payment_proof_path ? '📎 CONFERIR COMPROVATIVO' : 'SEM COMPROVATIVO'} · {paymentLabel(order)}
                      </p>
                    )}
                    </button>

                    {passo && (
                      <button
                        type="button"
                        disabled={aMexer}
                        onClick={() => tocarSeta(order)}
                        aria-label={`${conferir ? 'Conferir' : passo.label} — pedido ${order.daily_number ?? order.order_number}`}
                        className={`mt-3 flex min-h-16 w-full items-center justify-center gap-2 rounded-xl text-lg font-black active:scale-[0.98] disabled:opacity-40 ${TONE[coluna.tone].arrow}`}
                      >
                        {aMexer ? '…' : conferir ? 'Conferir →' : `${passo.label} →`}
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

      {aberto && (
        <DetalhePedido
          order={aberto}
          aMexer={moving.has(aberto.id)}
          onFechar={() => setAberto(null)}
          onAvancar={() => void advance(aberto)}
        />
      )}
    </div>
  );
}

/**
 * A conferência de um pedido, à frente do quadro.
 *
 * Existe para o caso que manda: chegou uma encomenda da internet paga por
 * M-Pesa ou e-Mola, o cliente anexou o recibo, e quem está ao balcão tem de o
 * ver antes de aprovar. O comprovativo abre por url assinado de curta duração
 * — o bucket é privado (§17) e o caminho nunca vira endereço público.
 */
function DetalhePedido({
  order,
  aMexer,
  onFechar,
  onAvancar,
}: {
  order: BoardOrder;
  aMexer: boolean;
  onFechar: () => void;
  onAvancar: () => void;
}) {
  const [supabase] = useState(() => createClient());
  const [linhas, setLinhas] = useState<OrderLine[] | null>(null);
  const [proofUrl, setProofUrl] = useState<string | null>(null);
  const [proofErro, setProofErro] = useState(false);
  const passo = nextStep(order.status);
  const ePdf = (order.payment_proof_path ?? '').toLowerCase().endsWith('.pdf');

  useEffect(() => {
    let vivo = true;
    void supabase
      .from('order_items')
      .select('name_snapshot,qty,unit_price_cents,notes')
      .eq('order_id', order.id)
      .order('id')
      .then(({ data }) => {
        if (vivo) setLinhas((data ?? []) as OrderLine[]);
      });

    if (order.payment_proof_path) {
      void supabase.storage
        .from('payment-proofs')
        .createSignedUrl(order.payment_proof_path, PROOF_TTL_S)
        .then(({ data, error }) => {
          if (!vivo) return;
          if (error || !data) setProofErro(true);
          else setProofUrl(data.signedUrl);
        });
    }
    return () => {
      vivo = false;
    };
  }, [order.id, order.payment_proof_path, supabase]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Pedido ${order.daily_number ?? order.order_number}`}
      className="fixed inset-0 z-50 flex flex-col bg-[#0a0807]/95"
    >
      <header className="flex shrink-0 items-center justify-between gap-4 border-b border-white/10 px-6 py-4">
        <div className="min-w-0">
          <p className="text-5xl font-black leading-none">{order.daily_number ?? '—'}</p>
          <p className="mt-1 truncate text-sm font-bold text-[#c8bfb0]">
            {order.order_number} · {fulfillmentLabel(order)}
            {order.customer_name ? ` · ${order.customer_name}` : ''}
          </p>
        </div>
        <button
          type="button"
          onClick={onFechar}
          className="min-h-16 shrink-0 rounded-2xl bg-white/10 px-6 text-lg font-black active:bg-white/20"
        >
          Fechar
        </button>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-2 gap-4 overflow-hidden p-4">
        <section className="flex min-h-0 flex-col gap-3 overflow-y-auto">
          <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
            <p className="text-xs font-black tracking-[0.2em] text-[#847e72]">PAGAMENTO</p>
            <p className="mt-1 text-2xl font-black">{paymentLabel(order)}</p>
            <p className="text-3xl font-black text-[#e5a93c]">{mt(order.total_cents)}</p>
            {order.customer_phone && (
              <p className="mt-1 text-sm text-[#c8bfb0]">Telefone {order.customer_phone}</p>
            )}
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
            <p className="text-xs font-black tracking-[0.2em] text-[#847e72]">ITENS</p>
            {linhas === null ? (
              <p className="mt-2 text-sm text-[#847e72]">A carregar…</p>
            ) : (
              <ul className="mt-2 space-y-2">
                {linhas.map((linha, i) => (
                  <li key={i} className="flex items-baseline justify-between gap-3">
                    <span className="text-lg font-bold">
                      {linha.qty}× {linha.name_snapshot}
                      {linha.notes && (
                        <span className="block text-sm font-normal text-[#c8bfb0]">{linha.notes}</span>
                      )}
                    </span>
                    <span className="shrink-0 text-base text-[#c8bfb0]">
                      {mt(linha.qty * linha.unit_price_cents)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        <section className="flex min-h-0 flex-col rounded-2xl border border-white/10 bg-white/[0.04] p-4">
          <p className="shrink-0 text-xs font-black tracking-[0.2em] text-[#847e72]">COMPROVATIVO</p>
          <div className="mt-3 flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-xl bg-black/40">
            {!order.payment_proof_path ? (
              <p className="px-6 text-center text-lg font-bold text-[#847e72]">
                O cliente não anexou comprovativo.
              </p>
            ) : proofErro ? (
              <p className="px-6 text-center text-lg font-bold text-amber-200">
                Não consegui abrir o comprovativo. Fecha e abre outra vez.
              </p>
            ) : !proofUrl ? (
              <p className="text-lg font-bold text-[#847e72]">A abrir…</p>
            ) : ePdf ? (
              <a
                href={proofUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex min-h-16 items-center rounded-xl bg-white/10 px-6 text-lg font-black"
              >
                Abrir comprovativo (PDF)
              </a>
            ) : (
              // eslint-disable-next-line @next/next/no-img-element -- url assinado, efémero
              <img
                src={proofUrl}
                alt={`Comprovativo do pedido ${order.order_number}`}
                className="max-h-full max-w-full object-contain"
              />
            )}
          </div>
        </section>
      </div>

      {passo && (
        <footer className="shrink-0 border-t border-white/10 p-4">
          <button
            type="button"
            disabled={aMexer}
            onClick={onAvancar}
            className="flex min-h-20 w-full items-center justify-center rounded-2xl bg-[#e5a93c] text-2xl font-black text-black active:scale-[0.99] disabled:opacity-40"
          >
            {aMexer ? '…' : `${passo.label} →`}
          </button>
        </footer>
      )}
    </div>
  );
}
