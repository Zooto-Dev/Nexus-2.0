/* Nexus 2.0 phone app — service worker.
   Two jobs only: let the app be installed, and show the notification when a new task lands.
   It deliberately does not cache the app files: every build is loaded fresh, so nobody ever
   works on a stale screen. */
'use strict';
const NX_SW = 'nexus-sw-1';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
// a fetch handler is what makes the browser offer "Install app"; it only passes the request through
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== self.location.origin) return;
  e.respondWith(fetch(e.request).catch(() => caches.match(e.request).then(r => r || Response.error())));
});

self.addEventListener('push', e => {
  let p = {};
  try { p = e.data ? e.data.json() : {}; } catch (_e) { p = { body: e.data ? e.data.text() : '' }; }
  const body = String(p.body || '');
  const ack = p.ack ? String(p.ack) : '';
  // Android only makes a sound for a NEW notification. Re-using one tag replaces the old one quietly,
  // so each repeat gets its own tag and the one before it is closed first: it sounds every time,
  // and only one reminder is left sitting in the shade.
  const tag = String(p.tag || 'nexus') + (p.keep ? '-' + Date.now() : '');
  e.waitUntil((async () => {
    if (ack) {
      const old = await self.registration.getNotifications();
      old.forEach(n => { if (n.data && n.data.ack === ack) n.close(); });
    }
    await self.registration.showNotification(String(p.title || 'Nexus'), {
      body, tag, renotify: true, silent: false, icon: 'app-192.png', badge: 'app-badge.png',
      vibrate: [400, 150, 400, 150, 400, 150, 400],
      // a reminder stays on the screen until the person answers it
      requireInteraction: !!p.keep,
      actions: ack ? [{ action: 'stop', title: 'Stop reminding' }, { action: 'open', title: 'Open' }] : [],
      data: { url: String(p.url || 'app.html#/mytasks'), ack: ack }
    });
    // a page that is open rings properly, for as long as it takes
    if (ack) {
      const cl = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      cl.forEach(c => c.postMessage({ nx: 'ring', ack: ack, title: String(p.title || ''), body: body }));
    }
  })());
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const d = e.notification.data || {};
  // "Stop reminding" opens Nexus with the alarm named, and the app tells the server to let it rest
  const base = (e.action === 'stop' && d.ack) ? 'app.html?ack=' + encodeURIComponent(d.ack) + '#/mytasks' : (d.url || 'app.html#/mytasks');
  const url = new URL(base, self.location.href).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    for (const c of list) if (c.url.indexOf(self.registration.scope) === 0 && 'focus' in c) { c.navigate(url).catch(() => { }); return c.focus(); }
    return self.clients.openWindow(url);
  }));
});
// the browser may replace the keys on its own; the app re-subscribes on its next open
self.addEventListener('pushsubscriptionchange', () => { /* handled by the app on next open */ });
