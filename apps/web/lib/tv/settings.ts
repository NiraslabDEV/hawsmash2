/**
 * TVs da loja: o que cada ecrã mostra e como.
 *
 * Cada TV é uma linha em `store_tvs` (migration 1090), com um endereço próprio
 * (`/tv/maputo/tv1`), um modo e um `config` jsonb editado na aba **TVs** do
 * painel. A TV relê a sua linha a cada 30 s: mudar o modo, a lista de vídeos
 * ou o título da senha chega ao ecrã sem ninguém tocar na TV.
 *
 * Este módulo é o contrato — o painel grava com ele e a TV lê com ele:
 *
 * - `FACTORY_TV_CONFIG` — o que a TV usa quando nada foi gravado. Neutro: não
 *   fala de nenhuma marca (a marca vem de `brand_settings`, §18.2).
 * - `resolveTvConfig(raw)` — lê o jsonb **campo a campo**: o que vier estragado
 *   cai no de fábrica, o resto fica. Uma definição mal gravada nunca deixa a
 *   TV em branco.
 *
 * O que a TV nunca mostra: nomes, telefones, valores. É um ecrã público (§14).
 */

export type TvMode = 'senhas_videos' | 'senhas' | 'videos' | 'menu';
export type TvRotation = 0 | 90 | 180 | 270;
export type TvPanelSide = 'left' | 'right';
export type TvFit = 'cover' | 'contain';

export type TvPlaylistItem = {
  mediaId: string;
  /** Só para imagens: quantos segundos fica no ecrã. `null` = o tempo da TV. */
  seconds: number | null;
};

export type TvConfig = {
  screen: {
    /** Para TVs montadas ao alto: roda o ecrã em vez de pedir à box que o faça. */
    rotation: TvRotation;
    /** Tamanho do texto, em %: a TV ao fundo da sala precisa de letra maior. */
    scale: number;
    showHeader: boolean;
    /** Vazio = "<marca> <loja>". */
    title: string;
    showClock: boolean;
  };
  senhas: {
    title: string;
    emptyText: string;
    preparingTitle: string;
    showPreparing: boolean;
    /** BALCÃO / ENTREGA / LEVANTAMENTO por baixo do número. */
    showType: boolean;
    /** A senha acabada de ficar pronta ocupa o ecrã. 0 = não destaca. */
    highlightSeconds: number;
    /** Tira da TV a senha pronta há mais de N minutos. 0 = até ser entregue. */
    readyMaxMinutes: number;
    maxTickets: number;
    sound: boolean;
    /** No modo senhas + vídeos: de que lado fica a coluna das senhas. */
    panelSide: TvPanelSide;
  };
  videos: {
    playlist: TvPlaylistItem[];
    /** O browser só arranca vídeo sozinho se estiver sem som. */
    muted: boolean;
    fit: TvFit;
    imageSeconds: number;
  };
  menu: {
    columns: 1 | 2 | 3;
    soldOut: 'show' | 'hide';
  };
};

export const TV_MODES: readonly TvMode[] = ['senhas_videos', 'senhas', 'videos', 'menu'];

export const TV_MODE_NAMES: Record<TvMode, { label: string; hint: string }> = {
  senhas_videos: {
    label: 'Senhas + vídeos',
    hint: 'Os vídeos passam e as senhas prontas ficam numa coluna. Senha nova ocupa o ecrã.',
  },
  senhas: { label: 'Só senhas', hint: 'Pedidos prontos em grande e os que estão em preparo.' },
  videos: { label: 'Só vídeos', hint: 'Passa a lista de vídeos e imagens em ciclo.' },
  menu: { label: 'Cardápio', hint: 'Preços e esgotados da loja, ao vivo.' },
};

export const TV_ROTATIONS: readonly TvRotation[] = [0, 90, 180, 270];

/** Rotas de TV que já existem: um ecrã não pode ter o mesmo endereço. */
export const TV_RESERVED_SLUGS = ['menu', 'senhas', 'kds'] as const;

export const TV_LIMITS = {
  nameMax: 60,
  slugMax: 32,
  titleMax: 60,
  textMax: 60,
  scaleMin: 70,
  scaleMax: 160,
  highlightMax: 30,
  readyMaxMinutesMax: 240,
  maxTicketsMin: 1,
  maxTicketsMax: 30,
  imageSecondsMin: 3,
  imageSecondsMax: 120,
  playlistMax: 30,
  /** TVs por loja. Chega para qualquer loja; trava um clique repetido. */
  tvsPerStore: 20,
} as const;

