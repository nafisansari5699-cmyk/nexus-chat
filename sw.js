/**
 * sw.js — service worker: offline app-shell caching + notification surface.
 *
 * Strategy:
 *   - App shell (html/css/js/icons): stale-while-revalidate from cache
 *   - /api/* and /uploads/*: network only (encrypted, always fresh)
 *   - WebSockets are untouched by service workers
 */
const VERSION = 'nexus-v1';
const SHELL = [
  './',
  'index.html',
  'style.css',
  'manifest.json',
  'js/config.js',
  'js/app.js',
  'js/auth.js',
  'js/utils.js',
  'js/encryption.js',
  'js/socketClient.js',
  'js/webrtc.js',
  'components/ChatWindow.js',
  'components/CallScreen.js',
  'assets/icon-192.png',
  'assets/icon-512.png',
  'assets/ringtone.mp3',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(VERSION).then((cache) => cache.addAll(SHELL).catch(() => {}))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/uploads/') || url.pathname.includes('socket.io')) {
    return; // network only
  }
  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then((cached) => {
      const fresh = fetch(e.request)
        .then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(VERSION).then((c) => c.put(e.request, copy));
          }
          return res;
        })
        .catch(() => cached || Response.error());
      return cached || fresh;
    })
  );
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: 'window' }).then((wins) => {
      if (wins.length) return wins[0].focus();
      return self.clients.openWindow('./');
    })
  );
});

self.addEventListener('message', (e) => {
  if (e.data === 'skip-waiting') self.skipWaiting();
});
