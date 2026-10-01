'use client';

import { useEffect, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { formatMT, type Cents } from '@delivery/core';

import { createClient } from '@/utils/supabase/client';
import { VOID_REASON_MAX, voidDeliveredOrder, voidReasonReady } from '@/lib/admin/void-delivered-order';

/**
 * "Anular" num pedido já entregue (1112): só o dono o vê, e o servidor
 * confirma-o outra vez. Um pedido de teste ou lançado por engano sai do caixa
 * e dos relatórios e o stock volta; o pedido fica na lista como Cancelado,
 * com o motivo.
 */

type Pedido = { id: string; order_number: string; customer_name: string; total_cents: number; status: string };

/** O perfil de quem está no painel, uma consulta por pessoa e não uma por linha. */
const donoPorUtilizador = new Map<string, Promise<boolean>>();

function useEDono(supabase: SupabaseClient): boolean {
  const [dono, setDono] = useState(false);
  useEffect(() => {
    let vivo = true;
    void (async () => {
      const { data } = await supabase.auth.getSession();
      const userId = data.session?.user.id;
      if (!userId) return;
      let pedido = donoPorUtilizador.get(userId);
      if (!pedido) {
        pedido = Promise.resolve(
          supabase.from('staff_profiles').select('role').eq('user_id', userId).maybeSingle(),
        ).then(({ data: perfil }) => perfil?.role === 'owner', () => false);
        donoPorUtilizador.set(userId, pedido);
      }
      const resposta = await pedido;
      if (vivo) setDono(resposta);
    })();
    return () => {
      vivo = false;
    };
  }, [supabase]);
  return dono;
}

export function AnularEntregue({ order, onDone }: {
  order: Pedido;
  /** Depois de anular: a página relê a lista e mostra a mensagem. */
  onDone: (message: { type: 'success' | 'error'; text: string }) => void;
}) {
  const [supabase] = useState(() => createClient());
  const dono = useEDono(supabase);
  const [aberto, setAberto] = useState(false);
  const [motivo, setMotivo] = useState('');
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  if (!dono || order.status !== 'delivered') return null;

  function fechar() {
    if (busy) return;
    setAberto(false);
    setMotivo('');
    setErro(null);
  }

  async function confirmar() {
    if (busy || !voidReasonReady(motivo)) return;
    setBusy(true);
    setErro(null);
    const result = await voidDeliveredOrder(supabase, order.id, motivo);
    setBusy(false);
    if (!result.ok) {
      setErro(result.message);
      return;
    }
    setAberto(false);
    setMotivo('');
    onDone({
      type: 'success',
      text: result.duplicate
        ? `Pedido ${order.order_number} já estava anulado.`
        : `Pedido ${order.order_number} anulado.${result.shiftClosed ? ' O turno em que entrou já tinha fechado: o relatório desse turno não muda.' : ''}`,
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setAberto(true)}
        className="rounded-xl bg-white/[0.06] px-3 py-1.5 text-xs font-semibold text-red-400 transition-all hover:bg-red-900/20"
      >
        Anular
      </button>

      {aberto && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-[4px]">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby={`anular-${order.id}`}
            className="w-full max-w-md space-y-4 rounded-2xl border border-white/[0.10] bg-white/[0.06] p-6 shadow-[0_20px_60px_rgba(0,0,0,0.6),0_0_40px_rgba(245,166,35,0.08)] backdrop-blur-[20px]"
          >
            <h3 id={`anular-${order.id}`} className="text-lg font-bold text-white">
              Anular pedido entregue {order.order_number}
            </h3>
            <div className="space-y-1 text-sm text-[#C9BCAC]">
              <p>Cliente: {order.customer_name}</p>
              <p>Total: {formatMT(order.total_cents as Cents)}</p>
            </div>
            <ul className="space-y-1 rounded-xl bg-black/30 p-3 text-xs leading-relaxed text-[#C9BCAC]">
              <li>• O pedido fica na lista como <strong className="text-white">Cancelado</strong>, com o motivo e o teu nome no histórico.</li>
              <li>• O stock e os ingredientes que gastou voltam.</li>
              <li>• O pagamento sai do caixa e dos relatórios. Se o turno em que entrou já fechou, o relatório desse turno não muda.</li>
              <li>• O cliente não recebe email.</li>
            </ul>
            <textarea
              value={motivo}
              maxLength={VOID_REASON_MAX}
              onChange={(event) => setMotivo(event.target.value)}
              rows={3}
              autoFocus
              placeholder="Motivo (obrigatório) — ex.: pedido de teste"
              className="w-full rounded-xl border border-white/[0.08] bg-black/30 p-3 text-sm text-white placeholder-[#8A7A69] transition-colors focus:border-[#F5A623]/50 focus:outline-none"
            />
            {erro && <p role="alert" className="text-sm text-red-300">{erro}</p>}
            <div className="flex gap-3">
              <button
                type="button"
                onClick={fechar}
                disabled={busy}
                className="flex-1 rounded-xl bg-white/[0.06] px-4 py-2.5 text-[#C9BCAC] transition-all hover:bg-white/[0.10] disabled:opacity-50"
              >
                Voltar
              </button>
              <button
                type="button"
                onClick={() => void confirmar()}
                disabled={busy || !voidReasonReady(motivo)}
                className="flex-1 rounded-xl bg-red-600 px-4 py-2.5 font-semibold text-white transition-all hover:bg-red-500 disabled:opacity-50"
              >
                {busy ? 'A anular…' : 'Anular pedido'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