/** Sem sinal há mais do que isto = "sem sinal" no painel. A TV bate a cada 30 s. */
export const TV_ONLINE_WINDOW_MS = 2 * 60_000;

export const FACTORY_TV_CONFIG: TvConfig = {
  screen: { rotation: 0, scale: 100, showHeader: true, title: '', showClock: true },
  senhas: {
    title: 'Pedido pronto',
    emptyText: 'Sem senhas prontas',
    preparingTitle: 'Em preparo',
    showPreparing: true,
    showType: true,
    highlightSeconds: 8,
    readyMaxMinutes: 0,
    maxTickets: 12,
    sound: true,
    panelSide: 'right',
  },
  videos: { playlist: [], muted: true, fit: 'cover', imageSeconds: 10 },
  menu: { columns: 2, soldOut: 'show' },
};

// ─── leitura tolerante ───────────────────────────────────────────────────────

type Loose = Record<string, unknown>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function obj(value: unknown): Loose {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Loose) : {};
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function text(value: unknown, fallback: string, max: number): string {
  if (typeof value !== 'string') return fallback;
  return value.trim().slice(0, max);
}

/** Texto que não pode ficar vazio (o título da senha, por exemplo). */
function label(value: unknown, fallback: string, max: number): string {
  return text(value, fallback, max) || fallback;
}

function int(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

function oneOf<T>(value: unknown, options: readonly T[], fallback: T): T {
  return options.includes(value as T) ? (value as T) : fallback;
}

function resolvePlaylistItems(value: unknown): TvPlaylistItem[] {
  if (!Array.isArray(value)) return [];
  const vistos = new Set<string>();
  const lista: TvPlaylistItem[] = [];
  for (const entry of value) {
    const item = obj(entry);
    const id = typeof item.mediaId === 'string' ? item.mediaId.toLowerCase() : '';
    if (!UUID.test(id) || vistos.has(id)) continue;
    vistos.add(id);
    lista.push({
      mediaId: id,
      seconds:
        typeof item.seconds === 'number'
          ? int(item.seconds, FACTORY_TV_CONFIG.videos.imageSeconds, TV_LIMITS.imageSecondsMin, TV_LIMITS.imageSecondsMax)
          : null,
    });
    if (lista.length >= TV_LIMITS.playlistMax) break;
  }
  return lista;
}

export function resolveTvConfig(raw: unknown): TvConfig {
  const f = FACTORY_TV_CONFIG;
  const root = obj(raw);
  const screen = obj(root.screen);
  const senhas = obj(root.senhas);
  const videos = obj(root.videos);
  const menu = obj(root.menu);

  return {
    screen: {
      rotation: oneOf(screen.rotation, TV_ROTATIONS, f.screen.rotation),
      scale: int(screen.scale, f.screen.scale, TV_LIMITS.scaleMin, TV_LIMITS.scaleMax),
      showHeader: bool(screen.showHeader, f.screen.showHeader),
      title: text(screen.title, f.screen.title, TV_LIMITS.titleMax),
      showClock: bool(screen.showClock, f.screen.showClock),
    },
    senhas: {
      title: label(senhas.title, f.senhas.title, TV_LIMITS.textMax),
      emptyText: label(senhas.emptyText, f.senhas.emptyText, TV_LIMITS.textMax),
      preparingTitle: label(senhas.preparingTitle, f.senhas.preparingTitle, TV_LIMITS.textMax),
      showPreparing: bool(senhas.showPreparing, f.senhas.showPreparing),
      showType: bool(senhas.showType, f.senhas.showType),
      highlightSeconds: int(senhas.highlightSeconds, f.senhas.highlightSeconds, 0, TV_LIMITS.highlightMax),
      readyMaxMinutes: int(senhas.readyMaxMinutes, f.senhas.readyMaxMinutes, 0, TV_LIMITS.readyMaxMinutesMax),
      maxTickets: int(senhas.maxTickets, f.senhas.maxTickets, TV_LIMITS.maxTicketsMin, TV_LIMITS.maxTicketsMax),
      sound: bool(senhas.sound, f.senhas.sound),
      panelSide: oneOf(senhas.panelSide, ['left', 'right'] as const, f.senhas.panelSide),
    },
    videos: {
      playlist: resolvePlaylistItems(videos.playlist),
      muted: bool(videos.muted, f.videos.muted),
      fit: oneOf(videos.fit, ['cover', 'contain'] as const, f.videos.fit),
      imageSeconds: int(videos.imageSeconds, f.videos.imageSeconds, TV_LIMITS.imageSecondsMin, TV_LIMITS.imageSecondsMax),
    },
    menu: {
      columns: oneOf(menu.columns, [1, 2, 3] as const, f.menu.columns),
      soldOut: oneOf(menu.soldOut, ['show', 'hide'] as const, f.menu.soldOut),
    },
  };
}

// ─── modos ───────────────────────────────────────────────────────────────────

export const modeShowsSenhas = (mode: TvMode) => mode === 'senhas' || mode === 'senhas_videos';
export const modeShowsVideos = (mode: TvMode) => mode === 'videos' || mode === 'senhas_videos';
export const modeShowsMenu = (mode: TvMode) => mode === 'menu';

export function isTvMode(value: unknown): value is TvMode {
  return TV_MODES.includes(value as TvMode);
}

// ─── endereço ────────────────────────────────────────────────────────────────

const SLUG = /^[a-z0-9][a-z0-9-]*$/;

/** "TV do Balcão" → "tv-do-balcao". O que se escreve no painel vira endereço. */
export function normalizeTvSlug(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, TV_LIMITS.slugMax);
}

