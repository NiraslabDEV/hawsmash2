'use client';

import { useCallback, useEffect, useState } from 'react';
import { formatMT, type Cents } from '@delivery/core';
import { createClient } from '@/utils/supabase/client';
import {
  BOARD_LIMIT,
  BOARD_ORDER,
  BOARD_SELECT,
  BOARD_STATUSES,
  advanceErrorMessage,
  buildBoard,
  canDecide,
  fulfillmentLabel,
  isLate,
  isScheduled,
  needsProofCheck,
  nextStep,
  paymentLabel,
  type BoardColumn,
  type BoardOrder,
} from '@/lib/pos/orders-board';
import {
  canEditAddress,
  canEditSchedule,
  orderEditErrorMessage,
  zoneChoices,
  type DeliveryZoneOption,
} from '@/lib/pos/order-edit';
import { buildPickupSlots, formatSlot } from '@/lib/pos/schedule';
import { TouchKeyboard } from './touch-keyboard';
import { OrderDecision } from './order-decision';

type DecisionError = { texto: string; mudouDeEstado: boolean };

type OrderLine = { name_snapshot: string; qty: number; unit_price_cents: number; notes: string | null };

/** O comprovativo abre por url assinado, e só dura o tempo de o conferir. */
const PROOF_TTL_S = 600;

/** Quanto tempo até o quadro se actualizar sozinho sem realtime (CLAUDE §11.3). */
const POLL_MS = 12_000;

const mt = (value: number) => formatMT(value as Cents);

