import { createHmac, timingSafeEqual } from 'node:crypto';

/** Janela aceite entre o carimbo do webhook e o relógio do servidor. */
export const WEBHOOK_TOLERANCE_SECONDS = 300;

/**
 * HMAC-SHA256 em hex sobre `${timestamp}.${rawBody}`, com o segredo como bytes UTF-8 tal e qual
 * (contrato Tyxter). Carimbo em segundos. Comparação em tempo constante.
 */
export function verifyTimestampedSignature(input: {
  secret: string;
  timestamp: string | null;
  signature: string | null;
  rawBody: string;
  nowMs?: number;
}): boolean {
  const { secret, timestamp, signature, rawBody } = input;
  if (!secret || !timestamp || !signature || !/^\d{1,12}$/.test(timestamp)) return false;
  const nowSeconds = Math.floor((input.nowMs ?? Date.now()) / 1000);
  if (Math.abs(nowSeconds - Number(timestamp)) > WEBHOOK_TOLERANCE_SECONDS) return false;
  const expected = Buffer.from(signTimestamped(secret, timestamp, rawBody), 'utf8');
  const given = Buffer.from(signature.trim().toLowerCase(), 'utf8');
  return expected.length === given.length && timingSafeEqual(expected, given);
}

export function signTimestamped(secret: string, timestamp: string, rawBody: string): string {
  return createHmac('sha256', Buffer.from(secret, 'utf8')).update(`${timestamp}.${rawBody}`).digest('hex');
}
