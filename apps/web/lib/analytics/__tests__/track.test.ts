/**
 * F4.2 / F4.4 — testes do módulo de tracking.
 * F4.2: lógica de despacho ao dataLayer.
 * F4.4: postFP chama /api/track para first-party events.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  trackAddToCart,
  trackBeginCheckout,
  trackPurchase,
  trackViewMenu,
  trackAddPaymentInfo,
  trackLead,
  hasConsent,
  type TrackItem,
} from '../track';

type DL = Record<string, unknown>[];

function lastEvent(dl: DL, event: string) {
  return [...dl].reverse().find((e) => e.event === event);
}

let fetchCalls: { url: string; body: Record<string, unknown> }[] = [];

beforeEach(() => {
  fetchCalls = [];
  (globalThis as any).fetch = vi.fn((_url: string, opts?: RequestInit) => {
    const body = opts?.body ? JSON.parse(opts.body as string) : {};
    fetchCalls.push({ url: _url, body });
    return Promise.resolve({ ok: true, json: async () => ({ ok: true }) });
  });
  (globalThis as any).window = {
    dataLayer: [] as DL,
    location: { search: '' },
  };
  (globalThis as any).document = { cookie: '' };
});

afterEach(() => {
  delete (globalThis as any).window;
  delete (globalThis as any).document;
  delete (globalThis as any).fetch;
  vi.restoreAllMocks();
});

function dl(): DL {
  return (globalThis as any).window.dataLayer;
}

describe('value via money.ts (centavos → MT decimal, sem float manual)', () => {
  it('add_to_cart calcula value = price_cents*qty/100', () => {
    const item: TrackItem = { id: 'a1', name: 'Caril', price_cents: 6500, qty: 2 };
    trackAddToCart(item);
    const ev = lastEvent(dl(), 'add_to_cart')!;
    const ecom = ev.ecommerce as any;
    expect(ecom.value).toBe(130);
    expect(ecom.currency).toBe('MZN');
    expect(ecom.items[0]).toMatchObject({ item_id: 'a1', price: 65, quantity: 2 });
  });
});

describe('limpeza de contexto (ecommerce:null antes do evento)', () => {
  it('cada evento de ecommerce empurra ecommerce:null imediatamente antes', () => {
    trackAddToCart({ id: 'x', name: 'X', price_cents: 1000 });
    const arr = dl();
    const idx = arr.findIndex((e) => e.event === 'add_to_cart');
    expect(idx).toBeGreaterThan(0);
    expect(arr[idx - 1]).toEqual({ ecommerce: null });
  });
});

describe('begin_checkout soma o carrinho', () => {
  it('value = soma de price_cents*qty', () => {
    const items: TrackItem[] = [
      { id: 'a', name: 'A', price_cents: 5000, qty: 2 }, // 100
      { id: 'b', name: 'B', price_cents: 2500, qty: 1 }, // 25
    ];
    trackBeginCheckout(items);
    const ev = lastEvent(dl(), 'begin_checkout')!;
    expect((ev.ecommerce as any).value).toBe(125);
  });
});

describe('trackPurchase — ordem e dedup', () => {
  it('empurra purchase com transaction_id e value correctos', () => {
    trackPurchase({ orderId: 'ord-1', totalCents: 17500 });
    const ev = lastEvent(dl(), 'purchase')!;
    const ecom = ev.ecommerce as any;
    expect(ecom.transaction_id).toBe('ord-1');
    expect(ecom.value).toBe(175);
    expect(ecom.currency).toBe('MZN');
  });

  it('usa fallback de 1 item quando não há detalhe', () => {
    trackPurchase({ orderId: 'ord-2', totalCents: 5000 });
    const ev = lastEvent(dl(), 'purchase')!;
    const items = (ev.ecommerce as any).items;
    expect(items).toHaveLength(1);
    expect(items[0].item_id).toBe('ord-2');
  });
});

describe('trackLead', () => {
  it('empurra generate_lead', () => {
    trackLead();
    expect(lastEvent(dl(), 'generate_lead')).toBeTruthy();
  });
});

describe('hasConsent lê o cookie dl_consent', () => {
  it('false sem cookie', () => {
    expect(hasConsent()).toBe(false);
  });
  it('true com dl_consent=granted', () => {
    (globalThis as any).document.cookie = 'foo=bar; dl_consent=granted';
    expect(hasConsent()).toBe(true);
  });
});

// ── F4.4: postFP — first-party events via /api/track ─────────────────────────

describe('postFP — chama /api/track para cada evento', () => {
  it('trackViewMenu → POST /api/track com type="view_menu"', () => {
    trackViewMenu([{ id: 'i1', name: 'Item', price_cents: 1000 }]);
    expect(fetchCalls.some((c) => c.url === '/api/track' && c.body.type === 'view_menu')).toBe(true);
  });

  it('trackAddToCart → POST com type="add_to_cart" e value_cents correcto', () => {
    const item: TrackItem = { id: 'x', name: 'X', price_cents: 5000, qty: 2 };
    trackAddToCart(item);
    const call = fetchCalls.find((c) => c.body.type === 'add_to_cart');
    expect(call).toBeTruthy();
    expect(call!.body.value_cents).toBe(10000); // 5000 * 2
  });

  it('trackBeginCheckout → POST com type="begin_checkout"', () => {
    trackBeginCheckout([{ id: 'a', name: 'A', price_cents: 3000, qty: 1 }]);
    expect(fetchCalls.some((c) => c.body.type === 'begin_checkout')).toBe(true);
  });

  it('trackAddPaymentInfo → POST com type="add_payment_info" e payload.method', () => {
    trackAddPaymentInfo([{ id: 'a', name: 'A', price_cents: 3000 }], 'mpesa');
    const call = fetchCalls.find((c) => c.body.type === 'add_payment_info');
    expect(call).toBeTruthy();
    expect((call!.body.payload as any).method).toBe('mpesa');
  });

  it('trackPurchase → POST com type="purchase" e value_cents = total', () => {
    trackPurchase({ orderId: 'ord-fp', totalCents: 22000 });
    const call = fetchCalls.find((c) => c.body.type === 'purchase');
    expect(call).toBeTruthy();
    expect(call!.body.value_cents).toBe(22000);
    expect((call!.body.payload as any).order_id).toBe('ord-fp');
  });

  it('trackLead → POST com type="lead"', () => {
    trackLead();
    expect(fetchCalls.some((c) => c.body.type === 'lead')).toBe(true);
  });
});

describe('F7 — dimensão da loja em todos os eventos', () => {
  it('leva a loja escolhida ao dataLayer e ao first-party', () => {
    (globalThis as any).document.cookie = 'dl_session=abc; hs_store=matola';
    const item: TrackItem = { id: 'a1', name: 'Classic Smash', price_cents: 30000, qty: 1 };

    trackAddToCart(item);

    const event = lastEvent(dl(), 'add_to_cart')!;
    expect((event.ecommerce as any).store).toBe('matola');

    const call = fetchCalls.find((entry) => entry.url === '/api/track');
    expect(call?.body.store).toBe('matola');
  });

  it('não inventa loja quando o cliente ainda não escolheu', () => {
    (globalThis as any).document.cookie = 'dl_session=abc';
    trackViewMenu([{ id: 'a1', name: 'Classic Smash', price_cents: 30000 }]);

    const event = lastEvent(dl(), 'view_item_list')!;
    expect((event.ecommerce as any).store).toBeUndefined();

    const call = fetchCalls.find((entry) => entry.url === '/api/track');
    expect(call?.body.store).toBeUndefined();
  });
});
