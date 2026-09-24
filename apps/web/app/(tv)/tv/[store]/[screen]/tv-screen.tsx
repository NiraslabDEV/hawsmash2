'use client';

import { useCallback, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';

import { useBrand } from '@/lib/brand/context';
import {
  CURRENT_BUILD,
  VERSION_CHECK_MS,
  fetchLatestBuild,
  isNewBuild,
  markReload,
  reloadAllowed,
} from '@/lib/pos/app-update';
import { prepararSomDaTv, somDaTvBloqueado, tocarSenha } from '@/lib/tv/chime';
import { TV_MEDIA_BUCKET } from '@/lib/tv/media';
import {
  isTvMode,
  modeShowsSenhas,
  resolvePlaylist,
  resolveTvConfig,
  tvScreenPath,
  visibleReadyTickets,
  type TvConfig,
  type TvMediaRow,
} from '@/lib/tv/settings';
import { createClient } from '@/utils/supabase/client';

import { MenuBoard } from '../menu/menu-board';
import { MediaLoop, type LoopItem } from '../../_screen/media-loop';
import { SenhasFull, SenhasHighlight, SenhasPanel, TvHeader } from '../../_screen/senhas-views';
import { useStoreQueue } from '../../_screen/use-store-queue';

export type TvScreenData = {
  store: { slug: string; short_name: string };
  tv: {
    id: string;
    slug: string;
    name: string;
    mode: string;
    active: boolean;
    config: unknown;
    updated_at: string;
  } | null;
  media: TvMediaRow[];
  server_time?: string;
};

/** O painel manda na TV: uma mudança chega aqui em até 30 s. */
const CONFIG_REFRESH_MS = 30_000;

function cacheKey(store: string, screen: string) {
  return `tv-screen:${store}/${screen}`;
}

function readCached(store: string, screen: string): TvScreenData | null {
  try {
    const raw = window.localStorage.getItem(cacheKey(store, screen));
    return raw ? (JSON.parse(raw) as TvScreenData) : null;
  } catch {
    return null;
  }
}

function writeCached(store: string, screen: string, data: TvScreenData) {
  try {
    window.localStorage.setItem(cacheKey(store, screen), JSON.stringify(data));
  } catch {
    // Sem storage: a TV funciona na mesma, só não sobrevive a um recarregar offline.
  }
}

/** Roda o ecrã para TVs montadas ao alto — a box continua na horizontal. */
function frameStyle(rotation: TvConfig['screen']['rotation']): CSSProperties {
  if (rotation === 90 || rotation === 270) {
    return {
      position: 'fixed',
      top: '50%',
      left: '50%',
      width: '100vh',
      height: '100vw',
      transform: `translate(-50%, -50%) rotate(${rotation}deg)`,
    };
  }
  return { position: 'fixed', inset: 0, transform: rotation === 180 ? 'rotate(180deg)' : undefined };
}

/**
 * Ecrã de uma TV configurada. Relê a configuração a cada 30 s, guarda a última
 * que funcionou (uma TV que reinicia sem internet volta ao que mostrava) e
 * nunca fica em branco: sem nada para mostrar, mostra a marca (§14).
 */
export function TvScreen({
  storeSlug,
  screenSlug,
  preview,
  initial,
}: {
  storeSlug: string;
  screenSlug: string;
  preview: boolean;
  initial: TvScreenData | null;
}) {
  const brand = useBrand();
  const supabase = useMemo(() => createClient(), []);
  const [screen, setScreen] = useState<TvScreenData | null>(initial);
  const [configStale, setConfigStale] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const [soundBlocked, setSoundBlocked] = useState(false);

  const refresh = useCallback(async () => {
    const { data, error } = await supabase.rpc('get_tv_screen', {
      p_store_slug: storeSlug,
      p_tv_slug: screenSlug,
      p_heartbeat: !preview,
    });
    if (error || !data) {
      setConfigStale(true);
      return;
    }
    setScreen(data as TvScreenData);
    setConfigStale(false);
    if (!preview) writeCached(storeSlug, screenSlug, data as TvScreenData);
  }, [preview, screenSlug, storeSlug, supabase]);

  useEffect(() => {
    if (!initial) {
      const guardada = readCached(storeSlug, screenSlug);
      if (guardada) setScreen(guardada);
    } else if (!preview) {
      writeCached(storeSlug, screenSlug, initial);
    }
    void refresh();
    const timer = window.setInterval(() => void refresh(), CONFIG_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [initial, preview, refresh, screenSlug, storeSlug]);

  // O relógio que tira da TV as senhas esquecidas.
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 15_000);
    return () => window.clearInterval(timer);
  }, []);

  const tv = screen?.tv ?? null;
  const config = useMemo(() => resolveTvConfig(tv?.config), [tv?.config]);
  const mode = tv && isTvMode(tv.mode) ? tv.mode : 'senhas';
  const showsSenhas = !!tv?.active && modeShowsSenhas(mode);
  const sound = config.senhas.sound && !preview;

  // Tamanho do texto: tudo no ecrã está em rem, por isso escala junto.
  useEffect(() => {
    const root = document.documentElement;
    root.style.fontSize = `${config.screen.scale}%`;
    return () => {
      root.style.fontSize = '';
    };
  }, [config.screen.scale]);

  const { queue, stale: queueStale, highlight } = useStoreQueue(storeSlug, {
    enabled: showsSenhas,
    highlightSeconds: config.senhas.highlightSeconds,
    onNewReady: sound ? () => tocarSenha() : undefined,
  });

  // O som só toca depois de um toque (ou com a opção do quiosque). Um OK no
  // comando da TV conta como toque.
  useEffect(() => {
    if (!sound || !showsSenhas) {
      setSoundBlocked(false);
      return;
    }
    const desbloquear = () => {
      prepararSomDaTv();
      window.setTimeout(() => setSoundBlocked(somDaTvBloqueado()), 300);
    };
    setSoundBlocked(somDaTvBloqueado());
    window.addEventListener('pointerdown', desbloquear);
    window.addEventListener('keydown', desbloquear);
    return () => {
      window.removeEventListener('pointerdown', desbloquear);
      window.removeEventListener('keydown', desbloquear);
    };
  }, [showsSenhas, sound]);

  // Uma TV fica ligada meses: apanha as versões novas sozinha, fora de um anúncio.
  useEffect(() => {
    if (preview) return;
    const timer = window.setInterval(async () => {
      const latest = await fetchLatestBuild();
      if (!isNewBuild(CURRENT_BUILD, latest) || !navigator.onLine) return;
      if (document.querySelector('[data-tv-highlight]')) return;
      let storage: Storage | null = null;
      try {
        storage = window.sessionStorage;
      } catch {
        storage = null;
      }
      if (!reloadAllowed(storage)) return;
      markReload(storage);
      window.location.reload();
    }, VERSION_CHECK_MS);
    return () => window.clearInterval(timer);
  }, [preview]);

  const playlist: LoopItem[] = useMemo(() => {
    if (!tv) return [];
    return resolvePlaylist(config, screen?.media ?? []).map((item) => ({
      ...item,
      url: supabase.storage.from(TV_MEDIA_BUCKET).getPublicUrl(item.path).data.publicUrl,
    }));
  }, [config, screen?.media, supabase, tv]);

  const idle = (texto?: string) => (
    <div className="grid h-full place-items-center p-8 text-center">
      <div>
        {/* eslint-disable-next-line @next/next/no-img-element -- logo da marca, pode vir do bucket */}
        <img src={brand.storefront.logoImage} alt={brand.name} className="mx-auto max-h-[40vh] max-w-[60%] object-contain" />
        <p className="mt-8 text-5xl font-black uppercase tracking-widest" style={{ color: 'var(--tv-primary)' }}>
          {brand.name}
        </p>
        {texto && (
          <p className="mt-4 text-2xl font-bold" style={{ color: 'var(--tv-muted-2)' }}>
            {texto}
          </p>
        )}
      </div>
    </div>
  );

  const title = config.screen.title || `${brand.name} ${screen?.store.short_name ?? ''}`.trim();
  const ready = visibleReadyTickets(queue?.ready ?? [], {
    now,
    readyMaxMinutes: config.senhas.readyMaxMinutes,
    maxTickets: config.senhas.maxTickets,
  });
  const preparing = queue?.preparing ?? [];
  const stale = configStale || (showsSenhas && queueStale);

  let body: ReactNode;
  if (!screen) {
    body = idle('A ligar…');
  } else if (!tv) {
    body = idle(`Este ecrã (${tvScreenPath(storeSlug, screenSlug)}) não existe. Cria-o na aba TVs do painel.`);
  } else if (!tv.active) {
    body = idle();
  } else if (mode === 'menu') {
    body = (
      <MenuBoard
        storeSlug={storeSlug}
        storeName={screen.store.short_name}
        columns={config.menu.columns}
        soldOut={config.menu.soldOut}
        embedded
      />
    );
  } else if (mode === 'videos') {
    body = (
      <MediaLoop items={playlist} muted={config.videos.muted} fit={config.videos.fit} pruneDisk={!preview} fallback={idle()} />
    );
  } else if (mode === 'senhas_videos' && playlist.length > 0) {
    const panel = <SenhasPanel ready={ready} preparing={preparing} options={config.senhas} />;
    body = (
      <div className="flex h-full">
        {config.senhas.panelSide === 'left' && panel}
        <div className="h-full min-w-0 flex-1">
          <MediaLoop
            items={playlist}
            muted={config.videos.muted}
            fit={config.videos.fit}
            pruneDisk={!preview}
            fallback={<SenhasFull ready={ready} preparing={preparing} options={config.senhas} />}
          />
        </div>
        {config.senhas.panelSide === 'right' && panel}
      </div>
    );
  } else {
    // Só senhas — ou senhas + vídeos ainda sem vídeos na lista.
    body = <SenhasFull ready={ready} preparing={preparing} options={config.senhas} />;
  }

  // Só vídeos, sem cabeçalho, ocupa o ecrã inteiro; os outros modos respeitam a escolha.
  const showHeader = !!tv?.active && config.screen.showHeader && mode !== 'videos';

  return (
    <div style={frameStyle(config.screen.rotation)} className="overflow-hidden" data-tv={tv?.slug ?? screenSlug}>
      <main className="relative flex h-full flex-col" style={{ background: 'var(--tv-bg)' }}>
        {showHeader && <TvHeader title={title} showClock={config.screen.showClock} stale={stale} />}
        <div className="min-h-0 flex-1">{body}</div>

        {!showHeader && stale && (
          <span className="absolute right-6 top-4 z-20 text-xl font-bold" style={{ color: '#ff9b9b' }}>
            A reconectar…
          </span>
        )}
        {showsSenhas && highlight && (
          <div data-tv-highlight>
            <SenhasHighlight entry={highlight} options={config.senhas} />
          </div>
        )}
        {soundBlocked && (
          <span
            className="absolute bottom-3 left-4 z-20 rounded-lg px-3 py-1 text-sm font-bold"
            style={{ background: 'rgba(0,0,0,0.6)', color: 'var(--tv-muted-2)' }}
          >
            Som das senhas desligado — carrega OK no comando
          </span>
        )}
      </main>
    </div>
  );
}
