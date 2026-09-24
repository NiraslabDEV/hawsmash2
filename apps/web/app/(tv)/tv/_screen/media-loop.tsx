'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';

import { loadTvMedia, pruneTvMediaCache } from '@/lib/tv/media-cache';
import type { TvFit, TvPlayable } from '@/lib/tv/settings';

export type LoopItem = TvPlayable & { url: string };

/** Sem rede na primeira vez, tenta outra vez os que faltam. */
const RETRY_MS = 5 * 60_000;

function VideoItem({
  src,
  muted,
  fit,
  loop,
  onEnded,
  onError,
}: {
  src: string;
  muted: boolean;
  fit: TvFit;
  loop: boolean;
  onEnded: () => void;
  onError: () => void;
}) {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    video.muted = muted;
    // Com som, o browser pode recusar arrancar sozinho: aí toca sem som em
    // vez de ficar parado no primeiro fotograma.
    video.play().catch(() => {
      video.muted = true;
      void video.play().catch(() => undefined);
    });
  }, [src, muted]);

  return (
    <video
      ref={ref}
      src={src}
      muted={muted}
      loop={loop}
      playsInline
      preload="auto"
      onEnded={onEnded}
      onError={onError}
      className="tv-fade h-full w-full"
      style={{ objectFit: fit, background: '#000' }}
    />
  );
}

/**
 * Passa a lista de vídeos e imagens em ciclo. Cada ficheiro vem do disco da
 * box depois da primeira vez (`lib/tv/media-cache.ts`). Um ficheiro que não
 * abre é saltado; sem nada para passar, mostra `fallback`.
 */
export function MediaLoop({
  items,
  muted,
  fit,
  pruneDisk,
  fallback,
}: {
  items: LoopItem[];
  muted: boolean;
  fit: TvFit;
  /** Apagar do disco o que saiu da lista. Nunca na pré-visualização do painel. */
  pruneDisk: boolean;
  fallback: ReactNode;
}) {
  const [sources, setSources] = useState<Record<string, string>>({});
  const [broken, setBroken] = useState<Set<string>>(() => new Set());
  const [turn, setTurn] = useState(0);
  const [retry, setRetry] = useState(0);
  const urlsKey = items.map((item) => item.url).join('\n');

  useEffect(() => {
    setBroken(new Set());
  }, [urlsKey]);

  useEffect(() => {
    let cancelado = false;
    const urls = urlsKey ? urlsKey.split('\n') : [];
    // O que saiu da lista perde o seu `blob:` (libertado já a seguir): se
    // voltar à lista, abre-se de novo em vez de tocar um endereço morto.
    const manter = new Set(urls);
    setSources((atual) => {
      const restantes = Object.entries(atual).filter(([url]) => manter.has(url));
      return restantes.length === Object.keys(atual).length ? atual : Object.fromEntries(restantes);
    });
    void (async () => {
      await pruneTvMediaCache(urls, { disk: false });
      // Um de cada vez: o primeiro vídeo começa a passar sem esperar pelos outros.
      for (const url of urls) {
        const src = await loadTvMedia(url);
        if (cancelado) return;
        if (src) setSources((atual) => (atual[url] === src ? atual : { ...atual, [url]: src }));
      }
      if (pruneDisk && !cancelado) await pruneTvMediaCache(urls, { disk: true });
    })();
    return () => {
      cancelado = true;
    };
  }, [urlsKey, pruneDisk, retry]);

  useEffect(() => {
    const timer = window.setInterval(() => setRetry((n) => n + 1), RETRY_MS);
    return () => window.clearInterval(timer);
  }, []);

  const playable = items.filter((item) => sources[item.url] && !broken.has(item.id));
  const current = playable.length > 0 ? playable[turn % playable.length] : null;
  const next = () => setTurn((n) => n + 1);

  useEffect(() => {
    if (!current || current.kind !== 'image') return;
    const timer = window.setTimeout(() => setTurn((n) => n + 1), (current.seconds ?? 10) * 1000);
    return () => window.clearTimeout(timer);
  }, [current?.id, current?.kind, current?.seconds, turn]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!current) return <>{fallback}</>;

  const src = sources[current.url];
  return (
    <div className="relative h-full w-full overflow-hidden bg-black">
      <style>{'@keyframes tv-fade{from{opacity:0}to{opacity:1}}.tv-fade{animation:tv-fade .6s ease-out}'}</style>
      {current.kind === 'video' ? (
        <VideoItem
          key={`${current.id}-${playable.length === 1 ? 0 : turn}`}
          src={src}
          muted={muted}
          fit={fit}
          loop={playable.length === 1}
          onEnded={next}
          onError={() => {
            setBroken((atual) => new Set(atual).add(current.id));
            next();
          }}
        />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element -- blob: local, sem optimizador
        <img
          key={`${current.id}-${turn}`}
          src={src}
          alt={current.name}
          className="tv-fade h-full w-full"
          style={{ objectFit: fit }}
          onError={() => {
            setBroken((atual) => new Set(atual).add(current.id));
            next();
          }}
        />
      )}
    </div>
  );
}
