import { metaMessageBody } from './meta';
import { verifyTimestampedSignature } from './signature';
import type {
  DeliveryStatus,
  HeaderReader,
  MediaDownload,
  OutboundMessage,
  SendResult,
  WebhookDelivery,
  WebhookEvent,
  WhatsAppTransport,
} from './types';

export interface TyxterConfig {
  apiKey: string;
  webhookSecret: string;
  baseUrl?: string;
  timeoutMs?: number;
}

const STATUS_EVENTS: Record<string, DeliveryStatus> = {
  'message.sent': 'sent',
  'message.delivered': 'delivered',
  'message.read': 'read',
  'message.failed': 'failed',
};

type Json = Record<string, unknown>;
const obj = (value: unknown): Json =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Json) : {};
const str = (value: unknown): string | null => (typeof value === 'string' && value.length > 0 ? value : null);

/**
 * Transporte Tyxter (`api.tyxter.com`, contrato OpenAPI 3.1, `POST /v1/messages`).
 * Chaves `tx_sandbox_…` ensaiam sem Meta; `tx_live_…` enviam a sério.
 * Alternativa à Cloud API (ADR 0012): só aluga números brasileiros e factura em BRL.
 */
export function createTyxterTransport(config: TyxterConfig): WhatsAppTransport {
  const baseUrl = (config.baseUrl || 'https://api.tyxter.com').replace(/\/$/, '');
  const timeoutMs = config.timeoutMs ?? 15_000;
  const auth = { authorization: `Bearer ${config.apiKey}` };

  return {
    name: config.apiKey.startsWith('tx_sandbox_') ? 'tyxter-sandbox' : 'tyxter',

    async send(message: OutboundMessage): Promise<SendResult> {
      let content: Json;
      if (message.type === undefined || message.type === 'template') {
        const template: Json = { name: message.template, language: message.language };
        if (message.variables && Object.keys(message.variables).length) template.variables = message.variables;
        if (message.components?.length) template.components = message.components;
        content = { type: 'template', template };
      } else {
        // Texto e interactivas: a Tyxter aceita o mesmo formato da Meta.
        const meta = metaMessageBody(message);
        content = { type: meta.type, [meta.type as string]: meta[meta.type as string] };
      }
      let res: Response;
      try {
        res = await fetch(`${baseUrl}/v1/messages`, {
          method: 'POST',
          headers: { ...auth, 'content-type': 'application/json', 'idempotency-key': message.idempotencyKey },
          body: JSON.stringify({
            channel: 'whatsapp',
            sender: { type: 'whatsapp_phone_number', id: message.senderId },
            recipient: { type: 'phone_e164', id: message.to },
            message: content,
          }),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (error) {
        return { ok: false, retryable: true, code: 'network', error: error instanceof Error ? error.message : 'network' };
      }
      let body: Json = {};
      try { body = obj(JSON.parse(await res.text())); } catch { /* corpo vazio ou não-JSON */ }
      if (res.ok) {
        const id = str(body.id);
        return id
          ? { ok: true, providerMessageId: id }
          : { ok: false, retryable: false, code: 'invalid_response', error: 'Resposta sem id da mensagem.' };
      }
      const err = obj(body.error);
      const code = str(err.code) ?? `http_${res.status}`;
      const retryAfter = Number(err.retry_after_ms ?? Number(res.headers.get('retry-after')) * 1000);
      return {
        ok: false,
        // DECISÃO: 402 (sem crédito) volta à fila — recarregar o crédito não deve perder os avisos ainda úteis.
        retryable:
          res.status >= 500 || res.status === 429 || res.status === 402 || code === 'idempotency_key_in_progress',
        code,
        error: (str(err.message) ?? `HTTP ${res.status}`).slice(0, 500),
        ...(Number.isFinite(retryAfter) && retryAfter > 0 ? { retryAfterMs: retryAfter } : {}),
      };
    },

    verifyWebhook(rawBody: string, headers: HeaderReader, nowMs?: number): boolean {
      return verifyTimestampedSignature({
        secret: config.webhookSecret,
        timestamp: headers.get('tyxter-webhook-timestamp'),
        signature: headers.get('tyxter-webhook-signature'),
        rawBody,
        nowMs,
      });
    },

    parseWebhook(payload: unknown, headers: HeaderReader): WebhookDelivery[] | null {
      return tyxterDeliveries(payload, headers);
    },

    async downloadMedia(assetId: string): Promise<MediaDownload> {
      try {
        const res = await fetch(`${baseUrl}/v1/media/${encodeURIComponent(assetId)}/download-url`, {
          headers: auth, signal: AbortSignal.timeout(timeoutMs),
        });
        const body = obj(await res.json().catch(() => null));
        const url = str(body.download_url);
        if (!res.ok || !url) return { ok: false, retryable: res.status >= 500 || res.status === 429, error: `media_lookup_${res.status}` };
        const file = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
        if (!file.ok) return { ok: false, retryable: file.status >= 500, error: `media_download_${file.status}` };
        const bytes = new Uint8Array(await file.arrayBuffer());
        if (bytes.byteLength > 8 * 1024 * 1024) return { ok: false, retryable: false, error: 'media_grande_demais' };
        const mimeType = (file.headers.get('content-type') ?? 'application/octet-stream').split(';')[0].trim().toLowerCase();
        return { ok: true, bytes, mimeType };
      } catch (error) {
        return { ok: false, retryable: true, error: error instanceof Error ? error.message : 'network' };
      }
    },
  };
}

/** Uma entrega Tyxter = um evento, deduplicado pelo cabeçalho `tyxter-webhook-id`. */
export function tyxterDeliveries(payload: unknown, headers: HeaderReader): WebhookDelivery[] | null {
  const id = headers.get('tyxter-webhook-id');
  if (!id || id.length > 200) return null;
  return [{ eventId: id, event: parseTyxterEvent(payload) }];
}

export function parseTyxterEvent(payload: unknown): WebhookEvent {
  const envelope = obj(payload);
  const type = str(envelope.type) ?? 'unknown';
  const data = obj(envelope.data);
  const messageId = str(data.message_id);

  const status = STATUS_EVENTS[type];
  if (status && messageId) {
    const error = str(data.error_message) ?? str(data.error_code);
    return { kind: 'status', providerMessageId: messageId, status, ...(error ? { error: error.slice(0, 500) } : {}) };
  }

  if (type === 'message.received' && messageId) {
    const sender = obj(data.sender);
    const from = str(sender.id);
    const senderId = str(obj(data.recipient).id);
    if (!from || !senderId) return { kind: 'ignored', type };
    const content = obj(data.content);
    const contentType = str(content.type) ?? 'unknown';
    const interactive = obj(content.interactive);
    const reply = obj(interactive.button_reply ?? interactive.list_reply);
    const button = obj(content.button);
    const media = obj(content.media);
    const mediaId = str(media.asset_id) ?? str(media.id);
    const caption = str(media.caption);
    const text = str(obj(content.text).body) ?? str(reply.title) ?? str(button.text) ?? caption;
    const replyId = str(reply.id) ?? str(button.payload);
    return {
      kind: 'inbound',
      providerMessageId: messageId,
      senderId,
      from: from.startsWith('+') ? from : `+${from}`,
      text: text ? text.slice(0, 4096) : null,
      replyId: replyId ? replyId.slice(0, 256) : null,
      profileName: str(sender.profile_name)?.slice(0, 120) ?? null,
      media: mediaId ? { id: mediaId, mimeType: str(media.mime_type), caption } : null,
      contentType: contentType.slice(0, 40),
    };
  }

  return { kind: 'ignored', type };
}
