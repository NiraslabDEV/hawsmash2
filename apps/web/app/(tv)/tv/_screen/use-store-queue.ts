'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { newlyReady } from '@/lib/pos/senhas';
import { createClient } from '@/utils/supabase/client';

export type QueueEntry = {
  daily_number: number;
  order_number: string;
  channel?: string | null;
  fulfillment_type?: string | null;
  ready_at?: string | null;
};

export type Queue = {
  store: { slug: string; short_name: string };
  updated_at: string;
  ready: QueueEntry[];
  preparing: QueueEntry[];
};

// A senha chamada no POS tem de aparecer enquanto o caixa ainda a está a dizer.
const REFRESH_MS = 5_000;

/**
 * A fila de senhas da loja, relida de 5 em 5 s. Se o backend falhar, mantém o
 * último estado conhecido e marca `stale` — nunca um ecrã em branco (§14).
 *
 * `highlight` é a senha acabada de ficar pronta, durante `highlightSeconds`
 * (0 = não destaca). `onNewReady` corre uma vez por senha nova (o toque).
 */
export function useStoreQueue(
  storeSlug: string,
  opts: { enabled?: boolean; highlightSeconds: number; onNewReady?: (entry: QueueEntry) => void },
) {
  const { enabled = true, highlightSeconds } = opts;
  const supabase = useMemo(() => createClient(), []);
  const [queue, setQueue] = useState<Queue | null>(null);
  const [stale, setStale] = useState(false);
  const [highlight, setHighlight] = useState<QueueEntry | null>(null);
  /** As senhas prontas da leitura anterior — `null` até à primeira. */
  const known = useRef<Set<string> | null>(null);
  const highlightTimer = useRef<number | undefined>(undefined);
  const onNewReady = useRef(opts.onNewReady);
  onNewReady.current = opts.onNewReady;
  const highlightMs = useRef(highlightSeconds * 1000);
  highlightMs.current = highlightSeconds * 1000;

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
      onNewReady.current?.(novas[0]);
      if (highlightMs.current > 0) {
        setHighlight(novas[0]);
        window.clearTimeout(highlightTimer.current);
        highlightTimer.current = window.setTimeout(() => setHighlight(null), highlightMs.current);
      }
    }
    setQueue(next);
    setStale(false);
  }, [storeSlug, supabase]);

  useEffect(() => () => window.clearTimeout(highlightTimer.current), []);

  useEffect(() => {
    if (!enabled) return;
    void refresh();
    const timer = window.setInterval(() => void refresh(), REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [enabled, refresh]);

  return { queue, stale, highlight };
}
