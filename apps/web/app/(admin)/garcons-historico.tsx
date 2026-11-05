'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { formatMT, type Cents } from '@delivery/core';

import { InsightEmpty, InsightPanel } from '@/components/admin/insights-ui';
import { waiterAdminErrorMessage } from '@/lib/garcom/admin';
import type { WaiterOrderRow } from '@/lib/garcom/contract';
import { ESTADO_PEDIDO } from '@/lib/garcom/pedido';
import { POS_PAYMENT_METHOD_NAMES, type PosPaymentMethodId } from '@/lib/pos/settings';
import { itemLabel } from '@/lib/pos/tables';
import { createClient } from '@/utils/supabase/client';

const money = (c: number) => formatMT(c as Cents);
const POR_PAGINA = 20;
const quando = (iso: string) =>
  new Date(iso).toLocaleString('pt-PT', {
    timeZone: 'Africa/Maputo',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });

/** Todos os pedidos de um garçom no período, com o que foi retirado e porquê (1127). */
export function GarconsHistorico({
  storeId,
  waiterId,
  nome,
  from,
  to,
}: {
  storeId: string | null;
  waiterId: string;
  nome: string;
  from: string | null;
  to: string | null;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [pagina, setPagina] = useState(0);
  useEffect(() => setPagina(0), [waiterId, from, storeId]);

  const lista = useQuery({
    queryKey: ['garcons-historico', storeId, waiterId, from, pagina],
    queryFn: async (): Promise<{ total: number; orders: WaiterOrderRow[] }> => {
      const { data, error } = await supabase.rpc('get_waiter_orders', {
        p_store_id: storeId,
        p_waiter_id: waiterId,
        p_from: from,
        p_to: to,
        p_limit: POR_PAGINA,
        p_offset: pagina * POR_PAGINA,
      });
      if (error) throw new Error(waiterAdminErrorMessage(error.message));
      return data as { total: number; orders: WaiterOrderRow[] };
    },
  });

  const total = lista.data?.total ?? 0;
  const paginas = Math.max(1, Math.ceil(total / POR_PAGINA));

  return (
    <InsightPanel title={`Histórico de ${nome}`} description={`${total} ${total === 1 ? 'pedido' : 'pedidos'} neste período, do mais recente para o mais antigo`}>
      {lista.error && <p className="insight-notice">{(lista.error as Error).message}</p>}
      {lista.isLoading ? (
        <p className="insight-subtitle">A carregar…</p>
      ) : lista.data && lista.data.orders.length === 0 ? (
        <InsightEmpty title="Sem pedidos neste período" />
      ) : (
        <ul className="divide-y divide-white/[0.06]">
          {lista.data?.orders.map((o) => <Linha key={o.id} order={o} />)}
        </ul>
      )}
      {paginas > 1 && (
        <nav className="mt-4 flex items-center justify-between gap-3 text-sm text-[#c6b9a8]" aria-label="Páginas do histórico">
          <button className="insight-button" disabled={pagina === 0} onClick={() => setPagina((p) => p - 1)}>
            Anteriores
          </button>
          <span>Página {pagina + 1} de {paginas}</span>
          <button className="insight-button" disabled={pagina + 1 >= paginas} onClick={() => setPagina((p) => p + 1)}>
            Seguintes
          </button>
        </nav>
      )}
    </InsightPanel>
  );
}

function Linha({ order }: { order: WaiterOrderRow }) {
  const cancelado = order.status === 'cancelled';
  const meios = (order.payments ?? [])
    .map((p) => POS_PAYMENT_METHOD_NAMES[p.method as PosPaymentMethodId] ?? p.method)
    .join(' + ');
  return (
    <li className={`space-y-1 py-3 ${cancelado ? 'opacity-60' : ''}`}>
      <p className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-sm">
        <span className="font-semibold text-white">
          {quando(order.created_at)} · {order.table_number != null ? `Mesa ${order.table_number}` : 'Sem mesa'}
          <span className="ml-2 font-normal text-[#c6b9a8]">{order.order_number}</span>
        </span>
        <span className="font-semibold tabular-nums text-white">{money(order.total_cents)}</span>
      </p>
      <p className="text-xs text-[#c6b9a8]">
        {ESTADO_PEDIDO[order.status] ?? order.status}
        {order.paid ? ` · Paga${meios ? ` por ${meios}` : ''}` : cancelado ? '' : ' · Por cobrar'}
        {order.charged_by_waiter ? ` · Cobrada no telemóvel por ${order.charged_by_waiter}` : ''}
      </p>
      <ul className="text-sm text-[#c6b9a8]">
        {order.items.map((item, i) => (
          <li key={i}>
            <b className="tabular-nums text-[#f2c572]">{item.qty}×</b> {itemLabel({ ...item, person: null })}
            {item.notes && <span className="ml-2 text-xs italic">{item.notes}</span>}
          </li>
        ))}
        {order.removed.map((r, i) => (
          <li key={`r${i}`} className="text-red-300">
            Retirado: {r.qty}× {r.name} ({money(r.removed_cents)}) · {r.reason} ·{' '}
            {r.by_waiter ? 'pelo garçom' : 'no balcão'}
          </li>
        ))}
      </ul>
      {order.notes && <p className="text-xs italic text-[#c6b9a8]">{order.notes}</p>}
    </li>
  );
}
