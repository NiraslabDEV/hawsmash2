'use client';

/**
 * track.ts — ÚNICO lugar que toca window.dataLayer / fbq / gtag.
 * Nenhum componente deve chamar fbq/gtag direto (CLAUDE.md 16.1, 16.3).
 *
 * Estratégia de carregamento (16.3):
 *   - Se houver GTM container → GTM é o hub: só carregamos o GTM e empurramos
 *     eventos para o dataLayer; as tags do GTM reenviam a GA4/Meta/Ads.
 *   - Sem GTM → carregamos gtag (GA4 + Google Ads) e fbq (Meta Pixel) direto.
 *
 * Consentimento (16.7): os scripts de marketing só carregam após "Aceitar"
 * (cookie dl_consent=granted). Os pushes ao dataLayer (first-party) são sempre
 * seguros — não carregam PII e ficam só num array até o GTM existir.
 */

import { centsToDecimalString, type Cents } from '@delivery/core';
import { parseStoreCookie } from '@/lib/store-context';

export interface MarketingConfig {
  gtm_container_id: string | null;
  meta_pixel_id: string | null;
  ga4_measurement_id: string | null;
  gads_conversion_id: string | null;
  gads_conversion_label: string | null;
}

export interface TrackItem {
  id: string;
  name: string;
  price_cents: number;
  qty?: number;
}

declare global {
  interface Window {
    dataLayer?: Record<string, unknown>[];
    fbq?: (...args: unknown[]) => void;
    _fbq?: unknown;
    gtag?: (...args: unknown[]) => void;
  }
}

const CURRENCY = 'MZN';

// Estado de carregamento (decide como os eventos são despachados).
let gtmLoaded = false;
let fbqLoaded = false;
let gtagLoaded = false;
let gadsSendTo: string | null = null;

// ── helpers internos ────────────────────────────────────────────────────────

function dl(): Record<string, unknown>[] {
  if (typeof window === 'undefined') return [];
  window.dataLayer = window.dataLayer || [];
  return window.dataLayer;
}

function pushDL(obj: Record<string, unknown>) {
  dl().push(obj);
}

/** value em MT (decimal) sempre via money.ts — nunca float manual. */
function toValue(cents: number): number {
  return Number(centsToDecimalString(cents as Cents));
}

function ga4Items(items: TrackItem[]) {
  return items.map((i) => ({
    item_id: i.id,
    item_name: i.name,
    price: toValue(i.price_cents),
    quantity: i.qty ?? 1,
  }));
}

function metaContents(items: TrackItem[]) {
  return items.map((i) => ({ id: i.id, quantity: i.qty ?? 1 }));
}

function sumValue(items: TrackItem[]): number {
  return toValue(items.reduce((s, i) => s + i.price_cents * (i.qty ?? 1), 0));
}

// ── carregamento dos scripts (idempotente, gated por consentimento) ──────────

export function hasConsent(): boolean {
  if (typeof document === 'undefined') return false;
  return document.cookie.split('; ').some((c) => c === 'dl_consent=granted');
}

export function grantConsent() {
  if (typeof document === 'undefined') return;
  // 180 dias
  document.cookie = `dl_consent=granted; path=/; max-age=${60 * 60 * 24 * 180}; samesite=lax`;
}

function loadGTM(containerId: string) {
  if (gtmLoaded || document.getElementById('gtm-script')) return;
  dl().push({ 'gtm.start': Date.now(), event: 'gtm.js' });
  const s = document.createElement('script');
  s.id = 'gtm-script';
  s.async = true;
  s.src = `https://www.googletagmanager.com/gtm.js?id=${containerId}`;
  document.head.appendChild(s);
  gtmLoaded = true;
}

function loadGtag(ids: string[]) {
  if (gtagLoaded || ids.length === 0) return;
  const first = ids[0];
  const s = document.createElement('script');
  s.id = 'gtag-script';
  s.async = true;
  s.src = `https://www.googletagmanager.com/gtag/js?id=${first}`;
  document.head.appendChild(s);
  window.gtag = function gtag() {
    // eslint-disable-next-line prefer-rest-params
    dl().push(arguments as unknown as Record<string, unknown>);
  };
  window.gtag('js', new Date());
  for (const id of ids) window.gtag('config', id);
  gtagLoaded = true;
}

