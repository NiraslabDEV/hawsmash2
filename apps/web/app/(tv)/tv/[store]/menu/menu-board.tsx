'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { formatMT, type Cents } from '@delivery/core';

import { createClient } from '@/utils/supabase/client';

type BoardItem = {
  id: string;
  name: string;
  price_cents: number;
  available: boolean;
  track_stock?: boolean;
  stock_qty?: number | null;
};

type BoardCategory = { id: string; name: string; items: BoardItem[] };

const REFRESH_MS = 60_000;
const mt = (value: number) => formatMT(value as Cents);

/**
 * Cardápio de parede: preços e esgotados ao vivo. Se a rede falhar, continua a
 * mostrar o último cardápio conhecido — nunca um ecrã em branco (CLAUDE §14).
 */
export function MenuBoard({ storeSlug, storeName }: { storeSlug: string; storeName: string }) {
  const supabase = useMemo(() => createClient(), []);
  const [categories, setCategories] = useState<BoardCategory[]>([]);
  const [stale, setStale] = useState(false);

  const refresh = useCallback(async () => {
    const { data, error } = await supabase.rpc('get_store_board', {
      p_store_slug: storeSlug,
    });
    if (error || !data) {
      setStale(true);
      return;
    }
    setCategories((data as { categories: BoardCategory[] }).categories ?? []);
    setStale(false);
  }, [storeSlug, supabase]);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [refresh]);

  return (
    <main className="min-h-screen p-8">
      <header className="flex items-baseline justify-between">
        <h1 className="text-4xl font-black uppercase tracking-widest" style={{ color: 'var(--tv-primary)' }}>
          HAWSMASH {storeName}
        </h1>
        {stale && (
          <span className="text-xl font-bold" style={{ color: '#ff9b9b' }}>
            A reconectar…
          </span>
        )}
      </header>

      <section className="mt-8 grid gap-8 md:grid-cols-2">
        {categories.map((category) => (
          <article key={category.id}>
            <h2
              className="border-b pb-2 text-3xl font-black uppercase tracking-wide"
              style={{ borderColor: 'var(--tv-line)', color: 'var(--tv-muted)' }}
            >
              {category.name}
            </h2>
            <ul className="mt-4 space-y-3">
              {category.items.map((item) => (
                <li
                  key={item.id}
                  className="flex items-baseline justify-between gap-4 text-3xl"
                  style={{ opacity: item.available ? 1 : 0.35 }}
                >
                  <span className="font-bold">{item.name}</span>
                  <span className="font-black" style={{ color: 'var(--tv-primary)' }}>
                    {item.available ? mt(item.price_cents) : 'ESGOTADO'}
                  </span>
                </li>
              ))}
            </ul>
          </article>
        ))}
        {categories.length === 0 && (
          <p className="text-3xl" style={{ color: 'var(--tv-muted-2)' }}>
            A carregar o cardápio…
          </p>
        )}
      </section>
    </main>
  );
}
