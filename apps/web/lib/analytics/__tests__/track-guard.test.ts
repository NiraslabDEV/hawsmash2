/**
 * O que o /api/track aceita (auditoria REA, 13/10/2026): só eventos do site,
 * UTM e payload limitados, e rate limit por IP.
 */
import { describe, it, expect } from 'vitest';
import {
  TRACK_TYPES,
  createRateLimiter,
  rateLimitKey,
  validateTrackBody,
} from '../track-guard';

describe('validateTrackBody', () => {
  it('aceita todos os eventos que o site emite', () => {
    for (const type of TRACK_TYPES) {
      expect(validateTrackBody({ type }).ok).toBe(true);
    }
  });

  it('aceita o upsell tal como o carrinho o envia', () => {
    const r = validateTrackBody({
      type: 'upsell_accept',
      payload: { item_id: 'abc', placement: 'cart', origin: 'online', context_id: 'x1' },
      utm: { utm_source: 'ig' },
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.payload.placement).toBe('cart');
  });

  it('recusa tipos inventados', () => {
    expect(validateTrackBody({ type: 'drop_table' }).ok).toBe(false);
    expect(validateTrackBody({ type: '' }).ok).toBe(false);
    expect(validateTrackBody({}).ok).toBe(false);
    expect(validateTrackBody([]).ok).toBe(false);
  });

  it('value_cents só inteiro, não negativo e com teto', () => {
    expect(validateTrackBody({ type: 'purchase', value_cents: 6500 }).ok).toBe(true);
    expect(validateTrackBody({ type: 'purchase', value_cents: -1 }).ok).toBe(false);
    expect(validateTrackBody({ type: 'purchase', value_cents: 1.5 }).ok).toBe(false);
    expect(validateTrackBody({ type: 'purchase', value_cents: 1e15 }).ok).toBe(false);
  });

  it('utm guarda só as 5 chaves utm_* e corta valores longos', () => {
    const r = validateTrackBody({
      type: 'view_menu',
      utm: { utm_source: 'x'.repeat(500), hack: 'y', utm_term: 3 },
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(Object.keys(r.data.utm)).toEqual(['utm_source']);
      expect(r.data.utm.utm_source).toHaveLength(200);
    }
  });

  it('payload: recusa objectos aninhados, chaves a mais e strings longas', () => {
    expect(validateTrackBody({ type: 'view_item', payload: { a: { b: 1 } } }).ok).toBe(false);
    expect(validateTrackBody({ type: 'view_item', payload: { a: [1, 2] } }).ok).toBe(false);
    const many = Object.fromEntries(Array.from({ length: 11 }, (_, i) => [`k${i}`, i]));
    expect(validateTrackBody({ type: 'view_item', payload: many }).ok).toBe(false);
    expect(validateTrackBody({ type: 'view_item', payload: { a: 'x'.repeat(201) } }).ok).toBe(false);
    expect(validateTrackBody({ type: 'view_item', payload: 'x' }).ok).toBe(false);
  });
});

describe('createRateLimiter', () => {
  it('deixa passar até ao máximo e bloqueia depois, por chave', () => {
    const rl = createRateLimiter(3, 1000);
    expect([1, 2, 3].map(() => rl.allow('a', 0))).toEqual([true, true, true]);
    expect(rl.allow('a', 10)).toBe(false);
    expect(rl.allow('b', 10)).toBe(true);
  });

  it('a janela reabre depois do intervalo', () => {
    const rl = createRateLimiter(1, 1000);
    expect(rl.allow('a', 0)).toBe(true);
    expect(rl.allow('a', 500)).toBe(false);
    expect(rl.allow('a', 1000)).toBe(true);
  });
});

describe('rateLimitKey', () => {
  it('usa o primeiro salto do x-forwarded-for', () => {
    expect(rateLimitKey('1.2.3.4, 10.0.0.1', null)).toBe('1.2.3.4');
    expect(rateLimitKey(null, '5.6.7.8')).toBe('5.6.7.8');
    expect(rateLimitKey(null, null)).toBe('unknown');
  });
});