function loadMetaPixel(pixelId: string) {
  if (fbqLoaded || window.fbq) return;
  /* eslint-disable */
  (function (f: any, b: any, e: string, v: string) {
    if (f.fbq) return;
    const n: any = (f.fbq = function () {
      n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments);
    });
    if (!f._fbq) f._fbq = n;
    n.push = n;
    n.loaded = true;
    n.version = '2.0';
    n.queue = [];
    const t = b.createElement(e);
    t.async = true;
    t.src = v;
    const s = b.getElementsByTagName(e)[0];
    s.parentNode.insertBefore(t, s);
  })(window, document, 'script', 'https://connect.facebook.net/en_US/fbevents.js');
  /* eslint-enable */
  window.fbq!('init', pixelId);
  window.fbq!('track', 'PageView');
  fbqLoaded = true;
}

/**
 * Inicializa o tracking com a config (do get_menu → marketing). Idempotente.
 * Só corre se houver consentimento; senão não carrega script nenhum.
 */
export function initTracking(config: MarketingConfig) {
  if (typeof window === 'undefined' || !hasConsent()) return;

  if (config.gads_conversion_id && config.gads_conversion_label) {
    gadsSendTo = `${config.gads_conversion_id}/${config.gads_conversion_label}`;
  }

  if (config.gtm_container_id) {
    // GTM é o hub — reenvia tudo via tags configuradas no painel GTM.
    loadGTM(config.gtm_container_id);
    return;
  }

  // Sem GTM: carrega gtag (GA4 + Ads) e fbq (Pixel) direto.
  const gtagIds = [config.ga4_measurement_id, config.gads_conversion_id].filter(
    Boolean,
  ) as string[];
  loadGtag(gtagIds);
  if (config.meta_pixel_id) loadMetaPixel(config.meta_pixel_id);
}

// ── first-party events (16.6) ───────────────────────────────────────────────
// Fire-and-forget para /api/track. Nunca bloqueia a UI; falha silenciosa.

function getUtm(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  const p = new URLSearchParams(window.location.search);
  const keys = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'];
  const utm: Record<string, string> = {};
  for (const k of keys) {
    const v = p.get(k);
    if (v) utm[k] = v;
  }
  return utm;
}

// Loja escolhida pelo cliente: é a dimensão que separa Maputo de Matola em
// todo o funil. Sem escolha, o evento segue sem loja (nunca inventada).
function currentStore(): string | undefined {
  if (typeof document === 'undefined') return undefined;
  return parseStoreCookie(document.cookie) ?? undefined;
}

function postFP(
  type: string,
  opts?: { value_cents?: number; payload?: Record<string, unknown> },
) {
  if (typeof window === 'undefined') return;
  const store = currentStore();
  fetch('/api/track', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type, utm: getUtm(), ...(store ? { store } : {}), ...opts }),
  }).catch(() => {});
}

// ── despacho de eventos ──────────────────────────────────────────────────────
// Sempre push ao dataLayer (GTM/first-party). Em modo sem-GTM, também chama
// gtag/fbq direto. Em modo GTM, gtag/fbq não existem → só o dataLayer.

function emit(
  ga4Event: string,
  ga4Payload: Record<string, unknown>,
  metaEvent: string | null,
  metaPayload: Record<string, unknown>,
  metaOpts?: Record<string, unknown>,
) {
  const store = currentStore();
  const payloadWithStore = store ? { ...ga4Payload, store } : ga4Payload;
  pushDL({ ecommerce: null });
  pushDL({ event: ga4Event, ecommerce: payloadWithStore });
  if (gtagLoaded && window.gtag) {
    window.gtag('event', ga4Event, payloadWithStore);
  }
  if (metaEvent && fbqLoaded && window.fbq) {
    window.fbq('track', metaEvent, metaPayload, metaOpts);
  }
}

export function trackViewMenu(items: TrackItem[]) {
  emit(
    'view_item_list',
    { items: ga4Items(items) },
    'ViewContent',
    { content_type: 'product_group', content_ids: items.map((i) => i.id) },
  );
  postFP('view_menu');
}

export function trackViewItem(item: TrackItem) {
  emit(
    'view_item',
    { currency: CURRENCY, value: toValue(item.price_cents), items: ga4Items([item]) },
    'ViewContent',
    {
      currency: CURRENCY,
      value: toValue(item.price_cents),
      content_type: 'product',
      content_ids: [item.id],
    },
  );
  postFP('view_item', { value_cents: item.price_cents, payload: { item_id: item.id } });
}

