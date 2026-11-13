/* StockRatio service worker – receives the daily push from GitHub Actions,
   checks portfolio/favourites/market on the device and shows notifications. */
importScripts('notify-core.js?v=__VERSION__');

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

const show = (notes) => SRNotify.display(self.registration, notes);

self.addEventListener('push', (event) => {
  event.waitUntil((async () => {
    let msg = {};
    try { msg = event.data ? event.data.json() : {}; } catch { msg = {}; }
    try {
      const res = await fetch(`data/stocks.json?t=${Date.now()}`, { cache: 'no-store' });
      const data = await res.json();
      const { notes } = await SRNotify.check(data, { type: msg.type || 'update', via: 'push' });
      if (notes.length) await show(notes);
    } catch (err) {
      if (msg.type === 'test' || msg.type === 'tradeday') {
        await show([{ kind: 'info', title: 'StockRatio', body: 'Daten konnten gerade nicht geladen werden – öffne die App für Details.', url: '' }]);
      }
    }
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const scope = self.registration.scope;
  const target = scope + ((event.notification.data && event.notification.data.url) || '');
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const w of wins) {
      if (w.url.startsWith(scope)) {
        w.postMessage({ sr: 'open', url: (event.notification.data && event.notification.data.url) || '' });
        await w.focus();
        return;
      }
    }
    await self.clients.openWindow(target);
  })());
});
