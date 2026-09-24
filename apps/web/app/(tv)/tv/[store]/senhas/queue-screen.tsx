'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useBrand } from '@/lib/brand/context';
import { newlyReady, ticketLabel } from '@/lib/pos/senhas';
import { createClient } from '@/utils/supabase/client';

type QueueEntry = {
  daily_number: number;
  order_number: string;
  channel?: string | null;
  fulfillment_type?: string | null;
};

type Queue = {
  store: { slug: string; short_name: string };
  updated_at: string;
  ready: QueueEntry[];
  preparing: QueueEntry[];
};

// A senha chamada no POS tem de aparecer enquanto o caixa ainda a está a dizer.
const REFRESH_MS = 5_000;
/** Quanto tempo a senha acabada de ficar pronta ocupa o ecrã inteiro. */
const HIGHLIGHT_MS = 8_000;

/**
 * Ecrã de senhas do balcão. Recarrega sozinho e, se o backend falhar, mantém o
 * último estado conhecido em vez de ficar em branco (CLAUDE §14).
 */
export function QueueScreen({ storeSlug, storeName }: { storeSlug: string; storeName: string }) {
  const brand = useBrand();
  const supabase = useMemo(() => createClient(), []);
  const [queue, setQueue] = useState<Queue | null>(null);
  const [stale, setStale] = useState(false);
  const [highlight, setHighlight] = useState<QueueEntry | null>(null);
  /** As senhas prontas da leitura anterior — `null` até à primeira. */
  const known = useRef<Set<string> | null>(null);
  const highlightTimer = useRef<number | undefined>(undefined);

  const refresh = useCallback(async () => {
    const { data, error } = await supabase.rpc('get_store_queue', { p_store_slug: storeSlug });
    if (error || !data) {
      setStale(true);
      return;
    }
    const next = data as Queue;
    const novas = newlyReady(known.current, next.ready);
    known.current = new Set(next.ready.map((entry) => entry.order_number));
    // `ready` vem do mais recente para o mais antigo: destaca-se o último chamado.
    if (novas[0]) {
      setHighlight(novas[0]);
      window.clearTimeout(highlightTimer.current);
      highlightTimer.current = window.setTimeout(() => setHighlight(null), HIGHLIGHT_MS);
    }
    setQueue(next);
    setStale(false);
  }, [storeSlug, supabase]);

  useEffect(() => () => window.clearTimeout(highlightTimer.current), []);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const ready = queue?.ready ?? [];
  const preparing = queue?.preparing ?? [];

  return (
    <main className="flex min-h-screen flex-col p-8">
      <header className="flex items-baseline justify-between">
        <h1 className="text-4xl font-black uppercase tracking-widest" style={{ color: 'var(--tv-primary)' }}>
          {brand.name} {storeName}
        </h1>
        <span className="text-2xl font-bold" style={{ color: stale ? '#ff9b9b' : 'var(--tv-muted-2)' }}>
          {stale ? 'A reconectar…' : 'Pedido pronto'}
        </span>
      </header>

      <section className="mt-8 flex-1">
        {ready.length === 0 ? (
          <p className="grid h-full place-items-center text-5xl font-black" style={{ color: 'var(--tv-muted-2)' }}>
            Sem senhas prontas
          </p>
        ) : (
          <ul className="grid grid-cols-2 gap-6 md:grid-cols-3">
            {ready.map((entry) => (
              <li
                key={entry.order_number}
                className="grid place-items-center rounded-3xl py-10"
                style={{ background: 'var(--tv-card)', border: '4px solid var(--tv-primary)' }}
              >
                <span className="text-[8rem] font-black leading-none" style={{ color: 'var(--tv-primary)' }}>
                  {entry.daily_number}
                </span>
                <span className="mt-2 text-3xl font-bold uppercase tracking-widest" style={{ color: 'var(--tv-muted)' }}>
                  {ticketLabel({ channel: entry.channel ?? null, fulfillment_type: entry.fulfillment_type ?? null })}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <footer className="mt-8 border-t pt-6" style={{ borderColor: 'var(--tv-line)' }}>
        <h2 className="text-2xl font-bold uppercase tracking-wide" style={{ color: 'var(--tv-muted)' }}>
          Em preparo
        </h2>
        <ul className="mt-4 flex flex-wrap gap-4">
          {preparing.length === 0 && (
            <li className="text-3xl font-bold" style={{ color: 'var(--tv-muted-2)' }}>
              —
            </li>
          )}
          {preparing.map((entry) => (
            <li
              key={entry.order_number}
              className="rounded-2xl px-6 py-3 text-4xl font-black"
              style={{ background: 'var(--tv-card)', color: 'var(--tv-text)' }}
            >
              {entry.daily_number}
            </li>
          ))}
        </ul>
      </footer>

      {/* A senha acabada de chamar ocupa o ecrã: quem está sentado de costas
          para a TV vê-a mudar pelo canto do olho. */}
      {highlight && (
        <div
          role="status"
          className="fixed inset-0 grid place-items-center p-8"
          style={{ background: 'var(--tv-bg, #000)' }}
        >
          <div className="text-center">
            <p className="text-6xl font-black uppercase tracking-widest" style={{ color: 'var(--tv-text)' }}>
              Pedido pronto
            </p>
            <p className="text-[18rem] font-black leading-none" style={{ color: 'var(--tv-primary)' }}>
              {highlight.daily_number}
            </p>
            <p className="text-6xl font-bold uppercase tracking-widest" style={{ color: 'var(--tv-muted)' }}>
              {ticketLabel({ channel: highlight.channel ?? null, fulfillment_type: highlight.fulfillment_type ?? null })}
            </p>
          </div>
        </div>
      )}
    </main>
  );
}
