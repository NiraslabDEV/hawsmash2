'use client';

import { useState } from 'react';
import { createClient } from '@/utils/supabase/client';
import { REJECT_REASONS, advanceErrorMessage } from '@/lib/pos/orders-board';

/**
 * Aprovar ou recusar um pedido da internet, ali mesmo no cartão.
 *
 * É o mesmo par de botões no quadro (coluna INTERNET), na conferência do
 * comprovativo e na aba Delivery do POS — uma só implementação, para que as
 * três portas façam exactamente a mesma coisa no servidor: `advance_order`
 * com APPROVE (desconta stock e manda a comanda) ou CANCEL com motivo.
 *
 * Recusar abre uma escolha de motivo de um toque. Sem motivo o servidor
 * recusa (`cancel_reason_required`), e sem motivo ninguém sabe responder ao
 * cliente que liga a perguntar porquê.
 */
export function OrderDecision({
  orderId,
  numero,
  size = 'md',
  onDone,
  onError,
}: {
  orderId: string;
  /** Como o pedido se chama no ecrã: o número do dia ou o MPT-0042. */
  numero: string;
  size?: 'md' | 'lg';
  onDone: () => void;
  onError: (erro: { texto: string; mudouDeEstado: boolean }) => void;
}) {
  const [supabase] = useState(() => createClient());
  const [busy, setBusy] = useState(false);
  const [recusar, setRecusar] = useState(false);

  async function decide(event: 'APPROVE' | 'CANCEL', reason?: string) {
    if (busy) return;
    setBusy(true);
    const { error } = await supabase.rpc('advance_order', {
      p_order_id: orderId,
      p_event: event,
      ...(reason ? { p_reason: reason } : {}),
    });
    setBusy(false);
    setRecusar(false);
    if (error) {
      onError(advanceErrorMessage(error.message));
      return;
    }
    onDone();
  }

  const altura = size === 'lg' ? 'min-h-20 text-2xl' : 'min-h-16 text-lg';

  return (
    <>
      <div className="grid grid-cols-[2fr_1fr] gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => void decide('APPROVE')}
          aria-label={`Aprovar pedido ${numero}`}
          className={`flex items-center justify-center rounded-xl bg-emerald-400 font-black text-black active:scale-[0.98] disabled:opacity-40 ${altura}`}
        >
          {busy ? '…' : 'Aprovar'}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => setRecusar(true)}
          aria-label={`Recusar pedido ${numero}`}
          className={`flex items-center justify-center rounded-xl bg-red-500/20 font-black text-red-200 ring-1 ring-red-500/50 active:scale-[0.98] disabled:opacity-40 ${altura}`}
        >
          Recusar
        </button>
      </div>

      {recusar && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`Recusar pedido ${numero}`}
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-6"
        >
          <div className="w-full max-w-xl rounded-3xl border border-white/10 bg-[#141210] p-6 text-[#f6f1e6]">
            <p className="text-xs font-black tracking-[0.25em] text-[#847e72]">RECUSAR PEDIDO {numero}</p>
            <h3 className="mt-1 text-2xl font-black">Porquê?</h3>
            <div className="mt-4 grid grid-cols-2 gap-3">
              {REJECT_REASONS.map((motivo) => (
                <button
                  key={motivo}
                  type="button"
                  disabled={busy}
                  onClick={() => void decide('CANCEL', motivo)}
                  className="min-h-16 rounded-2xl bg-white/[0.07] px-3 text-base font-black leading-tight active:bg-red-500/30 disabled:opacity-40"
                >
                  {motivo}
                </button>
              ))}
            </div>
            <button
              type="button"
              disabled={busy}
              onClick={() => setRecusar(false)}
              className="mt-4 min-h-16 w-full rounded-2xl bg-white/10 text-lg font-black active:bg-white/20 disabled:opacity-40"
            >
              {busy ? 'A recusar…' : 'Voltar — não recusar'}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
