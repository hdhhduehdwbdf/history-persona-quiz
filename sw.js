const CACHE_NAME = 'hpq-v4';
const PRECACHE = [
  '/',
  '/pages/landing',
  '/pages/gender',
  '/pages/quiz',
  '/pages/report',
  '/pages/result',
  '/pages/share',
  '/js/core.js',
  '/css/common.css',
  '/assets/favicon.svg',
  '/assets/icon-192.png',
  '/assets/icon-512.png',
  '/assets/og-cover.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await Promise.all(PRECACHE.map(async (url) => {
      try { await cache.add(new Request(url, { redirect: 'follow' })); } catch (e) {}
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

async function putSafely(request, response) {
  try {
    if (response && response.ok && response.type !== 'opaque' && !response.redirected) {
      const cache = await caches.open(CACHE_NAME);
      await cache.put(request, response.clone());
    }
  } catch (e) { /* 忽略缓存写入失败，不影响页面打开 */ }
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  let url;
  try { url = new URL(request.url); } catch (e) { return; }
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const response = await fetch(request);
        putSafely(request, response);
        return response;
      } catch (e) {
        const cache = await caches.open(CACHE_NAME);
        const fallback = (await cache.match(request))
          || (await cache.match('/pages/landing'))
          || (await cache.match('/'));
        return fallback || Response.error();
      }
    })());
    return;
  }

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(request);
    if (cached) return cached;
    try {
      const response = await fetch(request);
      putSafely(request, response);
      return response;
    } catch (e) {
      return Response.error();
    }
  })());
});