'use client';

import { useCallback, useEffect, useState } from 'react';
import { createClient } from '@/utils/supabase/client';
import { advanceErrorMessage } from '@/lib/pos/orders-board';
import {
  TICKET_SELECT,
  TICKET_STATUSES,
  maputoDayStart,
  parseTicket,
  pressTicketKey,
  splitTickets,
  ticketErrorMessage,
  ticketLabel,
  type TicketOrder,
} from '@/lib/pos/senhas';
import { PosIcon } from './pos-icons';

/** Sem realtime, a lista anda sozinha a este ritmo (CLAUDE §11.3). */
const POLL_MS = 10_000;

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'C', '0', '⌫'];

type Feedback = { tone: 'ok' | 'danger'; text: string };

/**
 * A aba Senhas: o caixa digita a senha que a cozinha pôs no balcão e ela vai
 * para a TV como PEDIDO PRONTO.
 *
 * A TV mostra tudo o que está `ready` na loja — não só o que se digita aqui.
 * Um pedido posto em pronto pela seta do quadro de Pedidos aparece na TV e
 * nesta lista da mesma forma; esta aba é só o caminho mais curto até lá.
 */
export function SenhasTab({
  storeId,
  storeName,
  keyboardActive,
}: {
  storeId: string;
  storeName: string;
  /** Falso com um pagamento ou outro painel aberto: aí os algarismos são deles. */
  keyboardActive: boolean;
}) {
  const [supabase] = useState(() => createClient());
  const [orders, setOrders] = useState<TicketOrder[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  /** Pedidos com um toque em curso — não se entrega duas vezes o mesmo. */
  const [delivering, setDelivering] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from('orders')
      .select(TICKET_SELECT)
      .eq('store_id', storeId)
      .in('status', [...TICKET_STATUSES])
      .gte('created_at', maputoDayStart())
      .order('created_at', { ascending: false })
      .limit(200);
    if (error) {
      setLoadError('Não foi possível actualizar. A lista é da última consulta.');
      return;
    }
    setLoadError(null);
    setOrders((data ?? []) as TicketOrder[]);
  }, [storeId, supabase]);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), POLL_MS);
    return () => window.clearInterval(timer);
  }, [load]);

  // Realtime só dispara o refetch; nunca constrói a lista (§11.3).
  useEffect(() => {
    const channel = supabase
      .channel(`pos-senhas-${storeId}`)
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

  const call = useCallback(
    async (numero: number) => {
      if (busy) return;
      setBusy(true);
      const { data, error } = await supabase.rpc('call_ticket', {
        p_store_id: storeId,
        p_daily_number: numero,
      });
      setBusy(false);
      if (error) {
        setFeedback({ tone: 'danger', text: ticketErrorMessage(error.message, numero) });
        void load();
        return;
      }
      const result = data as { channel: string | null; fulfillment_type: string | null; already_ready: boolean };
      const label = ticketLabel(result);
      setFeedback({
        tone: 'ok',
        text: result.already_ready
          ? `A senha ${numero} já estava na TV · ${label}`
          : `Senha ${numero} na TV · PEDIDO PRONTO · ${label}`,
      });
      setInput('');
      void load();
    },
    [busy, load, storeId, supabase],
  );

  const submit = useCallback(() => {
    const numero = parseTicket(input);
    if (numero != null) void call(numero);
  }, [call, input]);

  // Num PC com teclado, os algarismos e o Enter também servem.
  useEffect(() => {
    if (!keyboardActive) return;
    function onKey(event: KeyboardEvent) {
      const alvo = event.target as HTMLElement | null;
      if (alvo && (alvo.tagName === 'INPUT' || alvo.tagName === 'TEXTAREA' || alvo.isContentEditable)) return;
      if (/^\d$/.test(event.key)) setInput((current) => pressTicketKey(current, event.key));
      else if (event.key === 'Backspace') setInput((current) => pressTicketKey(current, '⌫'));
      else if (event.key === 'Escape') setInput('');
      else if (event.key === 'Enter') submit();
      else return;
      event.preventDefault();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [keyboardActive, submit]);

  async function deliver(order: TicketOrder) {
    if (delivering.has(order.id)) return;
    setDelivering((current) => new Set(current).add(order.id));
    const { error } = await supabase.rpc('advance_order', { p_order_id: order.id, p_event: 'DELIVER' });
    setDelivering((current) => {
      const next = new Set(current);
      next.delete(order.id);
      return next;
    });
    setFeedback(
      error
        ? { tone: 'danger', text: advanceErrorMessage(error.message).texto }
        : { tone: 'ok', text: `Senha ${order.daily_number} entregue · saiu da TV` },
    );
    void load();
  }

  const { preparing, ready } = splitTickets(orders);
  const numero = parseTicket(input);

  return (
    <div className="mx-auto grid w-full max-w-5xl gap-3 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
      <div className="flex flex-col gap-3">
        <div>
          <h2 className="text-xl font-bold">Senhas · {storeName}</h2>
          <p className="text-sm text-ink-mute">Digita a senha que está pronta e ela aparece na TV.</p>
        </div>

        <div className="pos-well grid min-h-24 place-items-center !py-3">
          <span className={`pos-num text-6xl font-extrabold leading-none ${input ? 'text-gold' : 'text-ink-mute'}`}>
            {input || '—'}
          </span>
        </div>

        <div className="grid grid-cols-3 gap-2">
          {KEYS.map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => setInput((current) => pressTicketKey(current, key))}
              className={`pos-key ${key === 'C' || key === '⌫' ? 'pos-key--muted' : ''}`}
            >
              {key}
            </button>
          ))}
        </div>

        <button
          type="button"
          disabled={numero == null || busy}
          onClick={submit}
          className="pos-btn pos-btn--ok pos-btn--lg w-full"
        >
          <PosIcon name="check" size={22} />
          {busy ? 'A chamar…' : numero != null ? `Senha ${numero} pronta` : 'Pedido pronto'}
        </button>

        {feedback && (
          <p role="status" className={`pos-note ${feedback.tone === 'ok' ? 'pos-note--ok' : 'pos-note--danger'} !text-base !font-bold`}>
            {feedback.text}
          </p>
        )}
      </div>

      <div className="flex min-w-0 flex-col gap-4">
        {loadError && <p role="alert" className="pos-note pos-note--warn">{loadError}</p>}

        <section>
          <h3 className="pos-eyebrow mb-2">Na TV · pronto ({ready.length})</h3>
          {ready.length === 0 ? (
            <p className="rounded-2xl border border-white/[0.07] bg-bg2 p-4 text-center text-sm text-ink-mute">
              Nenhuma senha na TV.
            </p>
          ) : (
            <ul className="grid gap-2 sm:grid-cols-2">
              {ready.map((order) => (
                <li
                  key={order.id}
                  className="flex items-center gap-3 rounded-2xl border border-emerald-500/30 bg-emerald-500/[0.07] p-3"
                >
                  <span className="pos-num min-w-16 text-center text-4xl font-extrabold text-emerald-200">
                    {order.daily_number}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[11px] font-bold tracking-[0.15em] text-ink-dim">
                      {ticketLabel(order)}
                    </span>
                    {order.customer_name && (
                      <span className="block truncate text-sm text-ink-mute">{order.customer_name}</span>
                    )}
                  </span>
                  {/* Entregue tira a senha da TV. Sem isto a TV enchia-se de
                      números que já saíram pela porta. */}
                  <button
                    type="button"
                    disabled={delivering.has(order.id)}
                    onClick={() => void deliver(order)}
                    className="pos-btn !min-h-12 shrink-0 !rounded-[14px] !px-3.5 !text-sm"
                  >
                    Entregue
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section>
          <h3 className="pos-eyebrow mb-2">Em preparo ({preparing.length}) · toca para pôr pronto</h3>
          {preparing.length === 0 ? (
            <p className="rounded-2xl border border-white/[0.07] bg-bg2 p-4 text-center text-sm text-ink-mute">
              Nada em preparo.
            </p>
          ) : (
            <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4 xl:grid-cols-5">
              {preparing.map((order) => (
                <li key={order.id}>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => order.daily_number != null && void call(order.daily_number)}
                    aria-label={`Pôr a senha ${order.daily_number} pronta`}
                    className="flex min-h-20 w-full flex-col items-center justify-center rounded-2xl border border-white/[0.07] bg-bg2 p-2 active:bg-white/10 disabled:opacity-50"
                  >
                    <span className="pos-num text-3xl font-extrabold leading-none text-ink">{order.daily_number}</span>
                    <span className="mt-1 text-[10px] font-bold tracking-[0.12em] text-ink-dim">
                      {ticketLabel(order)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
