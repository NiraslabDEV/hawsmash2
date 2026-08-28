/**
 * attribution.ts — de onde veio esta venda (CLAUDE.md §13, §16 do motor).
 *
 * Este módulo é a ÚNICA fonte de verdade sobre origem de trafego. E puro
 * (sem window, sem Supabase) porque corre em tres sitios: no middleware
 * (edge, a cada navegacao), no /api/track e no /api/create-order.
 *
 * Tres regras que explicam o desenho:
 *
 *  1. A origem captura-se no servidor, nao no browser. O middleware le a
 *     query string e o `referer` na primeira resposta e sela-os num cookie
 *     first-party. Assim a origem sobrevive a navegacao client-side, a
 *     bloqueadores de scripts e a ausencia de consentimento de marketing —
 *     e dado operacional da loja, nao um pixel de terceiros.
 *
 *  2. Primeiro toque e ultimo toque sao coisas diferentes e guardam-se os
 *     dois. O Instagram que apresentou o HAWSMASH e o WhatsApp que fechou o
 *     pedido merecem credito diferente; um unico campo obrigaria a escolher.
 *
 *  3. Navegacao interna nunca e uma origem. Um clique de /menu para /checkout
 *     nao e "directo" — e a mesma visita. Sobrescrever o ultimo toque ai e o
 *     erro classico que faz tudo parecer trafego directo.
 */

// ── cookies ─────────────────────────────────────────────────────────────────

export const SESSION_COOKIE = 'dl_session';
export const FIRST_TOUCH_COOKIE = 'dl_attr_first';
export const LAST_TOUCH_COOKIE = 'dl_attr_last';

/** Sessao: 30 min deslizantes — a mesma janela que o GA4 usa. */
export const SESSION_MAX_AGE = 30 * 60;
/** Primeiro toque: 180 dias. Quem descobriu a marca em Marco conta em Agosto. */
export const FIRST_TOUCH_MAX_AGE = 60 * 60 * 24 * 180;
/** Ultimo toque: 30 dias — a janela de atribuicao de campanha. */
export const LAST_TOUCH_MAX_AGE = 60 * 60 * 24 * 30;

// ── tipos ───────────────────────────────────────────────────────────────────

export type Channel =
  | 'paid_search'
  | 'paid_social'
  | 'organic_search'
  | 'organic_social'
  | 'ai_assistant'
  | 'whatsapp'
  | 'email'
  | 'sms'
  | 'qr'
  | 'influencer'
  | 'referral'
  | 'direct'
  | 'internal';

export interface Touch {
  /** canal agrupado — e por aqui que o dono le o relatorio */
  ch: Channel;
  /** fonte normalizada: 'instagram', 'google', 'chatgpt', 'qr_mesa'... */
  s: string;
  /** meio: 'cpc', 'social', 'organic', 'qr'... */
  m: string;
  /** campanha, conteudo e termo (utm_campaign / _content / _term) */
  c?: string;
  ct?: string;
  t?: string;
  /** host de quem nos enviou, quando existe */
  r?: string;
  /** ids de clique pagos — e o que permite reconciliar com o Ads/Meta */
  cid?: Record<string, string>;
  /** pagina de entrada */
  lp?: string;
  /** epoch em segundos */
  ts: number;
}

// ── dicionarios ─────────────────────────────────────────────────────────────

const CLICK_ID_PARAMS = [
  'gclid', 'gbraid', 'wbraid', // Google Ads
  'fbclid',                    // Meta
  'ttclid',                    // TikTok
  'msclkid',                   // Microsoft
  'twclid',                    // X
  'li_fat_id',                 // LinkedIn
  'igshid',                    // Instagram
  'sccid',                     // Snapchat
] as const;

const PAID_CLICK_IDS = ['gclid', 'gbraid', 'wbraid', 'msclkid'];
const SOCIAL_CLICK_IDS = ['fbclid', 'ttclid', 'twclid', 'li_fat_id', 'sccid'];

const AI_HOSTS = [
  'chatgpt.com', 'chat.openai.com', 'openai.com',
  'perplexity.ai', 'gemini.google.com', 'bard.google.com',
  'copilot.microsoft.com', 'claude.ai',
  'you.com', 'poe.com', 'grok.com', 'meta.ai',
];

