/* global self, caches */
/*
 * Offline shell for the owner web app. Pages come from the network first, so a deploy is picked
 * up at once, and from the cache when the network is down. Hashed files under /app/ (scripts,
 * fonts, icons) come from the cache first because their names change with their content. API
 * calls are never cached: owner data comes from the server or the app's in-memory cache.
 */
const CACHE = 'vamar-app-shell-v2';
const SHELL = ['/app/', '/app/manifest.json', '/app/icons/icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))),
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;
  if (!url.pathname.startsWith('/app') && !url.pathname.startsWith('/fonts/')) return;

  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then((res) => {
          if (res.ok) void caches.open(CACHE).then((c) => c.put('/app/', res.clone()));
          return res;
        })
        .catch(() => caches.match('/app/').then((r) => r ?? Response.error())),
    );
    return;
  }
  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(event.request);
      if (cached) return cached;
      const res = await fetch(event.request);
      if (res.ok) void cache.put(event.request, res.clone());
      return res;
    }),
  );
});
