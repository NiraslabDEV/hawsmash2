'use client';

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { formatMT, type Cents } from '@delivery/core';

import { lerHistorico, SemSessao } from '@/lib/garcom/client';
import type { WaiterOrderRow } from '@/lib/garcom/contract';
import { ESTADO_PEDIDO } from '@/lib/garcom/pedido';
import { itemLabel } from '@/lib/pos/tables';

import { Topo, Vazio } from './ui';

const money = (c: number) => formatMT(c as Cents);
const DIAS = [
  [1, 'Hoje'],
  [7, '7 dias'],
  [30, '30 dias'],
] as const;

const quando = (iso: string, comDia: boolean) =>
  new Date(iso).toLocaleString('pt-PT', {
    timeZone: 'Africa/Maputo',
    ...(comDia ? { day: '2-digit', month: '2-digit' } : {}),
    hour: '2-digit',
    minute: '2-digit',
  });

/** Os pedidos dele, e as contas que dão. Só leitura. */
export function Historico({ onSemSessao }: { onSemSessao: () => void }) {
  const [dias, setDias] = useState<number>(1);
  const historico = useQuery({
    queryKey: ['garcom-historico', dias],
    queryFn: () => lerHistorico(dias),
    refetchOnWindowFocus: true,
    retry: (n, err) => !(err instanceof SemSessao) && n < 2,
  });
  useEffect(() => {
    if (historico.error instanceof SemSessao) onSemSessao();
  }, [historico.error, onSemSessao]);

  const s = historico.data?.summary;
  const faltam = historico.data ? historico.data.total - historico.data.orders.length : 0;

  return (
    <main className="mx-auto max-w-md pb-28">
      <Topo sobre="Histórico" titulo="Os meus pedidos">
        <div className="pos-seg mt-3" role="group" aria-label="Período">
          {DIAS.map(([n, label]) => (
            <button key={n} aria-pressed={dias === n} onClick={() => setDias(n)} className="!min-h-11 !text-sm">
              {label}
            </button>
          ))}
        </div>
      </Topo>

      <div className="space-y-4 px-4 pt-4">
        {s && (
          <section className="pos-card grid grid-cols-3 divide-x divide-white/[0.07] py-3">
            <Numero titulo="Pedidos" valor={String(s.orders)} />
            <Numero titulo="Vendas" valor={money(s.revenue_cents)} destaque />
            <Numero titulo="Ticket" valor={money(s.avg_ticket_cents)} />
          </section>
        )}

        {historico.isLoading && (
          <ul className="space-y-2" aria-hidden>
            {Array.from({ length: 4 }, (_, i) => (
              <li key={i} className="h-24 animate-pulse rounded-[20px] bg-white/[0.04]" />
            ))}
          </ul>
        )}
        {historico.error && !(historico.error instanceof SemSessao) && (
          <p className="py-6 text-center text-ink-mute">{(historico.error as Error).message}</p>
        )}
        {historico.data && historico.data.orders.length === 0 && <Vazio>Sem pedidos neste período.</Vazio>}

        <ul className="space-y-2">
          {historico.data?.orders.map((order) => <Linha key={order.id} order={order} comDia={dias > 1} />)}
        </ul>
        {faltam > 0 && <p className="text-center text-xs text-ink-mute">E mais {faltam} anteriores. O gerente vê-os todos no painel.</p>}
      </div>
    </main>
  );
}

function Numero({ titulo, valor, destaque }: { titulo: string; valor: string; destaque?: boolean }) {
  return (
    <div className="min-w-0 px-2 text-center">
      <p className="pos-eyebrow">{titulo}</p>
      <p className={`pos-num mt-1 truncate text-[0.9375rem] font-extrabold ${destaque ? 'text-gold' : ''}`}>{valor}</p>
    </div>
  );
}

function Linha({ order, comDia }: { order: WaiterOrderRow; comDia: boolean }) {
  const cancelado = order.status === 'cancelled';
  const estado = cancelado
    ? { texto: ESTADO_PEDIDO[order.status] ?? 'Cancelado', cor: 'bg-red-400/15 text-red-300' }
    : order.paid
      ? { texto: 'Paga', cor: 'bg-emerald-400/15 text-emerald-300' }
      : { texto: 'Por cobrar', cor: 'bg-amber-400/15 text-amber-300' };
  return (
    <li className={`pos-card space-y-2 p-4 ${cancelado ? 'opacity-60' : ''}`}>
      <p className="flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-baseline gap-2">
          <span className="truncate font-extrabold">
            {order.table_number != null ? (
              <>
                Mesa <span className="pos-num">{order.table_number}</span>
              </>
            ) : (
              order.order_number
            )}
          </span>
          <span className="pos-num shrink-0 text-xs text-ink-mute">{quando(order.created_at, comDia)}</span>
        </span>
        <span className="pos-num shrink-0 text-lg font-extrabold text-gold">{money(order.total_cents)}</span>
      </p>
      <p className="flex flex-wrap items-center gap-1.5">
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wider ${estado.cor}`}>{estado.texto}</span>
        {!cancelado && (
          <span className="rounded-full bg-white/[0.06] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-ink-mute">
            {ESTADO_PEDIDO[order.status] ?? order.status}
          </span>
        )}
      </p>
      <ul className="space-y-0.5 text-sm text-ink-dim">
        {order.items.map((item, i) => (
          <li key={i}>
            <span className="pos-num font-bold text-ink">{item.qty}×</span> {itemLabel({ ...item, person: null })}
          </li>
        ))}
        {order.removed.map((r, i) => (
          <li key={`r${i}`} className="flex items-baseline justify-between gap-2 text-red-300">
            <span className="line-through decoration-red-300/60">
              {r.qty}× {r.name}
            </span>
            <span className="shrink-0 text-xs">{r.reason}</span>
          </li>
        ))}
      </ul>
    </li>
  );
}
