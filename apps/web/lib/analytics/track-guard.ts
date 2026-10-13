/**
 * track-guard.ts — o que o /api/track aceita, em código puro e testável.
 *
 * A rota grava com service role, por isso é ela a única barreira: sem estes
 * limites qualquer pessoa enchia `analytics_events` com JSON arbitrário e
 * estragava o funil (auditoria REA, 13/10/2026).
 *
 * - corpo até MAX_BODY_BYTES (os eventos reais têm < 500 bytes);
 * - `type` só dos eventos que o site emite (lib/analytics/track.ts);
 * - `utm` só com as 5 chaves utm_* e valores curtos;
 * - `payload` raso: poucas chaves, só valores primitivos e curtos;
 * - rate limit por IP numa janela fixa (em memória, por instância).
 */
import { resolveStoreSlug } from '@/lib/store-context';

export const MAX_BODY_BYTES = 2048;

export const TRACK_TYPES = [
  'view_menu',
  'view_item',
  'add_to_cart',
  'begin_checkout',
  'add_payment_info',
  'lead',
  'purchase',
  'upsell_view',
  'upsell_accept',
] as const;

export type TrackType = (typeof TRACK_TYPES)[number];

const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'];
const MAX_UTM_VALUE = 200;
const MAX_PAYLOAD_KEYS = 10;
const MAX_PAYLOAD_KEY = 40;
const MAX_PAYLOAD_STRING = 200;
// Teto de sanidade: 100 milhões de MT. Um pedido real nunca chega perto.
const MAX_VALUE_CENTS = 10_000_000_000;

export interface TrackBody {
  type: TrackType;
  value_cents?: number;
  utm: Record<string, string>;
  payload: Record<string, string | number | boolean | null>;
  store: string | null;
}

export type TrackValidation = { ok: true; data: TrackBody } | { ok: false; error: string };

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

export function validateTrackBody(body: unknown): TrackValidation {
  if (!isPlainObject(body)) return { ok: false, error: 'body must be an object' };

  if (typeof body.type !== 'string' || !(TRACK_TYPES as readonly string[]).includes(body.type)) {
    return { ok: false, error: 'unknown event type' };
  }

  if (body.value_cents !== undefined) {
    const v = body.value_cents;
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v > MAX_VALUE_CENTS) {
      return { ok: false, error: 'value_cents must be a non-negative integer' };
    }
  }

  let store: string | null = null;
  if (body.store !== undefined && body.store !== null && body.store !== '') {
    try {
      store = resolveStoreSlug(body.store);
    } catch {
      return { ok: false, error: 'store must be a valid slug' };
    }
  }

  // UTM: chaves desconhecidas descartam-se em silêncio (o cliente não tem culpa
  // de um link com parâmetros a mais); valores longos ou não-string, idem.
  const utm: Record<string, string> = {};
  if (body.utm !== undefined) {
    if (!isPlainObject(body.utm)) return { ok: false, error: 'utm must be an object' };
    for (const k of UTM_KEYS) {
      const v = body.utm[k];
      if (typeof v === 'string' && v.length > 0) utm[k] = v.slice(0, MAX_UTM_VALUE);
    }
  }

  const payload: TrackBody['payload'] = {};
  if (body.payload !== undefined) {
    if (!isPlainObject(body.payload)) return { ok: false, error: 'payload must be an object' };
    const entries = Object.entries(body.payload);
    if (entries.length > MAX_PAYLOAD_KEYS) return { ok: false, error: 'payload has too many keys' };
    for (const [k, v] of entries) {
      if (k.length > MAX_PAYLOAD_KEY) return { ok: false, error: 'payload key too long' };
      if (typeof v === 'string') {
        if (v.length > MAX_PAYLOAD_STRING) return { ok: false, error: 'payload value too long' };
        payload[k] = v;
      } else if (typeof v === 'number' || typeof v === 'boolean' || v === null) {
        if (typeof v === 'number' && !Number.isFinite(v)) {
          return { ok: false, error: 'payload number must be finite' };
        }
        payload[k] = v;
      } else {
        return { ok: false, error: 'payload values must be primitive' };
      }
    }
  }

  return {
    ok: true,
    data: {
      type: body.type as TrackType,
      ...(body.value_cents !== undefined ? { value_cents: body.value_cents as number } : {}),
      utm,
      payload,
      store,
    },
  };
}

// ── rate limit ──────────────────────────────────────────────────────────────
// Janela fixa por chave (IP). Em memória: protege cada instância do Railway,
// não é um limite global — chega para travar um script a martelar a rota.

export const RATE_LIMIT_MAX = 60;
export const RATE_LIMIT_WINDOW_MS = 60_000;
const MAX_TRACKED_KEYS = 10_000;

export interface RateLimiter {
  allow(key: string, now?: number): boolean;
}

export function createRateLimiter(
  max = RATE_LIMIT_MAX,
  windowMs = RATE_LIMIT_WINDOW_MS,
): RateLimiter {
  const hits = new Map<string, { start: number; count: number }>();

  return {
    allow(key: string, now = Date.now()): boolean {
      const entry = hits.get(key);
      if (!entry || now - entry.start >= windowMs) {
        // Limpeza preguiçosa: o mapa nunca cresce sem fim com IPs de passagem.
        if (hits.size >= MAX_TRACKED_KEYS) {
          for (const [k, e] of hits) {
            if (now - e.start >= windowMs) hits.delete(k);
          }
          if (hits.size >= MAX_TRACKED_KEYS) hits.clear();
        }
        hits.set(key, { start: now, count: 1 });
        return true;
      }
      entry.count += 1;
      return entry.count <= max;
    },
  };
}

/** Chave do rate limit: primeiro salto do x-forwarded-for (o edge do Railway). */
export function rateLimitKey(forwardedFor: string | null, realIp: string | null): string {
  const first = forwardedFor?.split(',')[0]?.trim();
  return (first || realIp?.trim() || 'unknown').slice(0, 60);
}