const SEARCH_HOSTS = [
  'google.com', 'google.co.mz', 'google.pt', 'google.co.za',
  'bing.com', 'duckduckgo.com', 'search.yahoo.com', 'yahoo.com',
  'yandex.com', 'yandex.ru', 'ecosia.org', 'search.brave.com',
  'baidu.com', 'qwant.com',
];

const SOCIAL_HOSTS = [
  'instagram.com', 'facebook.com', 'fb.com', 'messenger.com',
  'tiktok.com', 'twitter.com', 'x.com', 't.co',
  'linkedin.com', 'lnkd.in', 'pinterest.com', 'reddit.com',
  'youtube.com', 'youtu.be', 'snapchat.com', 'threads.net', 'threads.com',
  't.me', 'telegram.me',
];

const WHATSAPP_HOSTS = ['whatsapp.com', 'wa.me', 'whatsapp.net'];

/** O mesmo sitio escreve-se de dez maneiras nos links que a equipa cola. */
const SOURCE_ALIASES: Record<string, string> = {
  ig: 'instagram', insta: 'instagram', 'instagram.com': 'instagram',
  'l.instagram.com': 'instagram', igshopping: 'instagram',
  fb: 'facebook', 'facebook.com': 'facebook', 'm.facebook.com': 'facebook',
  'l.facebook.com': 'facebook', 'lm.facebook.com': 'facebook',
  wa: 'whatsapp', zap: 'whatsapp', 'wa.me': 'whatsapp',
  'whatsapp.com': 'whatsapp', 'api.whatsapp.com': 'whatsapp',
  'chatgpt.com': 'chatgpt', 'chat.openai.com': 'chatgpt', openai: 'chatgpt',
  'gemini.google.com': 'gemini', 'copilot.microsoft.com': 'copilot',
  'perplexity.ai': 'perplexity', 'claude.ai': 'claude',
  'google.com': 'google', 'google.co.mz': 'google',
  'tiktok.com': 'tiktok', 'vm.tiktok.com': 'tiktok', tt: 'tiktok',
  'x.com': 'x', 'twitter.com': 'x', 't.co': 'x',
  'youtube.com': 'youtube', 'youtu.be': 'youtube', yt: 'youtube',
  qrcode: 'qr', 'qr-code': 'qr', qr_code: 'qr',
};

/** Fontes que ja se sabe a que canal pertencem quando nao ha mais nada. */
const AI_SOURCES = ['chatgpt', 'perplexity', 'gemini', 'copilot', 'claude', 'meta.ai'];
const SOCIAL_SOURCES = [
  'instagram', 'facebook', 'tiktok', 'x', 'youtube', 'linkedin',
  'threads', 'telegram', 'snapchat', 'pinterest', 'reddit',
];
const SEARCH_SOURCES = ['google', 'bing', 'yahoo', 'duckduckgo', 'yandex', 'ecosia', 'brave'];

// ── normalizacao ────────────────────────────────────────────────────────────

function clean(value: string | null | undefined, max = 120): string {
  if (!value) return '';
  return value.trim().toLowerCase().slice(0, max);
}

export function normalizeSource(raw: string | null | undefined): string {
  const v = clean(raw).replace(/^www\./, '');
  if (!v) return '';
  return SOURCE_ALIASES[v] ?? v;
}

