/* StockRatio service worker – receives the daily push from GitHub Actions,
   checks portfolio/favourites/market on the device and shows notifications. */
importScripts('notify-core.js?v=__VERSION__');

const ICON = 'icons/icon-192.png';
const BADGE = 'icons/badge-96.png';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

async function show(notes) {
  // at most 4 separate notifications, the rest is summarised
  const list = notes.slice(0, 4);
  if (notes.length > 4) {
    list[3] = { title: `StockRatio: ${notes.length - 3} weitere Hinweise`, body: notes.slice(3).map((n) => n.title).join(' · '), url: '#m=pf' };
  }
  for (const n of list) {
    await self.registration.showNotification(n.title, {
      body: n.body,
      icon: ICON,
      badge: BADGE,
      tag: `sr-${n.kind || 'info'}-${n.sym || ''}`,
      renotify: true,
      data: { url: n.url || '' },
    });
  }
}

self.addEventListener('push', (event) => {
  event.waitUntil((async () => {
    let msg = {};
    try { msg = event.data ? event.data.json() : {}; } catch { msg = {}; }
    try {
      const res = await fetch(`data/stocks.json?t=${Date.now()}`, { cache: 'no-store' });
      const data = await res.json();
      const { notes } = await SRNotify.check(data, { type: msg.type || 'update' });
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
