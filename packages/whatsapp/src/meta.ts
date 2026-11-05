import { createHmac, timingSafeEqual } from 'node:crypto';
import { fitSession } from './limits';
import type {
  DeliveryStatus,
  HeaderReader,
  InboundMedia,
  MediaDownload,
  OutboundMessage,
  SendResult,
  SessionContent,
  WebhookDelivery,
  WebhookEvent,
  WhatsAppTransport,
} from './types';

/**
 * Transporte da **Cloud API da Meta** (graph.facebook.com), sem intermediário (ADR 0012).
 * Um token de utilizador de sistema serve todos os números da mesma WABA; cada loja envia pelo seu
 * `phone_number_id` (`stores.whatsapp_sender_id`).
 */
export interface MetaConfig {
  /** Token permanente de utilizador de sistema com `whatsapp_business_messaging`. */
  accessToken: string;
  /** Segredo da app Meta: assina os webhooks (`X-Hub-Signature-256`). */
  appSecret: string;
  /** Texto escolhido por nós e colado no painel da Meta para o aperto de mão do webhook. */
  verifyToken: string;
  graphVersion?: string;
  baseUrl?: string;
  timeoutMs?: number;
  /** Comprovativos maiores do que isto não se descarregam. */
  maxMediaBytes?: number;
}

/** A mais recente a 05/11/2026 (v26.0, lançada a 29/07/2026). Confirmar em developers.facebook.com/docs/graph-api/changelog. */
export const META_DEFAULT_GRAPH_VERSION = 'v26.0';

type Json = Record<string, unknown>;
const obj = (value: unknown): Json =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Json) : {};
const arr = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const str = (value: unknown): string | null => (typeof value === 'string' && value.length > 0 ? value : null);

/**
 * Erros da Meta que passam com o tempo (limites de ritmo, serviço em baixo, token a renovar).
 * Os restantes — fora da janela de 24 h, número sem WhatsApp, template inexistente — não se repetem.
 */
const RETRYABLE_CODES = new Set([1, 2, 4, 17, 341, 190, 80007, 130429, 131000, 131016, 131056, 133004]);

const STATUS: Record<string, DeliveryStatus> = { sent: 'sent', delivered: 'delivered', read: 'read', failed: 'failed' };
const MEDIA_TYPES = new Set(['image', 'document', 'sticker', 'audio', 'video']);

/** Corpo do `POST /{phone_number_id}/messages`. Exportado para teste. */
export function metaMessageBody(message: OutboundMessage): Json {
  // Telefone vai em `to`; o BSUID de quem esconde o número vai em `recipient`.
  const isPhone = /^\+?\d{8,15}$/.test(message.to);
  const base = {
    messaging_product: 'whatsapp', recipient_type: 'individual',
    ...(isPhone ? { to: message.to.replace(/^\+/, '') } : { recipient: message.to }),
  };
  if (message.type === undefined || message.type === 'template') {
    const components: Array<Record<string, unknown>> = [];
    const vars = Object.entries(message.variables ?? {});
    if (vars.length) {
      components.push({
        type: 'body',
        // Parâmetros com nome ({{nome}}): a Meta casa-os pelo nome, não pela ordem.
        parameters: vars.map(([name, value]) => ({ type: 'text', parameter_name: name, text: String(value) })),
      });
    }
    components.push(...(message.components ?? []));
    return {
      ...base,
      type: 'template',
      template: { name: message.template, language: { code: message.language }, ...(components.length ? { components } : {}) },
    };
  }
  const content = fitSession(message as SessionContent);
  if (content.type === 'text') {
    return { ...base, type: 'text', text: { body: content.text, preview_url: Boolean(content.previewUrl) } };
  }
  if (content.type === 'request_contact') {
    return {
      ...base, type: 'interactive',
      interactive: { type: 'request_contact_info', body: { text: content.text }, action: { name: 'request_contact_info' } },
    };
  }
  const frame = {
    ...(content.header ? { header: { type: 'text', text: content.header } } : {}),
    body: { text: content.text },
    ...(content.footer ? { footer: { text: content.footer } } : {}),
  };
  if (content.type === 'buttons') {
    return {
      ...base, type: 'interactive',
      interactive: { type: 'button', ...frame, action: { buttons: content.buttons.map((b) => ({ type: 'reply', reply: { id: b.id, title: b.title } })) } },
    };
  }
  if (content.type === 'list') {
    return {
      ...base, type: 'interactive',
      interactive: {
        type: 'list', ...frame,
        action: {
          button: content.button,
          sections: content.sections.map((s) => ({ ...(s.title ? { title: s.title } : {}), rows: s.rows })),
        },
      },
    };
  }
  return {
    ...base, type: 'interactive',
    interactive: { type: 'cta_url', ...frame, action: { name: 'cta_url', parameters: { display_text: content.displayText, url: content.url } } },
  };
}

