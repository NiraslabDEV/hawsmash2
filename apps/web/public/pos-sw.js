/* global self, caches, fetch, Response */

const CACHE_VERSION = 'v1';
const POS_CACHE = `hawsmash-pos-${CACHE_VERSION}`;
const POS_PATH = '/pos';

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith('hawsmash-pos-') && key !== POS_CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

async function posNavigation(request) {
  const cache = await caches.open(POS_CACHE);
  try {
    const response = await fetch(request);
    if (response.ok && !response.redirected) await cache.put(request, response.clone());
    return response;
  } catch {
    return (
      (await cache.match(request)) ??
      (await cache.match(POS_PATH)) ??
      new Response('POS sem ligação. Liga este dispositivo uma vez antes de trabalhar offline.', {
        status: 503,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      })
    );
  }
}

async function staticAsset(request) {
  const cache = await caches.open(POS_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) await cache.put(request, response.clone());
  return response;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  const isPos = request.url.startsWith(`${self.location.origin}/pos`);
  if (request.mode === 'navigate' && isPos) {
    event.respondWith(posNavigation(request));
    return;
  }

  const isStatic =
    url.origin === self.location.origin &&
    (url.pathname.startsWith('/_next/static/') ||
      url.pathname === '/manifest.webmanifest' ||
      url.pathname.startsWith('/pos-icon-'));
  if (isStatic) event.respondWith(staticAsset(request));
});