export function trackAddToCart(item: TrackItem) {
  const qty = item.qty ?? 1;
  emit(
    'add_to_cart',
    { currency: CURRENCY, value: toValue(item.price_cents * qty), items: ga4Items([item]) },
    'AddToCart',
    {
      currency: CURRENCY,
      value: toValue(item.price_cents * qty),
      content_type: 'product',
      content_ids: [item.id],
      contents: metaContents([item]),
    },
  );
  postFP('add_to_cart', { value_cents: item.price_cents * qty, payload: { item_id: item.id, qty } });
}

export function trackBeginCheckout(items: TrackItem[]) {
  emit(
    'begin_checkout',
    { currency: CURRENCY, value: sumValue(items), items: ga4Items(items) },
    'InitiateCheckout',
    {
      currency: CURRENCY,
      value: sumValue(items),
      content_type: 'product',
      content_ids: items.map((i) => i.id),
      contents: metaContents(items),
      num_items: items.reduce((s, i) => s + (i.qty ?? 1), 0),
    },
  );
  postFP('begin_checkout', {
    value_cents: items.reduce((s, i) => s + i.price_cents * (i.qty ?? 1), 0),
  });
}

export function trackAddPaymentInfo(items: TrackItem[], method: string) {
  emit(
    'add_payment_info',
    { currency: CURRENCY, value: sumValue(items), payment_type: method, items: ga4Items(items) },
    'AddPaymentInfo',
    {
      currency: CURRENCY,
      value: sumValue(items),
      content_type: 'product',
      content_ids: items.map((i) => i.id),
    },
  );
  postFP('add_payment_info', {
    value_cents: items.reduce((s, i) => s + i.price_cents * (i.qty ?? 1), 0),
    payload: { method },
  });
}

export function trackLead() {
  emit('generate_lead', { currency: CURRENCY }, 'Lead', {});
  postFP('lead');
}

export function trackCouponApplied(code: string) {
  emit('select_promotion', { promotion_name: code }, null, {});
}

/**
 * trackPurchase — REGRA CRÍTICA (16.1): só deve ser chamado em /order-status
 * quando o pedido está paid/approved, com guard de idempotência no caller.
 * Ordem do push (16.3): ecommerce:null → GA4 → Google Ads → fbq.
 */
export interface PurchaseInput {
  orderId: string;
  totalCents: number;
  items?: TrackItem[];
}

export function trackPurchase({ orderId, totalCents, items = [] }: PurchaseInput) {
  const value = toValue(totalCents);
  const eventId = `purchase_${orderId}`;
  const ga4ItemsArr = items.length
    ? ga4Items(items)
    : [{ item_id: orderId, item_name: `Pedido ${orderId}`, price: value, quantity: 1 }];

  // (1) limpar contexto anterior
  pushDL({ ecommerce: null });
  // (2) GA4
  pushDL({
    event: 'purchase',
    ecommerce: { transaction_id: orderId, value, currency: CURRENCY, items: ga4ItemsArr },
  });
  if (gtagLoaded && window.gtag) {
    window.gtag('event', 'purchase', {
      transaction_id: orderId,
      value,
      currency: CURRENCY,
      items: ga4ItemsArr,
    });
  }
  // (3) Google Ads conversion
  if (gadsSendTo) {
    pushDL({ event: 'conversion', send_to: gadsSendTo, value, currency: CURRENCY, transaction_id: orderId });
    if (gtagLoaded && window.gtag) {
      window.gtag('event', 'conversion', {
        send_to: gadsSendTo,
        value,
        currency: CURRENCY,
        transaction_id: orderId,
      });
    }
  }
  // (4) Meta Pixel — com eventID para deduplicação com a CAPI (F4.5)
  postFP('purchase', { value_cents: totalCents, payload: { order_id: orderId } });
  if (fbqLoaded && window.fbq) {
    window.fbq(
      'track',
      'Purchase',
      {
        value,
        currency: CURRENCY,
        content_type: 'product',
        content_ids: items.length ? items.map((i) => i.id) : [orderId],
        contents: items.length ? metaContents(items) : [{ id: orderId, quantity: 1 }],
        num_items: items.reduce((s, i) => s + (i.qty ?? 1), 0) || 1,
      },
      { eventID: eventId },
    );
  }
}
