'use client';

import dynamic from 'next/dynamic';
import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { formatMT, type Cents } from '@delivery/core';

import type { PontoEstafeta } from '@/components/estafetas/mapa';
import { courierAdminErrorMessage } from '@/lib/estafeta/admin';
import {
  ASSIGNABLE_STATUSES,
  assignableCouriers,
  courierForOrder,
  firstName,
  ordersAwaitingCourier,
  type BoardCourier,
  type CouriersBoard,
} from '@/lib/estafeta/board';
import { isStale, positionAge } from '@/lib/estafeta/tracking';
import { createClient } from '@/utils/supabase/client';

import { PosIcon } from './pos-icons';

const MapaEstafetas = dynamic(() => import('@/components/estafetas/mapa').then((m) => m.MapaEstafetas), {
  ssr: false,
  loading: () => <div className="h-[340px] animate-pulse rounded-2xl bg-white/[0.04]" />,
});

const mt = (c: number) => formatMT(c as Cents);

/**
 * O quadro dos estafetas da loja, partilhado por tudo o que no POS fala de
 * estafetas: o separador, o chip no quadro de pedidos e o detalhe. Uma
 * consulta por loja, a cada 15 s — o telemóvel deles manda posição a cada 15–60 s.
 */
export function useCouriersBoard(storeId: string | null) {
  const supabase = useMemo(() => createClient(), []);
  return useQuery({
    queryKey: ['couriers-board', storeId],
    enabled: Boolean(storeId),
    refetchInterval: 15_000,
    staleTime: 5_000,
    queryFn: async (): Promise<CouriersBoard> => {
      const { data, error } = await supabase.rpc('get_couriers_board', { p_store_id: storeId });
      if (error) throw new Error(courierAdminErrorMessage(error.message));
      return data as CouriersBoard;
    },
  });
}

/** "🛵 Abel · a caminho" num cartão do quadro de pedidos. Nada, se não houver estafeta. */
export function EstafetaChip({ storeId, orderId }: { storeId: string; orderId: string }) {
  const board = useCouriersBoard(storeId);
  const atual = courierForOrder(board.data, orderId);
  if (!atual) return null;
  return (
    <p className="mt-2 truncate rounded-lg bg-sky-500/15 px-2 py-1 text-center text-xs font-bold text-sky-200">
      🛵 {firstName(atual.courier.full_name)} · {atual.job.status === 'picked_up' ? 'a caminho' : 'por levantar'}
    </p>
  );
}

/**
 * Escolher quem leva, com um toque. Botões grandes em vez de lista pendente:
 * o PC do balcão é de toque. Quem está de serviço e livre aparece primeiro.
 * Depois de o estafeta levantar, já não se troca — a BD recusa e o ecrã diz porquê.
 */
