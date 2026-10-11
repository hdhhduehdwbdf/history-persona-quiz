const CACHE_NAME = 'hpq-v5';
const PRECACHE = [
  '/',
  '/pages/landing',
  '/pages/gender',
  '/pages/quiz',
  '/pages/report',
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

/* 后台重新校验：拉取最新版并写入缓存，失败时静默忽略 */
function revalidate(request) {
  return fetch(request).then((response) => {
    putSafely(request, response);
    return response;
  }).catch(() => null);
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

  /* 静态资源（js / css / 图片）：stale-while-revalidate
     先用缓存立即返回保证秒开与离线可用，同时在后台拉取最新版写回缓存，
     下次访问即为新版。这样只改 js/css、忘记升 CACHE_NAME 也不会让老用户长期停在旧代码上。 */
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(request);
    const fresh = revalidate(request);
    if (cached) {
      event.waitUntil(fresh);
      return cached;
    }
    const response = await fresh;
    return response || Response.error();
  })());
});
