/**
 * Quando o telemóvel do estafeta manda a posição.
 *
 * O `watchPosition` dispara a cada poucos metros; mandar tudo gastava os dados
 * móveis dele e a bateria. Manda-se quando passou tempo suficiente OU quando
 * andou o suficiente, o que vier primeiro — parado num semáforo não gasta
 * nada, e a andar o mapa da loja nunca fica mais de um minuto atrás.
 */

export type Fix = { lat: number; lng: number; at: number };

export const PING_MIN_INTERVAL_MS = 15_000;
export const PING_MAX_INTERVAL_MS = 60_000;
export const PING_MIN_DISTANCE_M = 50;

/** Distância em metros entre dois pontos (haversine). */
export function distanceMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6_371_000;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function shouldSendPing(last: Fix | null, next: Fix): boolean {
  if (!last) return true;
  const elapsed = next.at - last.at;
  if (elapsed < PING_MIN_INTERVAL_MS) return false;
  if (elapsed >= PING_MAX_INTERVAL_MS) return true;
  return distanceMeters(last, next) >= PING_MIN_DISTANCE_M;
}

/** "há 3 min" — idade de uma posição, para o mapa da loja. */
export function positionAge(recordedAt: string, now: number = Date.now()): string {
  const s = Math.max(0, Math.round((now - new Date(recordedAt).getTime()) / 1000));
  if (s < 60) return 'agora';
  const m = Math.round(s / 60);
  if (m < 60) return `há ${m} min`;
  const h = Math.round(m / 60);
  return `há ${h} h`;
}

/** Uma posição com mais de 5 minutos já não diz onde o estafeta está. */
export function isStale(recordedAt: string, now: number = Date.now()): boolean {
  return now - new Date(recordedAt).getTime() > 5 * 60_000;
}
