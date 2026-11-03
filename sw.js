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
  e.waitUntil(self.registration.showNotification(String(p.title || 'Nexus'), {
    body, tag: String(p.tag || 'nexus'), renotify: true, silent: false, icon: 'app-192.png', badge: 'app-badge.png',
    vibrate: [120, 60, 120], requireInteraction: false, data: { url: String(p.url || 'app.html#/mytasks') }
  }));
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || 'app.html#/mytasks', self.location.href).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    for (const c of list) if (c.url.indexOf(self.registration.scope) === 0 && 'focus' in c) { c.navigate(url).catch(() => { }); return c.focus(); }
    return self.clients.openWindow(url);
  }));
});
// the browser may replace the keys on its own; the app re-subscribes on its next open
self.addEventListener('pushsubscriptionchange', () => { /* handled by the app on next open */ });
