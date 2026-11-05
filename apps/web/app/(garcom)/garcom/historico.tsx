'use client';

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { formatMT, type Cents } from '@delivery/core';

import { lerHistorico, SemSessao } from '@/lib/garcom/client';
import type { WaiterOrderRow } from '@/lib/garcom/contract';
import { ESTADO_PEDIDO } from '@/lib/garcom/pedido';
import { itemLabel } from '@/lib/pos/tables';

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
    <main className="mx-auto max-w-md space-y-4 px-4 pb-24 pt-4">
      <h1 className="font-[family-name:var(--font-display)] text-3xl tracking-wide text-[var(--gold)]">Os meus pedidos</h1>
      <div className="grid grid-cols-3 gap-1 rounded-xl border border-white/10 p-1" role="group" aria-label="Período">
        {DIAS.map(([n, label]) => (
          <button
            key={n}
            aria-pressed={dias === n}
            onClick={() => setDias(n)}
            className={`rounded-lg py-2 text-sm font-semibold ${dias === n ? 'bg-[var(--gold)] text-black' : 'text-[var(--ink-dim)]'}`}
          >
            {label}
          </button>
        ))}
      </div>

      {s && (
        <section className="grid grid-cols-3 gap-2 text-center">
          <Numero titulo="Pedidos" valor={String(s.orders)} />
          <Numero titulo="Vendas" valor={money(s.revenue_cents)} />
          <Numero titulo="Ticket" valor={money(s.avg_ticket_cents)} />
        </section>
      )}

      {historico.isLoading && <p className="py-8 text-center text-[var(--ink-dim)]">A carregar…</p>}
      {historico.error && !(historico.error instanceof SemSessao) && (
        <p className="py-6 text-center text-[var(--ink-dim)]">{(historico.error as Error).message}</p>
      )}
      {historico.data && historico.data.orders.length === 0 && (
        <p className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 text-center text-sm text-[var(--ink-dim)]">
          Sem pedidos neste período.
        </p>
      )}

      <ul className="space-y-2">
        {historico.data?.orders.map((order) => <Linha key={order.id} order={order} comDia={dias > 1} />)}
      </ul>
      {faltam > 0 && <p className="text-center text-xs text-[var(--ink-mute)]">E mais {faltam} anteriores. O gerente vê-os todos no painel.</p>}
    </main>
  );
}

function Numero({ titulo, valor }: { titulo: string; valor: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-1 py-3">
      <p className="text-[11px] uppercase tracking-wider text-[var(--ink-mute)]">{titulo}</p>
      <p className="mt-1 text-sm font-bold">{valor}</p>
    </div>
  );
}

function Linha({ order, comDia }: { order: WaiterOrderRow; comDia: boolean }) {
  const cancelado = order.status === 'cancelled';
  return (
    <li className={`space-y-1 rounded-2xl border border-white/10 bg-white/[0.04] p-3 ${cancelado ? 'opacity-60' : ''}`}>
      <p className="flex items-baseline justify-between gap-2">
        <span className="font-semibold">
          {order.table_number != null ? `Mesa ${order.table_number}` : order.order_number}
          <span className="ml-2 text-xs font-normal text-[var(--ink-mute)]">{quando(order.created_at, comDia)}</span>
        </span>
        <span className="font-bold text-[var(--gold)]">{money(order.total_cents)}</span>
      </p>
      <p className="text-xs text-[var(--ink-dim)]">
        {ESTADO_PEDIDO[order.status] ?? order.status}
        {order.paid ? ' · Paga' : cancelado ? '' : ' · Por cobrar'}
      </p>
      <ul className="text-sm text-[var(--ink-dim)]">
        {order.items.map((item, i) => (
          <li key={i}>
            {item.qty}× {itemLabel({ ...item, person: null })}
          </li>
        ))}
        {order.removed.map((r, i) => (
          <li key={`r${i}`} className="text-red-300 line-through decoration-red-300/60">
            {r.qty}× {r.name}
            <span className="ml-2 inline-block text-xs no-underline">{r.reason}</span>
          </li>
        ))}
      </ul>
    </li>
  );
}