/** A mesma regra que a BD aplica (1090), dita em português. */
export function tvSlugError(slug: string): string | null {
  if (!slug) return 'O endereço não pode ficar vazio.';
  if (slug.length > TV_LIMITS.slugMax) return `No máximo ${TV_LIMITS.slugMax} caracteres.`;
  if (!SLUG.test(slug)) return 'Só letras minúsculas, números e hífen, a começar por letra ou número.';
  if ((TV_RESERVED_SLUGS as readonly string[]).includes(slug)) return `"${slug}" já é outro ecrã. Escolhe outro nome.`;
  return null;
}

export function nextFreeTvSlug(existing: string[]): string {
  const usados = new Set(existing);
  for (let n = 1; ; n += 1) {
    if (!usados.has(`tv${n}`)) return `tv${n}`;
  }
}

export function tvScreenPath(storeSlug: string, tvSlug: string): string {
  return `/tv/${storeSlug}/${tvSlug}`;
}

// ─── senhas ──────────────────────────────────────────────────────────────────

/**
 * As senhas prontas que a TV mostra. `ready` vem do servidor do mais recente
 * para o mais antigo. Uma senha esquecida (ninguém carregou em Entregue) sai
 * sozinha depois de `readyMaxMinutes` — o pedido continua `ready` na BD.
 */
export function visibleReadyTickets<T extends { ready_at?: string | null }>(
  ready: T[],
  opts: { now: Date; readyMaxMinutes: number; maxTickets: number },
): T[] {
  const limite = opts.readyMaxMinutes > 0 ? opts.now.getTime() - opts.readyMaxMinutes * 60_000 : null;
  return ready
    .filter((entry) => {
      if (limite === null || !entry.ready_at) return true;
      const quando = Date.parse(entry.ready_at);
      return Number.isNaN(quando) || quando >= limite;
    })
    .slice(0, opts.maxTickets);
}

// ─── vídeos ──────────────────────────────────────────────────────────────────

export type TvMediaRow = {
  id: string;
  kind: 'video' | 'image';
  storage_path: string;
  name: string;
};

export type TvPlayable = {
  id: string;
  kind: 'video' | 'image';
  path: string;
  name: string;
  /** Imagens: segundos no ecrã. Vídeos: `null` (dura o que o vídeo durar). */
  seconds: number | null;
};

/** A lista de reprodução com os ficheiros reais. O que foi apagado da biblioteca salta-se. */
export function resolvePlaylist(config: TvConfig, media: TvMediaRow[]): TvPlayable[] {
  const porId = new Map(media.map((m) => [m.id.toLowerCase(), m]));
  const lista: TvPlayable[] = [];
  for (const item of config.videos.playlist) {
    const m = porId.get(item.mediaId);
    if (!m) continue;
    lista.push({
      id: m.id,
      kind: m.kind,
      path: m.storage_path,
      name: m.name,
      seconds: m.kind === 'image' ? item.seconds ?? config.videos.imageSeconds : null,
    });
  }
  return lista;
}

// ─── estado ──────────────────────────────────────────────────────────────────

export type TvStatus = 'online' | 'offline' | 'never';

export function tvStatus(lastSeenAt: string | null, now: Date = new Date()): TvStatus {
  if (!lastSeenAt) return 'never';
  const visto = Date.parse(lastSeenAt);
  if (Number.isNaN(visto)) return 'never';
  return now.getTime() - visto <= TV_ONLINE_WINDOW_MS ? 'online' : 'offline';
}
