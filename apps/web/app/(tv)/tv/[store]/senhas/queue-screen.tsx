'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import { createClient } from '@/utils/supabase/client';

type QueueEntry = { daily_number: number; order_number: string };

type Queue = {
  store: { slug: string; short_name: string };
  updated_at: string;
  ready: QueueEntry[];
  preparing: QueueEntry[];
};

const REFRESH_MS = 10_000;

/**
 * Ecrã de senhas do balcão. Recarrega sozinho e, se o backend falhar, mantém o
 * último estado conhecido em vez de ficar em branco (CLAUDE §14).
 */
export function QueueScreen({ storeSlug, storeName }: { storeSlug: string; storeName: string }) {
  const supabase = useMemo(() => createClient(), []);
  const [queue, setQueue] = useState<Queue | null>(null);
  const [stale, setStale] = useState(false);

  const refresh = useCallback(async () => {
    const { data, error } = await supabase.rpc('get_store_queue', { p_store_slug: storeSlug });
    if (error || !data) {
      setStale(true);
      return;
    }
    setQueue(data as Queue);
    setStale(false);
  }, [storeSlug, supabase]);

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
          HAWSMASH {storeName}
        </h1>
        <span className="text-2xl font-bold" style={{ color: stale ? '#ff9b9b' : 'var(--tv-muted-2)' }}>
          {stale ? 'A reconectar…' : 'Pronto a levantar'}
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
    </main>
  );
}
