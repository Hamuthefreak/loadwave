/* Loadwave service worker: push notifications + offline shell.
 *
 * Offline strategy (cab-friendly: tunnels and dead zones are normal):
 *   - App navigations: network-first, fall back to the last-seen page, then
 *     to the cached app shell — the app always opens.
 *   - Hashed static assets: cache-first (immutable by build).
 *   - API GETs (/api, /auth): network-first with cache fallback, so the last
 *     loads, trips and fuel records stay readable with no signal. Writes are
 *     never intercepted.
 */
const OFFLINE_CACHE = 'loadwave-offline-v1';
const SHELL_URL = '/';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(OFFLINE_CACHE)
      .then((cache) => cache.addAll([SHELL_URL, '/app/dashboard']))
      .catch(() => undefined)
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(names.filter((n) => n !== OFFLINE_CACHE).map((n) => caches.delete(n)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return; // writes always go straight to the network

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // fonts/CDN: leave to the browser cache

  // App navigations: online wins, offline shows the last cached page or shell.
  if (req.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(req);
          const cache = await caches.open(OFFLINE_CACHE);
          cache.put(req, fresh.clone()).catch(() => undefined);
          return fresh;
        } catch {
          const cached = (await caches.match(req)) || (await caches.match(SHELL_URL));
          return (
            cached ??
            new Response('<h1>Loadwave</h1><p>Offline — reconnect to load this page.</p>', {
              headers: { 'Content-Type': 'text/html' },
            })
          );
        }
      })(),
    );
    return;
  }

  // API reads: network-first, last response as the offline copy.
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/auth/')) {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(req);
          if (fresh.ok) {
            const cache = await caches.open(OFFLINE_CACHE);
            cache.put(req, fresh.clone()).catch(() => undefined);
          }
          return fresh;
        } catch {
          const cached = await caches.match(req);
          return (
            cached ??
            new Response(JSON.stringify({ error: 'OFFLINE', message: 'No connection — retry when you\u2019re back online.' }), {
              status: 503,
              headers: { 'Content-Type': 'application/json' },
            })
          );
        }
      })(),
    );
    return;
  }

  // Static assets: cache-first (Vite fingerprints them per build).
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      (async () => {
        const cached = await caches.match(req);
        if (cached) return cached;
        const fresh = await fetch(req);
        const cache = await caches.open(OFFLINE_CACHE);
        cache.put(req, fresh.clone()).catch(() => undefined);
        return fresh;
      })(),
    );
  }
});

self.addEventListener('push', (event) => {
  let title = 'Loadwave';
  let body = '';
  let url = '/app/dashboard';
  try {
    const data = event.data ? event.data.json() : {};
    if (typeof data.title === 'string' && data.title) title = data.title;
    if (typeof data.body === 'string' && data.body) body = data.body;
    if (typeof data.url === 'string' && data.url) url = data.url;
  } catch {
    /* malformed payload — fall back to defaults */
  }

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      tag: `loadwave-${url}`,
      renotify: false,
      data: { url },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/app/dashboard';
  event.waitUntil(
    (async () => {
      const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of clients) {
        if ('focus' in client) {
          await client.focus();
          if ('navigate' in client) client.navigate(url);
          return;
        }
      }
      await self.clients.openWindow(url);
    })(),
  );
});