export function hostOf(referrer: string | null | undefined): string {
  if (!referrer) return '';
  try {
    return new URL(referrer).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}

function hostMatches(host: string, list: string[]): boolean {
  return list.some((h) => host === h || host.endsWith('.' + h));
}

// ── classificacao ───────────────────────────────────────────────────────────

export interface ClassifyInput {
  source: string;
  medium: string;
  referrerHost: string;
  clickIds: Record<string, string>;
  /** host do proprio site — referrer nosso e navegacao interna, nao origem */
  selfHost?: string;
}

/**
 * Devolve o canal agrupado. A ordem importa: o que a campanha declara
 * explicitamente (utm) vence o que se adivinha pelo referrer, e um id de
 * clique pago vence o palpite — se houve `gclid`, aquilo foi pago, diga a
 * utm o que disser.
 */
export function classifyChannel(input: ClassifyInput): Channel {
  const { source, medium, referrerHost, clickIds, selfHost } = input;
  const paidClick = PAID_CLICK_IDS.some((k) => clickIds[k]);
  const socialClick = SOCIAL_CLICK_IDS.some((k) => clickIds[k]);

  // (0) `gclid`/`msclkid` só existem num clique de anúncio — é facto, não
  // palpite, e vence a utm que a equipa escreveu à mão no link.
  // (`fbclid` NÃO entra aqui: o Facebook também o põe em links orgânicos,
  // por isso só diz de que plataforma veio, não que foi pago.)
  if (paidClick && !/^(paid_social|paidsocial|display|banner)$/.test(medium)) {
    return 'paid_search';
  }

  // (1) meio declarado
  if (medium) {
    if (/^(cpc|ppc|paid|paidsearch|paid_search|sem)$/.test(medium)) {
      if (socialClick) return 'paid_social';
      return SOCIAL_SOURCES.includes(source) ? 'paid_social' : 'paid_search';
    }
    if (/^(paid_social|paidsocial|social_paid|display|banner|retargeting|remarketing)$/.test(medium)) return 'paid_social';
    if (/^(email|newsletter|e-mail)$/.test(medium)) return 'email';
    if (/^(sms|mensagem)$/.test(medium)) return 'sms';
    if (/^(qr|qrcode|qr_code|mesa|cartaz|flyer|print)$/.test(medium)) return 'qr';
    if (/^(influencer|creator|parceria|partner)$/.test(medium)) return 'influencer';
    if (/^(social|organic_social|social_organic|stories|bio)$/.test(medium)) {
      return source === 'whatsapp' ? 'whatsapp' : 'organic_social';
    }
    if (/^(referral|indicacao)$/.test(medium)) return 'referral';
  }

  // (2) ids de clique de redes sociais: dizem a plataforma, não o pagamento.
  if (socialClick && !referrerHost && !source) return 'organic_social';

  // (3) fonte declarada
  if (source) {
    if (source === 'whatsapp') return 'whatsapp';
    if (source === 'qr' || source.startsWith('qr_')) return 'qr';
    if (AI_SOURCES.includes(source)) return 'ai_assistant';
    if (SOCIAL_SOURCES.includes(source)) return 'organic_social';
    if (SEARCH_SOURCES.includes(source)) return 'organic_search';
  }

  // (4) quem nos enviou
  if (referrerHost) {
    if (selfHost && (referrerHost === selfHost || referrerHost.endsWith('.' + selfHost))) return 'internal';
    if (hostMatches(referrerHost, AI_HOSTS)) return 'ai_assistant';
    if (hostMatches(referrerHost, WHATSAPP_HOSTS)) return 'whatsapp';
    if (hostMatches(referrerHost, SEARCH_HOSTS)) return 'organic_search';
    if (hostMatches(referrerHost, SOCIAL_HOSTS)) return 'organic_social';
    return 'referral';
  }

  // (5) escreveu o endereco, ou veio de um sitio que nao diz de onde vem
  return 'direct';
}

// ── construcao do toque ─────────────────────────────────────────────────────

export interface BuildTouchInput {
  url: URL;
  referrer?: string | null;
  selfHost?: string;
  now?: number;
}

export function buildTouch({ url, referrer, selfHost, now }: BuildTouchInput): Touch {
  const q = url.searchParams;

  const clickIds: Record<string, string> = {};
  for (const key of CLICK_ID_PARAMS) {
    const v = q.get(key);
    if (v) clickIds[key] = v.slice(0, 200);
  }

  const self = (selfHost ?? '').toLowerCase().replace(/^www\./, '');
  const referrerHost = hostOf(referrer);
  const internal = Boolean(self) && (referrerHost === self || referrerHost.endsWith('.' + self));

  let source = normalizeSource(q.get('utm_source') ?? q.get('source') ?? q.get('ref'));
  let medium = clean(q.get('utm_medium'));

  // Sem utm mas com referrer externo: a fonte e quem nos enviou.
  if (!source && referrerHost && !internal) source = normalizeSource(referrerHost);

  const channel = classifyChannel({ source, medium, referrerHost, clickIds, selfHost: self });

  // Preencher os buracos para o relatorio nunca ter celula vazia.
  if (!source) source = channel === 'direct' ? 'direto' : channel === 'internal' ? 'interno' : 'desconhecido';
  if (!medium) {
    medium =
      channel === 'paid_search' || channel === 'paid_social' ? 'cpc'
      : channel === 'organic_search' ? 'organic'
      : channel === 'organic_social' || channel === 'whatsapp' ? 'social'
      : channel === 'referral' ? 'referral'
      : channel === 'ai_assistant' ? 'ai'
      : channel === 'qr' ? 'qr'
      : '(nenhum)';
  }

  const touch: Touch = {
    ch: channel,
    s: source,
    m: medium,
    ts: Math.floor((now ?? Date.now()) / 1000),
  };

  const campaign = clean(q.get('utm_campaign'));
  const content = clean(q.get('utm_content'));
  const term = clean(q.get('utm_term'));
  if (campaign) touch.c = campaign;
  if (content) touch.ct = content;
  if (term) touch.t = term;
  if (referrerHost && !internal) touch.r = referrerHost;
  if (Object.keys(clickIds).length) touch.cid = clickIds;
  if (url.pathname) touch.lp = url.pathname.slice(0, 200);

  return touch;
}

/**
 * Um toque so "conta" se trouxer informacao nova. Navegacao interna e visitas
 * directas dentro da janela nao podem apagar a campanha que trouxe o cliente.
 */
export function isMeaningfulTouch(touch: Touch): boolean {
  return touch.ch !== 'direct' && touch.ch !== 'internal';
}

// ── serializacao (cookie) ───────────────────────────────────────────────────

export function encodeTouch(touch: Touch): string {
  return encodeURIComponent(JSON.stringify(touch));
}

export function decodeTouch(raw: string | null | undefined): Touch | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(decodeURIComponent(raw)) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const t = parsed as Partial<Touch>;
    if (typeof t.ch !== 'string' || typeof t.s !== 'string') return null;
    return {
      ch: t.ch as Channel,
      s: t.s,
      m: typeof t.m === 'string' ? t.m : '(nenhum)',
      c: typeof t.c === 'string' ? t.c : undefined,
      ct: typeof t.ct === 'string' ? t.ct : undefined,
      t: typeof t.t === 'string' ? t.t : undefined,
      r: typeof t.r === 'string' ? t.r : undefined,
      cid: t.cid && typeof t.cid === 'object' ? (t.cid as Record<string, string>) : undefined,
      lp: typeof t.lp === 'string' ? t.lp : undefined,
      ts: typeof t.ts === 'number' ? t.ts : 0,
    };
  } catch {
    return null;
  }
}

/** Le um cookie de um cabecalho `Cookie` bruto, sem rebentar com lixo. */
export function readCookie(header: string | null | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    if (part.slice(0, idx).trim() !== name) continue;
    const value = part.slice(idx + 1).trim();
    return value || null;
  }
  return null;
}

export interface AttributionPayload {
  first_touch: Touch | null;
  last_touch: Touch | null;
  channel: Channel;
  source: string;
  medium: string;
  campaign: string | null;
  content: string | null;
  term: string | null;
  referrer_host: string | null;
  landing_path: string | null;
  click_ids: Record<string, string>;
}

/** Junta os dois toques na forma que a BD guarda por pedido. */
export function attributionPayload(first: Touch | null, last: Touch | null): AttributionPayload {
  const effective = last ?? first;
  return {
    first_touch: first,
    last_touch: last,
    channel: effective?.ch ?? 'direct',
    source: effective?.s ?? 'direto',
    medium: effective?.m ?? '(nenhum)',
    campaign: effective?.c ?? null,
    content: effective?.ct ?? null,
    term: effective?.t ?? null,
    referrer_host: effective?.r ?? null,
    landing_path: first?.lp ?? effective?.lp ?? null,
    click_ids: effective?.cid ?? first?.cid ?? {},
  };
}
