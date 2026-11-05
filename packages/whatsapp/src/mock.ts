import { signTimestamped, verifyTimestampedSignature } from './signature';
import { tyxterDeliveries } from './tyxter';
import type { HeaderReader, MediaDownload, OutboundMessage, SendResult, WhatsAppTransport } from './types';

export interface MockTransport extends WhatsAppTransport {
  /** Mensagens aceites, pela ordem de envio. Repetir a mesma chave não acrescenta. */
  readonly sent: OutboundMessage[];
  /** Próximas respostas forçadas (uma por envio), para ensaiar falhas. */
  failNext(...results: Extract<SendResult, { ok: false }>[]): void;
  /** Assina um corpo como o fornecedor assinaria — para testes do webhook. */
  sign(rawBody: string, nowMs?: number): { timestamp: string; signature: string };
  /** Media que `downloadMedia` devolve, por id. */
  readonly media: Map<string, MediaDownload>;
}

/**
 * Transporte sem rede. Não envia nada a ninguém: serve testes e desenvolvimento local.
 * Fala o formato de webhook da Tyxter (um evento por entrega, id no cabeçalho).
 */
export function createMockTransport(webhookSecret = 'mock-webhook-secret'): MockTransport {
  const sent: OutboundMessage[] = [];
  const ids = new Map<string, string>();
  const queue: Extract<SendResult, { ok: false }>[] = [];
  const media = new Map<string, MediaDownload>();

  return {
    name: 'mock',
    sent,
    media,
    failNext: (...results) => { queue.push(...results); },
    sign(rawBody, nowMs = Date.now()) {
      const timestamp = String(Math.floor(nowMs / 1000));
      return { timestamp, signature: signTimestamped(webhookSecret, timestamp, rawBody) };
    },
    async send(message) {
      const forced = queue.shift();
      if (forced) return forced;
      const existing = ids.get(message.idempotencyKey);
      if (existing) return { ok: true, providerMessageId: existing };
      const id = `mock_msg_${ids.size + 1}`;
      ids.set(message.idempotencyKey, id);
      sent.push(message);
      return { ok: true, providerMessageId: id };
    },
    verifyWebhook(rawBody: string, headers: HeaderReader, nowMs?: number) {
      return verifyTimestampedSignature({
        secret: webhookSecret,
        timestamp: headers.get('tyxter-webhook-timestamp'),
        signature: headers.get('tyxter-webhook-signature'),
        rawBody,
        nowMs,
      });
    },
    parseWebhook: tyxterDeliveries,
    verifyChallenge: (query) => (query.get('hub.verify_token') === webhookSecret ? query.get('hub.challenge') : null),
    async downloadMedia(id) {
      return media.get(id) ?? { ok: false, retryable: false, error: 'media_inexistente' };
    },
  };
}