const TONE: Record<BoardColumn['tone'], { head: string; card: string; arrow: string }> = {
  violet: {
    head: 'bg-violet-500/15 text-violet-200 border-violet-500/30',
    card: 'border-violet-500/30 bg-violet-500/[0.07]',
    arrow: 'bg-violet-400 text-black',
  },
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

export function OrdersBoard({
  storeId,
  zones,
  closesAt,
  onClose,
}: {
  storeId: string;
  /** As zonas da loja, do `get_menu` — para mudar a zona de uma entrega. */
  zones: DeliveryZoneOption[];
  /** O fecho de hoje: as janelas de hora acabam aí. */
  closesAt: string | null;
  onClose: () => void;
}) {
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
      // Recarregar diz a verdade sobre o estado; a mensagem diz o porquê. Se
      // o pedido não mudou (faltou matéria-prima, por exemplo), a conferência
      // fica aberta com o motivo — é aí que o caixa está a olhar.
      const { texto, mudouDeEstado } = advanceErrorMessage(advanceError.message);
      setError(texto);
      if (mudouDeEstado) setAberto(null);
      void load();
      return;
    }
    setError(null);
    setAberto(null);
    void load();
  }

  /** A seta do cartão: um toque, um passo. */
  function tocarSeta(order: BoardOrder) {
    void advance(order);
  }

  /**
   * Aprovar e recusar vivem no próprio cartão da coluna INTERNET (decisão do
   * dono, 24 Set): o caixa decide sem abrir nada. O comprovativo continua a
   * um toque — tocar no cartão abre a conferência, com os mesmos dois botões.
   */
  function decidido() {
    setError(null);
    setAberto(null);
    void load();
  }

  function decisaoFalhou({ texto, mudouDeEstado }: DecisionError) {
    setError(texto);
    if (mudouDeEstado) setAberto(null);
    void load();
  }

  /** Abrir a conferência limpa o erro do pedido anterior. */
  function abrir(order: BoardOrder) {
    setError(null);
    setAberto(order);
  }

  const board = buildBoard(orders);
  const agora = Date.now();
  // O detalhe mostra a versão mais recente do pedido: depois de alterar a
  // morada, o recarregamento traz a linha nova e o ecrã acompanha.
  const abertoAtual = aberto ? orders.find((o) => o.id === aberto.id) ?? aberto : null;

  return (
    <div className="pos-screen fixed inset-0 z-40 flex flex-col">
      <header className="flex shrink-0 items-center justify-between gap-4 border-b border-white/[0.07] bg-bg1 px-6 py-4">
        <div>
          <p className="pos-eyebrow">PEDIDOS</p>
          <h2 className="pos-title !text-3xl">
            {orders.length} {orders.length === 1 ? 'em curso' : 'em curso'}
          </h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="pos-btn pos-btn--quiet shrink-0 !text-lg"
        >
          ← Voltar a vender
        </button>
      </header>

      {error && (
        <p role="alert" className="shrink-0 bg-amber-500/10 px-6 py-3 text-base font-bold text-amber-200">
          {error}
        </p>
      )}

      <div className="grid min-h-0 flex-1 grid-cols-4 gap-3 overflow-hidden p-3">
        {board.map((coluna) => (
          <section key={coluna.id} className="flex min-h-0 flex-col">
            <h3
              className={`shrink-0 rounded-t-2xl border px-4 py-3 text-center text-sm font-bold tracking-[0.2em] ${TONE[coluna.tone].head}`}
            >
              {coluna.title} · {coluna.orders.length}
            </h3>

            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto rounded-b-2xl bg-white/[0.03] p-3">
              {coluna.orders.length === 0 && (
                <p className="py-8 text-center text-sm font-bold text-ink-mute">vazio</p>
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
                      onClick={() => abrir(order)}
                      aria-label={`Ver detalhe do pedido ${order.daily_number ?? order.order_number}`}
                      className="block w-full text-left"
                    >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-3xl font-bold leading-none">
                          {order.daily_number ?? '—'}
                        </p>
                        <p className="mt-1 text-[11px] font-bold tracking-[0.15em] text-ink-dim">
                          {fulfillmentLabel(order)}
                        </p>
                      </div>
                      <p className="shrink-0 text-right text-base font-bold text-gold">
                        {mt(order.total_cents)}
                      </p>
                    </div>

                    {order.customer_name && (
                      <p className="mt-2 truncate text-sm font-bold">{order.customer_name}</p>
                    )}
                    {order.customer_phone && (
                      <p className="truncate text-xs text-ink-mute">{order.customer_phone}</p>
                    )}

                    {/* A hora marcada só aparece quando existe e é para mais
                        tarde. Um "agora" escrito em todos os cartões deixa de
                        se ver, e é justamente o que não pode passar despercebido. */}
                    {isScheduled(order, agora) && (
                      <p className="mt-2 rounded-lg bg-black/30 px-2 py-1 text-center text-sm font-bold">
                        {hora(order.scheduled_for)}
                      </p>
                    )}
                    {atrasado && (
                      <p className="mt-2 rounded-lg bg-red-500/20 px-2 py-1 text-center text-sm font-bold text-red-200">
                        ATRASADO · {hora(order.scheduled_for)}
                      </p>
                    )}
                    {conferir && (
                      <p className="mt-2 rounded-lg bg-black/30 px-2 py-1 text-center text-xs font-bold tracking-[0.15em] text-gold">
                        {order.payment_proof_path ? '📎 VER COMPROVATIVO' : 'SEM COMPROVATIVO'} · {paymentLabel(order)}
                      </p>
                    )}
                    {order.status === 'awaiting_payment' && (
                      <p className="mt-2 rounded-lg bg-black/30 px-2 py-1 text-center text-xs font-bold tracking-[0.15em] text-sky-200">
                        À ESPERA DO PAGAMENTO · {paymentLabel(order)}
                      </p>
                    )}
                    </button>

                    {canDecide(order) ? (
                      <div className="mt-3">
                        <OrderDecision
                          orderId={order.id}
                          numero={String(order.daily_number ?? order.order_number)}
                          onDone={decidido}
                          onError={decisaoFalhou}
                        />
                      </div>
                    ) : passo && (
                      <button
                        type="button"
                        disabled={aMexer}
                        onClick={() => tocarSeta(order)}
                        aria-label={`${passo.label} — pedido ${order.daily_number ?? order.order_number}`}
                        className={`mt-3 flex min-h-16 w-full items-center justify-center gap-2 rounded-xl text-lg font-bold pos-press disabled:opacity-40 ${TONE[coluna.tone].arrow}`}
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
        <p className="shrink-0 border-t border-white/[0.07] px-6 py-3 text-sm text-ink-mute">
          A carregar pedidos…
        </p>
      )}

      {abertoAtual && (
        <DetalhePedido
          order={abertoAtual}
          zones={zones}
          closesAt={closesAt}
          onAlterado={() => void load()}
          aMexer={moving.has(abertoAtual.id)}
          erro={error}
          onFechar={() => {
            setError(null);
            setAberto(null);
          }}
          onAvancar={() => void advance(abertoAtual)}
          onDecidido={decidido}
          onErroDecisao={decisaoFalhou}
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
export function DetalhePedido({
  order,
  zones,
  closesAt,
  onAlterado,
  aMexer = false,
  erro,
  onFechar,
  onAvancar,
  onDecidido,
  onErroDecisao,
}: {
  order: BoardOrder;
  zones: DeliveryZoneOption[];
  closesAt: string | null;
  /** Depois de uma alteração: recarregar o quadro, que traz a linha nova. */
  onAlterado: () => void;
  aMexer?: boolean;
  /** Porque é que o último toque não avançou este pedido, se não avançou. */
  erro: string | null;
  onFechar: () => void;
  /** Sem esta, o detalhe não avança estados — é só conferir e decidir (aba Delivery). */
  onAvancar?: () => void;
  onDecidido: () => void;
  onErroDecisao: (erro: DecisionError) => void;
}) {
  const [supabase] = useState(() => createClient());
  const [linhas, setLinhas] = useState<OrderLine[] | null>(null);
  const [proofUrl, setProofUrl] = useState<string | null>(null);
  const [proofErro, setProofErro] = useState(false);
  const passo = nextStep(order.status);
  /** Que alteração está aberta por cima do detalhe. */
  const [editar, setEditar] = useState<'address' | 'zone' | 'schedule' | null>(null);
  const [aGuardar, setAGuardar] = useState(false);
  const [editErro, setEditErro] = useState<string | null>(null);
  const [editOk, setEditOk] = useState<string | null>(null);
  const moradaEditavel = canEditAddress(order);
  const horaEditavel = canEditSchedule(order);
  const zonaNome = zones.find((z) => z.id === order.delivery_zone_id)?.name ?? null;

  async function alterar(changes: Record<string, unknown>, feito: string) {
    if (aGuardar) return;
    setAGuardar(true);
    setEditErro(null);
    setEditOk(null);
    // Uma chave por toque. Se a rede repetir o envio, o servidor reconhece-a
    // e não imprime uma segunda via (regra 4).
    const { data, error: rpcError } = await supabase.rpc('update_order_details', {
      p_order_id: order.id,
      p_changes: changes,
      p_request_id: crypto.randomUUID(),
    });
    setAGuardar(false);
    setEditar(null);
    if (rpcError) {
      setEditErro(orderEditErrorMessage(rpcError.message));
      onAlterado();
      return;
    }
    const r = (data ?? {}) as { changed?: string[]; reprinted?: boolean };
    if (!r.changed || r.changed.length === 0) {
      setEditOk('Nada mudou — já estava assim.');
      return;
    }
    setEditOk(r.reprinted ? `${feito} Saiu uma via ALTERADO na cozinha — troca a do saco.` : feito);
    onAlterado();
  }

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
      className="pos-screen fixed inset-0 z-50 flex flex-col"
    >
      <header className="flex shrink-0 items-center justify-between gap-4 border-b border-white/[0.07] bg-bg1 px-6 py-4">
        <div className="min-w-0">
          <p className="text-5xl font-extrabold leading-none">{order.daily_number ?? '—'}</p>
          <p className="mt-1 truncate text-sm font-bold text-ink-dim">
            {order.order_number} · {fulfillmentLabel(order)}
            {order.customer_name ? ` · ${order.customer_name}` : ''}
          </p>
        </div>
        <button
          type="button"
          onClick={onFechar}
          className="pos-btn pos-btn--quiet shrink-0 !text-lg"
        >
          Fechar
        </button>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-2 gap-4 overflow-hidden p-4">
        <section className="flex min-h-0 flex-col gap-3 overflow-y-auto">
          {/* Morada e hora: o que o cliente liga a pedir para mudar. O botão
              só aparece quando o servidor vai aceitar (1072). */}
          <div className="pos-card !p-4">
            {order.fulfillment_type === 'delivery' && (
              <>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="pos-eyebrow">MORADA</p>
                    <p className="mt-1 break-words text-lg font-bold">
                      {order.address || 'Sem morada — confirmar por telefone'}
                    </p>
                  </div>
                  {moradaEditavel && (
                    <button
                      type="button"
                      disabled={aGuardar}
                      onClick={() => setEditar('address')}
                      className="min-h-14 shrink-0 rounded-xl bg-white/10 px-4 text-base font-bold active:bg-white/20 disabled:opacity-40"
                    >
                      Alterar
                    </button>
                  )}
                </div>
                <div className="mt-3 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="pos-eyebrow">ZONA</p>
                    <p className="mt-1 truncate text-lg font-bold">
                      {zonaNome ?? '—'} · {mt(order.delivery_fee_cents)}
                    </p>
                  </div>
                  {moradaEditavel && zones.length > 1 && (
                    <button
                      type="button"
                      disabled={aGuardar}
                      onClick={() => setEditar('zone')}
                      className="min-h-14 shrink-0 rounded-xl bg-white/10 px-4 text-base font-bold active:bg-white/20 disabled:opacity-40"
                    >
                      Alterar
                    </button>
                  )}
                </div>
              </>
            )}
            <div
              className={`flex items-center justify-between gap-3 ${
                order.fulfillment_type === 'delivery' ? 'mt-3' : ''
              }`}
            >
              <div>
                <p className="pos-eyebrow">HORA</p>
                <p className="mt-1 text-2xl font-bold">{formatSlot(order.scheduled_for)}</p>
              </div>
              {horaEditavel && (
                <button
                  type="button"
                  disabled={aGuardar}
                  onClick={() => setEditar('schedule')}
                  className="min-h-14 shrink-0 rounded-xl bg-white/10 px-4 text-base font-bold active:bg-white/20 disabled:opacity-40"
                >
                  Alterar
                </button>
              )}
            </div>
            {aGuardar && <p className="mt-3 text-sm font-bold text-ink-mute">A guardar…</p>}
            {editErro && (
              <p role="alert" className="mt-3 rounded-xl bg-red-500/15 px-3 py-2 text-base font-bold text-red-100">
                {editErro}
              </p>
            )}
            {editOk && (
              <p role="status" className="mt-3 rounded-xl bg-emerald-500/15 px-3 py-2 text-base font-bold text-emerald-100">
                {editOk}
              </p>
            )}
          </div>

          <div className="pos-card !p-4">
            <p className="pos-eyebrow">PAGAMENTO</p>
            <p className="mt-1 text-2xl font-bold">{paymentLabel(order)}</p>
            <p className="text-3xl font-bold text-gold">{mt(order.total_cents)}</p>
            {order.customer_phone && (
              <p className="mt-1 text-sm text-ink-dim">Telefone {order.customer_phone}</p>
            )}
          </div>

          <div className="pos-card !p-4">
            <p className="pos-eyebrow">ITENS</p>
            {linhas === null ? (
              <p className="mt-2 text-sm text-ink-mute">A carregar…</p>
            ) : (
              <ul className="mt-2 space-y-2">
                {linhas.map((linha, i) => (
                  <li key={i} className="flex items-baseline justify-between gap-3">
                    <span className="text-lg font-bold">
                      {linha.qty}× {linha.name_snapshot}
                      {linha.notes && (
                        <span className="block text-sm font-normal text-ink-dim">{linha.notes}</span>
                      )}
                    </span>
                    <span className="shrink-0 text-base text-ink-dim">
                      {mt(linha.qty * linha.unit_price_cents)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        <section className="!flex !min-h-0 !flex-col pos-card !p-4">
          <p className="shrink-0 pos-eyebrow">COMPROVATIVO</p>
          <div className="mt-3 flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-xl bg-black/40">
            {!order.payment_proof_path ? (
              <p className="px-6 text-center text-lg font-bold text-ink-mute">
                O cliente não anexou comprovativo.
              </p>
            ) : proofErro ? (
              <p className="px-6 text-center text-lg font-bold text-amber-200">
                Não consegui abrir o comprovativo. Fecha e abre outra vez.
              </p>
            ) : !proofUrl ? (
              <p className="text-lg font-bold text-ink-mute">A abrir…</p>
            ) : ePdf ? (
              <a
                href={proofUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex min-h-16 items-center rounded-xl bg-white/10 px-6 text-lg font-bold"
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

      {erro && (
        <p
          role="alert"
          className="shrink-0 border-t border-red-500/40 bg-red-500/15 px-6 py-4 text-lg font-bold text-red-100"
        >
          {erro}
        </p>
      )}

      {editar === 'address' && (
        <TouchKeyboard
          label="Nova morada"
          value={order.address ?? ''}
          maxLength={300}
          onCancel={() => setEditar(null)}
          onConfirm={(valor) => void alterar({ address: valor }, 'Morada alterada.')}
        />
      )}

      {(editar === 'zone' || editar === 'schedule') && (
        <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/70 p-4 sm:items-center">
          <div className="!flex max-h-full w-full max-w-2xl !flex-col pos-sheet !p-6">
            <p className="pos-eyebrow">
              {editar === 'schedule' ? 'PARA QUANDO?' : 'PARA ONDE?'}
            </p>
            <h2 className="mb-4 text-3xl font-bold text-ink">
              {editar === 'schedule' ? 'Nova hora' : 'Nova zona'}
            </h2>
            <div className="min-h-0 flex-1 overflow-y-auto">
              {editar === 'schedule' ? (
                // As mesmas janelas da venda ao balcão, até ao fecho da loja.
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                  {[
                    { value: '', label: 'Agora' },
                    ...buildPickupSlots({ now: new Date(), closesAt }),
                  ].map((slot) => (
                    <button
                      key={slot.value || 'agora'}
                      type="button"
                      disabled={aGuardar}
                      onClick={() =>
                        void alterar(
                          { scheduledFor: slot.value || null },
                          `Hora alterada para ${slot.label.toLowerCase()}.`,
                        )
                      }
                      className="min-h-16 rounded-xl bg-white/[0.08] text-xl font-bold text-ink pos-press disabled:opacity-40"
                    >
                      {slot.label}
                    </button>
                  ))}
                </div>
              ) : (
                <div className="grid gap-2 sm:grid-cols-2">
                  {zoneChoices(zones, order).map(({ zone, allowed }) => (
                    <button
                      key={zone.id}
                      type="button"
                      disabled={!allowed || aGuardar}
                      onClick={() =>
                        void alterar({ deliveryZoneId: zone.id }, `Zona alterada para ${zone.name}.`)
                      }
                      className={`flex min-h-16 items-center justify-between gap-3 rounded-xl px-4 text-left pos-press disabled:opacity-35 ${
                        zone.id === order.delivery_zone_id
                          ? 'bg-gold text-black'
                          : 'bg-white/[0.08] text-ink'
                      }`}
                    >
                      <span className="text-lg font-bold">{zone.name}</span>
                      <span className="shrink-0 text-right text-sm font-bold">
                        {mt(zone.fee_cents)}
                        {!allowed && <span className="block text-xs">taxa diferente</span>}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            {editar === 'zone' && (
              <p className="mt-3 text-sm text-ink-dim">
                Só as zonas com a mesma taxa. Para uma zona com outra taxa, o pedido tem de ser
                anulado e refeito, com gerente.
              </p>
            )}
            <button
              type="button"
              onClick={() => setEditar(null)}
              className="mt-4 min-h-16 w-full shrink-0 rounded-2xl bg-white/10 text-lg font-bold text-ink active:bg-white/20"
            >
              Fechar
            </button>
          </div>
        </div>
      )}

      {canDecide(order) ? (
        <footer className="shrink-0 border-t border-white/[0.07] p-4">
          <OrderDecision
            orderId={order.id}
            numero={String(order.daily_number ?? order.order_number)}
            size="lg"
            onDone={onDecidido}
            onError={onErroDecisao}
          />
        </footer>
      ) : passo && onAvancar && (
        <footer className="shrink-0 border-t border-white/[0.07] p-4">
          <button
            type="button"
            disabled={aMexer}
            onClick={onAvancar}
            className="flex min-h-20 w-full items-center justify-center rounded-2xl bg-gold text-2xl font-extrabold text-[color:var(--pos-on-accent)] pos-press disabled:opacity-40"
          >
            {aMexer ? '…' : `${passo.label} →`}
          </button>
        </footer>
      )}
    </div>
  );
}