export function EscolherEstafeta({
  storeId,
  orderId,
  onFeito,
}: {
  storeId: string;
  orderId: string;
  onFeito?: (texto: string) => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  const board = useCouriersBoard(storeId);
  const [aGuardar, setAGuardar] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const atual = courierForOrder(board.data, orderId);
  const opcoes = assignableCouriers(board.data);

  if (board.isLoading) return <p className="text-sm text-ink-mute">A carregar estafetas…</p>;
  if (opcoes.length === 0) {
    return <p className="text-sm text-ink-mute">Sem estafetas nesta loja. O gerente cria-os no painel, em Estafetas.</p>;
  }

  async function mudar(courierId: string | null) {
    if (aGuardar) return;
    setAGuardar(courierId ?? 'tirar');
    setErro(null);
    const { error } = courierId
      ? await supabase.rpc('assign_courier', { p_order_id: orderId, p_courier_id: courierId })
      : await supabase.rpc('unassign_courier', { p_order_id: orderId });
    setAGuardar(null);
    await queryClient.invalidateQueries({ queryKey: ['couriers-board', storeId] });
    if (error) {
      setErro(courierAdminErrorMessage(error.message));
      return;
    }
    const nome = courierId ? opcoes.find((c) => c.id === courierId)?.full_name : null;
    onFeito?.(nome ? `Atribuído a ${nome}.` : 'Estafeta retirado.');
  }

  if (atual && atual.job.status === 'picked_up') {
    return (
      <p className="text-lg font-bold text-sky-200">
        🛵 {atual.courier.full_name} já levantou — vai a caminho.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2 xl:grid-cols-3">
        {opcoes.map((c) => {
          const escolhido = atual?.courier.id === c.id;
          return (
            <button
              key={c.id}
              type="button"
              disabled={Boolean(aGuardar)}
              onClick={() => void mudar(escolhido ? null : c.id)}
              aria-pressed={escolhido}
              className={`flex min-h-16 flex-col items-start justify-center rounded-xl border px-3 py-2 text-left pos-press disabled:opacity-50 ${
                escolhido ? 'border-sky-400 bg-sky-500/20' : 'border-white/10 bg-white/[0.05]'
              }`}
            >
              <span className="line-clamp-2 w-full break-words text-base font-bold leading-tight">
                {escolhido ? '✓ ' : ''}
                {c.full_name}
              </span>
              <span className={`text-xs font-bold ${c.on_shift ? 'text-emerald-300' : 'text-ink-mute'}`}>
                {aGuardar === c.id
                  ? 'A guardar…'
                  : escolhido
                    ? 'Tocar para tirar'
                    : c.on_shift
                      ? c.jobs.length > 0
                        ? `de serviço · leva ${c.jobs.length}`
                        : 'de serviço · livre'
                      : 'fora de serviço'}
              </span>
            </button>
          );
        })}
      </div>
      {erro && <p role="alert" className="pos-note pos-note--danger !text-base !font-bold">{erro}</p>}
    </div>
  );
}

type PedidoEntrega = {
  id: string;
  daily_number: number | null;
  order_number: string;
  status: string;
  fulfillment_type: string;
  customer_name: string | null;
  address: string | null;
  scheduled_for: string | null;
};

/**
 * O separador Estafetas do POS: o que está à espera de estafeta, quem está de
 * serviço e onde. Pagar o saldo aparece só a gerente e dono (o quadro só lhes
 * traz o saldo a eles); em dinheiro, sai como despesa do turno aberto.
 */
export function EstafetasTab({ storeId, storeName }: { storeId: string; storeName: string }) {
  const supabase = useMemo(() => createClient(), []);
  const board = useCouriersBoard(storeId);
  const [aberto, setAberto] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const pedidos = useQuery({
    queryKey: ['pos-entregas-por-sair', storeId],
    refetchInterval: 15_000,
    queryFn: async (): Promise<PedidoEntrega[]> => {
      const { data } = await supabase
        .from('orders')
        .select('id,daily_number,order_number,status,fulfillment_type,customer_name,address,scheduled_for')
        .eq('store_id', storeId)
        .eq('fulfillment_type', 'delivery')
        .in('status', [...ASSIGNABLE_STATUSES])
        .order('created_at', { ascending: true })
        .limit(100);
      return (data ?? []) as PedidoEntrega[];
    },
  });

  useEffect(() => {
    if (!aviso) return;
    const t = setTimeout(() => setAviso(null), 4000);
    return () => clearTimeout(t);
  }, [aviso]);

  const porAtribuir = ordersAwaitingCourier(pedidos.data ?? [], board.data);
  const estafetas = assignableCouriers(board.data);
  const pontos: PontoEstafeta[] = estafetas
    .filter((c) => c.on_shift && c.position)
    .map((c) => ({
      id: c.id,
      nome: firstName(c.full_name),
      lat: c.position!.lat,
      lng: c.position!.lng,
      recordedAt: c.position!.recorded_at,
      aCaminho: c.jobs.some((j) => j.status === 'picked_up'),
    }));
  const pedidoAberto = porAtribuir.find((p) => p.id === aberto) ?? null;

  return (
    <div className="mx-auto grid w-full max-w-6xl gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div className="flex min-w-0 flex-col gap-3">
        <div>
          <h2 className="text-xl font-bold">Estafetas · {storeName}</h2>
          <p className="text-sm text-ink-mute">Toca num pedido para escolher quem o leva.</p>
        </div>
        {aviso && <p role="status" className="pos-note pos-note--ok !text-base !font-bold">{aviso}</p>}
        {board.error && <p role="alert" className="pos-note pos-note--warn">{(board.error as Error).message}</p>}

        <section>
          <h3 className="pos-eyebrow mb-2">À espera de estafeta ({porAtribuir.length})</h3>
          {porAtribuir.length === 0 ? (
            <p className="rounded-2xl border border-white/[0.07] bg-bg2 p-4 text-center text-sm text-ink-mute">
              Todas as entregas têm estafeta.
            </p>
          ) : (
            <ul className="space-y-2">
              {porAtribuir.map((p) => (
                <li key={p.id} className="rounded-2xl border border-amber-500/30 bg-amber-500/[0.07] p-3">
                  <button type="button" onClick={() => setAberto(aberto === p.id ? null : p.id)} className="flex w-full items-center gap-3 text-left">
                    <span className="pos-num min-w-14 text-center text-4xl font-extrabold text-amber-200">
                      {p.daily_number ?? '—'}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-base font-bold">{p.customer_name}</span>
                      <span className="block truncate text-sm text-ink-mute">{p.address ?? 'Sem morada'}</span>
                    </span>
                    <span className="shrink-0 text-xs font-bold tracking-[0.12em] text-ink-dim">
                      {p.status === 'ready' ? 'PRONTO' : 'NA COZINHA'}
                    </span>
                  </button>
                  {pedidoAberto?.id === p.id && (
                    <div className="mt-3">
                      <EscolherEstafeta
                        storeId={storeId}
                        orderId={p.id}
                        onFeito={(t) => {
                          setAviso(t);
                          setAberto(null);
                          void pedidos.refetch();
                        }}
                      />
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section>
          <h3 className="pos-eyebrow mb-2">Estafetas ({estafetas.length})</h3>
          {estafetas.length === 0 ? (
            <p className="rounded-2xl border border-white/[0.07] bg-bg2 p-4 text-center text-sm text-ink-mute">
              Ainda não há estafetas. O gerente cria-os no painel, em Estafetas.
            </p>
          ) : (
            <ul className="space-y-2">
              {estafetas.map((c) => (
                <CartaoEstafeta key={c.id} c={c} storeId={storeId} onFeito={setAviso} />
              ))}
            </ul>
          )}
        </section>
      </div>

      <div className="flex min-w-0 flex-col gap-2">
        <h3 className="pos-eyebrow">Mapa</h3>
        <MapaEstafetas pontos={pontos} />
        <p className="text-xs text-ink-mute">
          Verde: de serviço · Azul: a caminho · Cinzento: sem sinal há mais de 5 min. Só aparece quem tem a página do
          estafeta aberta.
        </p>
      </div>
    </div>
  );
}

function CartaoEstafeta({ c, storeId, onFeito }: { c: BoardCourier; storeId: string; onFeito: (t: string) => void }) {
  const [pagar, setPagar] = useState(false);
  const sinal = c.position ? (isStale(c.position.recorded_at) ? 'sem sinal' : 'a partilhar') : null;
  return (
    <li className="rounded-2xl border border-white/[0.07] bg-bg2 p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-base font-bold">{c.full_name}</p>
          <p className="text-xs text-ink-mute">
            {c.phone}
            {c.position ? ` · 📍 ${sinal} ${positionAge(c.position.recorded_at)}` : c.on_shift ? ' · sem localização' : ''}
          </p>
        </div>
        <span
          className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-bold ${
            c.on_shift ? 'bg-emerald-500/20 text-emerald-200' : 'bg-white/10 text-ink-mute'
          }`}
        >
          {c.on_shift ? 'DE SERVIÇO' : 'FORA'}
        </span>
      </div>

      {c.jobs.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {c.jobs.map((j) => (
            <span
              key={j.delivery_id}
              className={`rounded-lg px-2 py-1 text-xs font-bold ${
                j.status === 'picked_up' ? 'bg-sky-500/20 text-sky-200' : 'bg-amber-500/20 text-amber-200'
              }`}
            >
              #{j.daily_number ?? j.order_number} · {j.status === 'picked_up' ? 'a caminho' : 'por levantar'}
            </span>
          ))}
        </div>
      )}

      <div className="mt-2 flex items-center justify-between gap-2 text-sm">
        <span className="text-ink-mute">Entregues hoje: {c.delivered_today}</span>
        {c.balance_cents != null && (
          <span className="flex items-center gap-2">
            <span className="text-ink-mute">
              A pagar: <b className="text-gold">{mt(c.balance_cents)}</b>
            </span>
            {c.balance_cents > 0 && (
              <button type="button" onClick={() => setPagar((v) => !v)} className="pos-btn !min-h-10 !rounded-[12px] !px-3 !text-sm">
                <PosIcon name="cash" size={16} />
                Pagar
              </button>
            )}
          </span>
        )}
      </div>

      {pagar && c.balance_cents != null && c.balance_cents > 0 && (
        <PagarSaldo
          courier={c}
          storeId={storeId}
          onFeito={(t) => {
            setPagar(false);
            onFeito(t);
          }}
        />
      )}
    </li>
  );
}

/**
 * Pagar o saldo todo, em dois toques. Valores parciais ficam no painel (lá há
 * teclado); aqui é o caso comum do fim do turno. A chave do pagamento nasce
 * com o painel aberto: tocar duas vezes não paga duas vezes (regra 4).
 */
function PagarSaldo({ courier, storeId, onFeito }: { courier: BoardCourier; storeId: string; onFeito: (t: string) => void }) {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  const [metodo, setMetodo] = useState<'cash' | 'mpesa' | 'emola'>('cash');
  const [confirmar, setConfirmar] = useState(false);
  const [aPagar, setAPagar] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [requestId] = useState(() => crypto.randomUUID());
  const valor = courier.balance_cents ?? 0;

  async function pagar() {
    if (!confirmar) {
      setConfirmar(true);
      return;
    }
    setAPagar(true);
    setErro(null);
    const { error } = await supabase.rpc('courier_payout', {
      p_courier_id: courier.id,
      p_amount_cents: valor,
      p_method: metodo,
      p_note: 'Pago no POS',
      p_request_id: requestId,
    });
    setAPagar(false);
    setConfirmar(false);
    await queryClient.invalidateQueries({ queryKey: ['couriers-board', storeId] });
    if (error) setErro(courierAdminErrorMessage(error.message));
    else onFeito(`${mt(valor)} pagos a ${courier.full_name}.`);
  }

  const METODOS: Array<{ id: 'cash' | 'mpesa' | 'emola'; label: string }> = [
    { id: 'cash', label: 'Dinheiro' },
    { id: 'mpesa', label: 'M-Pesa' },
    { id: 'emola', label: 'e-Mola' },
  ];

  return (
    <div className="mt-3 space-y-2 rounded-xl bg-black/25 p-3">
      <div className="grid grid-cols-3 gap-2">
        {METODOS.map((m) => (
          <button
            key={m.id}
            type="button"
            aria-pressed={metodo === m.id}
            onClick={() => {
              setMetodo(m.id);
              setConfirmar(false);
            }}
            className={`min-h-12 rounded-xl border text-sm font-bold ${
              metodo === m.id ? 'border-gold bg-amber-400/15 text-gold' : 'border-white/10 text-ink'
            }`}
          >
            {m.label}
          </button>
        ))}
      </div>
      {metodo === 'cash' && (
        <p className="text-xs text-ink-mute">Sai da gaveta como despesa do turno aberto.</p>
      )}
      <button
        type="button"
        disabled={aPagar}
        onClick={() => void pagar()}
        className={`pos-btn pos-btn--lg w-full ${confirmar ? 'pos-btn--ok' : 'pos-btn--primary'}`}
      >
        {aPagar ? 'A registar…' : confirmar ? `Confirmar ${mt(valor)}` : `Pagar ${mt(valor)}`}
      </button>
      {erro && <p role="alert" className="pos-note pos-note--danger !text-base !font-bold">{erro}</p>}
    </div>
  );
}