export function createMetaTransport(config: MetaConfig): WhatsAppTransport {
  const version = config.graphVersion?.trim() || META_DEFAULT_GRAPH_VERSION;
  const graph = `${(config.baseUrl || 'https://graph.facebook.com').replace(/\/$/, '')}/${version}`;
  const timeoutMs = config.timeoutMs ?? 15_000;
  const maxMediaBytes = config.maxMediaBytes ?? 8 * 1024 * 1024;
  const auth = { authorization: `Bearer ${config.accessToken}` };

  return {
    name: 'meta',

    async send(message: OutboundMessage): Promise<SendResult> {
      if (!/^[0-9]{5,30}$/.test(message.senderId)) {
        return { ok: false, retryable: false, code: 'invalid_sender', error: 'phone_number_id inválido.' };
      }
      let res: Response;
      try {
        res = await fetch(`${graph}/${message.senderId}/messages`, {
          method: 'POST',
          headers: { ...auth, 'content-type': 'application/json' },
          body: JSON.stringify(metaMessageBody(message)),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (error) {
        // DECISÃO: a Cloud API não deduplica. Um timeout pode ter enviado; repetir pode duplicar um aviso.
        // Um aviso repetido é melhor do que um perdido, e a validade da linha (expires_at) limita o estrago.
        return { ok: false, retryable: true, code: 'network', error: error instanceof Error ? error.message : 'network' };
      }
      let body: Json = {};
      try { body = obj(JSON.parse(await res.text())); } catch { /* corpo vazio ou não-JSON */ }
      if (res.ok) {
        const id = str(obj(arr(body.messages)[0]).id);
        return id
          ? { ok: true, providerMessageId: id }
          : { ok: false, retryable: false, code: 'invalid_response', error: 'Resposta sem id da mensagem.' };
      }
      const err = obj(body.error);
      const numeric = typeof err.code === 'number' ? err.code : Number(err.code);
      const code = Number.isFinite(numeric) ? String(numeric) : `http_${res.status}`;
      const details = str(obj(err.error_data).details);
      const retryAfter = Number(res.headers.get('retry-after')) * 1000;
      return {
        ok: false,
        retryable: res.status >= 500 || res.status === 429 || RETRYABLE_CODES.has(numeric),
        code,
        error: [str(err.message) ?? `HTTP ${res.status}`, details].filter(Boolean).join(' — ').slice(0, 500),
        ...(Number.isFinite(retryAfter) && retryAfter > 0 ? { retryAfterMs: retryAfter } : {}),
      };
    },

    verifyWebhook(rawBody: string, headers: HeaderReader): boolean {
      const header = headers.get('x-hub-signature-256');
      if (!config.appSecret || !header?.startsWith('sha256=')) return false;
      const expected = Buffer.from(createHmac('sha256', config.appSecret).update(rawBody, 'utf8').digest('hex'), 'utf8');
      const given = Buffer.from(header.slice(7).trim().toLowerCase(), 'utf8');
      return expected.length === given.length && timingSafeEqual(expected, given);
    },

    parseWebhook(payload: unknown): WebhookDelivery[] | null {
      return parseMetaWebhook(payload);
    },

    verifyChallenge(query: URLSearchParams): string | null {
      const token = query.get('hub.verify_token') ?? '';
      const challenge = query.get('hub.challenge') ?? '';
      if (query.get('hub.mode') !== 'subscribe' || !config.verifyToken || !/^[A-Za-z0-9_-]{1,200}$/.test(challenge)) return null;
      const a = Buffer.from(token, 'utf8');
      const b = Buffer.from(config.verifyToken, 'utf8');
      return a.length === b.length && timingSafeEqual(a, b) ? challenge : null;
    },

    async downloadMedia(mediaId: string): Promise<MediaDownload> {
      if (!/^[0-9]{3,40}$/.test(mediaId)) return { ok: false, retryable: false, error: 'media_id inválido.' };
      try {
        const metaRes = await fetch(`${graph}/${mediaId}`, { headers: auth, signal: AbortSignal.timeout(timeoutMs) });
        const meta = obj(await metaRes.json().catch(() => null));
        if (!metaRes.ok) return { ok: false, retryable: metaRes.status >= 500 || metaRes.status === 429, error: `media_lookup_${metaRes.status}` };
        const url = str(meta.url);
        const size = Number(meta.file_size);
        if (!url) return { ok: false, retryable: false, error: 'media_sem_url' };
        if (Number.isFinite(size) && size > maxMediaBytes) return { ok: false, retryable: false, error: 'media_grande_demais' };
        // O URL da media só abre com o mesmo token e é de um domínio da Meta.
        if (!/^https:\/\/([a-z0-9-]+\.)*(fbsbx\.com|facebook\.com|whatsapp\.net)\//i.test(url) && !config.baseUrl) {
          return { ok: false, retryable: false, error: 'media_url_inesperado' };
        }
        const fileRes = await fetch(url, { headers: auth, signal: AbortSignal.timeout(timeoutMs) });
        if (!fileRes.ok) return { ok: false, retryable: fileRes.status >= 500 || fileRes.status === 429, error: `media_download_${fileRes.status}` };
        const bytes = new Uint8Array(await fileRes.arrayBuffer());
        if (bytes.byteLength > maxMediaBytes) return { ok: false, retryable: false, error: 'media_grande_demais' };
        const mimeType = str(meta.mime_type) ?? fileRes.headers.get('content-type') ?? 'application/octet-stream';
        return { ok: true, bytes, mimeType: mimeType.split(';')[0].trim().toLowerCase() };
      } catch (error) {
        return { ok: false, retryable: true, error: error instanceof Error ? error.message : 'network' };
      }
    },
  };
}

/** Número que a própria pessoa partilhou no botão `request_contact_info`. Um cartão qualquer não conta: não é dela. */
function sharedPhone(message: Json): string | null {
  for (const contact of arr(message.contacts)) {
    const c = obj(contact);
    if (c.origin !== 'contact_request') continue;
    const digits = str(obj(arr(c.phones)[0]).phone)?.replace(/\D/g, '');
    if (digits && /^\d{8,15}$/.test(digits)) return digits;
  }
  return null;
}

function inboundFromMeta(message: Json, senderId: string, names: Map<string, string>): WebhookEvent {
  const id = str(message.id);
  const type = str(message.type) ?? 'unknown';
  // DECISÃO: `from` só conta se for um telefone. Com username escondido a Meta omite-o; fornecedores relatam
  // também o BSUID neste campo, e tirar-lhe os não-dígitos inventaria um número que não é de ninguém.
  const rawFrom = str(message.from);
  const phone = rawFrom && /^\+?\d{8,15}$/.test(rawFrom) ? rawFrom.replace(/\D/g, '') : null;
  const userId = str(message.from_user_id) ?? (rawFrom && !phone ? rawFrom : null);
  if (!id) return { kind: 'ignored', type };
  const shared = phone ? null : type === 'contacts' ? sharedPhone(message) : null;
  const fromDigits = phone ?? shared;
  if (!fromDigits) {
    if (!userId) return { kind: 'ignored', type };
    return { kind: 'inbound_hidden', providerMessageId: id, senderId, userId: userId.slice(0, 200), profileName: names.get(userId)?.slice(0, 120) ?? null };
  }
  if (shared) {
    return {
      kind: 'inbound', providerMessageId: id, senderId, from: `+${shared}`, text: null,
      replyId: 'contact:shared', profileName: (userId && names.get(userId)?.slice(0, 120)) || null, media: null, contentType: type.slice(0, 40),
    };
  }
  let text: string | null = null;
  let replyId: string | null = null;
  let media: InboundMedia | null = null;
  if (type === 'text') text = str(obj(message.text).body);
  else if (type === 'interactive') {
    const interactive = obj(message.interactive);
    const reply = obj(interactive.button_reply ?? interactive.list_reply);
    replyId = str(reply.id);
    text = str(reply.title) ?? str(obj(interactive.nfm_reply).body);
  } else if (type === 'button') {
    const button = obj(message.button);
    replyId = str(button.payload);
    text = str(button.text);
  } else if (MEDIA_TYPES.has(type)) {
    const m = obj(message[type]);
    const mediaId = str(m.id);
    if (mediaId) media = { id: mediaId, mimeType: str(m.mime_type), caption: str(m.caption) };
    text = str(m.caption);
  }
  return {
    kind: 'inbound',
    providerMessageId: id,
    senderId,
    from: `+${fromDigits}`,
    text: text ? text.slice(0, 4096) : null,
    replyId: replyId ? replyId.slice(0, 256) : null,
    profileName: names.get(fromDigits)?.slice(0, 120) ?? null,
    media,
    contentType: type.slice(0, 40),
  };
}

/** Uma entrega da Meta traz várias mensagens e estados, de vários números. Cada um com o seu id. */
export function parseMetaWebhook(payload: unknown): WebhookDelivery[] | null {
  const root = obj(payload);
  if (root.object !== 'whatsapp_business_account' || !Array.isArray(root.entry)) return null;
  const out: WebhookDelivery[] = [];
  for (const entry of arr(root.entry)) {
    for (const change of arr(obj(entry).changes)) {
      const c = obj(change);
      if (c.field !== 'messages') continue;
      const value = obj(c.value);
      const senderId = str(obj(value.metadata).phone_number_id);
      if (!senderId) continue;
      const names = new Map<string, string>();
      for (const contact of arr(value.contacts)) {
        const waId = str(obj(contact).wa_id)?.replace(/\D/g, '');
        const userId = str(obj(contact).user_id);
        const name = str(obj(obj(contact).profile).name);
        if (name && waId) names.set(waId, name);
        if (name && userId) names.set(userId, name);
      }
      for (const message of arr(value.messages)) {
        const m = obj(message);
        const id = str(m.id);
        if (!id) continue;
        out.push({ eventId: `wa:msg:${id}`.slice(0, 200), event: inboundFromMeta(m, senderId, names) });
      }
      for (const status of arr(value.statuses)) {
        const s = obj(status);
        const id = str(s.id);
        const mapped = STATUS[str(s.status) ?? ''];
        if (!id || !mapped) continue;
        const error = obj(arr(s.errors)[0]);
        const errorText = [str(String(error.code ?? '')), str(error.title), str(obj(error.error_data).details)]
          .filter(Boolean).join(': ');
        out.push({
          eventId: `wa:st:${id}:${mapped}`.slice(0, 200),
          event: { kind: 'status', providerMessageId: id, status: mapped, ...(errorText ? { error: errorText.slice(0, 500) } : {}) },
        });
      }
    }
  }
  return out;
}
