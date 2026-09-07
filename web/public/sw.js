/* Loadwave push-notification service worker.
 *
 * Deliberately does not intercept fetches — the app stays network-first and
 * this worker only exists to receive push events and surface notifications.
 */
self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
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