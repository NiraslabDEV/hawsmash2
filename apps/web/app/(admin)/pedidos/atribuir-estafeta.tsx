'use client';

import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { courierAdminErrorMessage } from '@/lib/estafeta/admin';
import { createClient } from '@/utils/supabase/client';

type OrderRef = { id: string; store_id?: string | null; status: string; fulfillment_type: string };
type Entrega = { order_id: string; courier_id: string; status: 'assigned' | 'picked_up' | 'delivered' };
type Estafeta = { id: string; full_name: string; on_shift: boolean };

const ATRIBUIVEL = ['approved', 'paid', 'in_preparation', 'ready', 'delivered'];

/**
 * "Quem leva?" num pedido de entrega (1115). Atribuir não muda o estado do
 * pedido: é o estafeta que, ao carregar em "Levantei", faz o que o "Enviar"
 * fazia. Enquanto não levantou, troca-se ou tira-se.
 *
 * As leituras são por loja e partilhadas por todos os pedidos da lista — uma
 * consulta, não uma por pedido.
 */
export function AtribuirEstafeta({ order, onDone }: { order: OrderRef; onDone: (r: { type: 'success' | 'error'; text: string }) => void }) {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  const storeId = order.store_id ?? null;
  const elegivel = order.fulfillment_type === 'delivery' && ATRIBUIVEL.includes(order.status) && Boolean(storeId);
  const [aGuardar, setAGuardar] = useState(false);

  const estafetas = useQuery({
    queryKey: ['estafetas-activos', storeId],
    enabled: elegivel,
    staleTime: 30_000,
    queryFn: async (): Promise<Estafeta[]> => {
      const { data } = await supabase
        .from('couriers').select('id,full_name,on_shift')
        .eq('store_id', storeId!).eq('active', true)
        .order('on_shift', { ascending: false }).order('full_name');
      return (data ?? []) as Estafeta[];
    },
  });

  const entregas = useQuery({
    queryKey: ['entregas-abertas', storeId],
    enabled: elegivel,
    refetchInterval: 15_000,
    queryFn: async (): Promise<Entrega[]> => {
      const desde = new Date(Date.now() - 24 * 3600_000).toISOString();
      const { data } = await supabase
        .from('deliveries').select('order_id,courier_id,status')
        .eq('store_id', storeId!).gte('assigned_at', desde).limit(500);
      return (data ?? []) as Entrega[];
    },
  });

  if (!elegivel || !estafetas.data || estafetas.data.length === 0) return null;

  const entrega = entregas.data?.find((e) => e.order_id === order.id) ?? null;
  const nome = (id: string) => estafetas.data!.find((c) => c.id === id)?.full_name ?? 'Estafeta';

  if (entrega && entrega.status !== 'assigned') {
    return (
      <span className="inline-flex items-center rounded-xl bg-sky-500/10 px-3 py-1.5 text-xs font-semibold text-sky-300">
        🛵 {nome(entrega.courier_id)} · {entrega.status === 'picked_up' ? 'a caminho' : 'entregue'}
      </span>
    );
  }
  // Pedido já enviado sem estafeta: não se atribui depois do facto.
  if (!entrega && order.status === 'delivered') return null;

  const mudar = async (courierId: string) => {
    setAGuardar(true);
    const { error } = courierId
      ? await supabase.rpc('assign_courier', { p_order_id: order.id, p_courier_id: courierId })
      : await supabase.rpc('unassign_courier', { p_order_id: order.id });
    setAGuardar(false);
    await queryClient.invalidateQueries({ queryKey: ['entregas-abertas', storeId] });
    if (error) onDone({ type: 'error', text: courierAdminErrorMessage(error.message) });
    else onDone({ type: 'success', text: courierId ? `Atribuído a ${nome(courierId)}.` : 'Estafeta retirado.' });
  };

  return (
    <select
      disabled={aGuardar}
      value={entrega?.courier_id ?? ''}
      onChange={(e) => void mudar(e.target.value)}
      className="rounded-xl border border-white/10 bg-white/[0.06] px-2 py-1.5 text-xs font-semibold text-white outline-none disabled:opacity-50"
      aria-label="Estafeta"
    >
      <option value="">🛵 Quem leva?</option>
      {estafetas.data.map((c) => (
        <option key={c.id} value={c.id}>
          {c.full_name}{c.on_shift ? '' : ' (fora de serviço)'}
        </option>
      ))}
    </select>
  );
}
