import { describe, expect, it } from 'vitest';

import {
  actionSchema,
  courierErrorCode,
  courierErrorMessage,
  loginSchema,
  navigationUrl,
  phoneHref,
} from '../contract';
import { distanceMeters, isStale, positionAge, shouldSendPing } from '../tracking';

describe('contrato do telemóvel do estafeta', () => {
  it('o PIN tem 4 a 6 dígitos, como o do POS', () => {
    expect(loginSchema.safeParse({ phone: '841234567', pin: '1234' }).success).toBe(true);
    expect(loginSchema.safeParse({ phone: '841234567', pin: '12a4' }).success).toBe(false);
    expect(loginSchema.safeParse({ phone: '841234567', pin: '123' }).success).toBe(false);
  });

  it('as acções não levam dinheiro nenhum — só ids e posição', () => {
    const r = actionSchema.safeParse({
      action: 'deliver',
      deliveryId: '11111111-1111-4111-8111-111111111111',
      fee_cents: 999,
    });
    expect(r.success).toBe(true);
    expect(r.success && 'fee_cents' in r.data).toBe(false);
  });

  it('posição fora do planeta é recusada', () => {
    expect(actionSchema.safeParse({ action: 'ping', lat: 91, lng: 0 }).success).toBe(false);
    expect(actionSchema.safeParse({ action: 'ping', lat: -25.96, lng: 32.58 }).success).toBe(true);
  });

  it('o erro da BD vira uma frase que o estafeta entende', () => {
    expect(courierErrorMessage('order_not_ready')).toContain('ainda não está pronto');
    expect(courierErrorCode('ERROR: courier_session_invalid')).toBe('courier_session_invalid');
    expect(courierErrorMessage('qualquer coisa')).toContain('Verifica a rede');
  });

  it('navegação e telefone com indicativo de Moçambique', () => {
    expect(navigationUrl('Av. Julius Nyerere 100', 'Polana')).toContain(
      encodeURIComponent('Av. Julius Nyerere 100, Polana'),
    );
    expect(navigationUrl(null, null)).toBeNull();
    expect(phoneHref('84 123 4567')).toBe('tel:+258841234567');
    expect(phoneHref('258841234567')).toBe('tel:+258841234567');
    expect(phoneHref(null)).toBeNull();
  });
});

describe('quando o telemóvel manda a posição', () => {
  const base = { lat: -25.9655, lng: 32.5832, at: 0 };

  it('a primeira posição vai sempre', () => {
    expect(shouldSendPing(null, base)).toBe(true);
  });

  it('parado não gasta dados antes de um minuto', () => {
    expect(shouldSendPing(base, { ...base, at: 30_000 })).toBe(false);
    expect(shouldSendPing(base, { ...base, at: 60_000 })).toBe(true);
  });

  it('a andar manda ao fim de 15 s se andou 50 m', () => {
    const longe = { lat: base.lat + 0.001, lng: base.lng, at: 16_000 }; // ~111 m
    expect(distanceMeters(base, longe)).toBeGreaterThan(100);
    expect(shouldSendPing(base, longe)).toBe(true);
    expect(shouldSendPing(base, { ...longe, at: 5_000 })).toBe(false);
  });

  it('idade da posição', () => {
    const agora = Date.parse('2026-10-13T12:00:00Z');
    expect(positionAge('2026-10-13T11:59:30Z', agora)).toBe('agora');
    expect(positionAge('2026-10-13T11:57:00Z', agora)).toBe('há 3 min');
    expect(isStale('2026-10-13T11:54:00Z', agora)).toBe(true);
    expect(isStale('2026-10-13T11:58:00Z', agora)).toBe(false);
  });
});
