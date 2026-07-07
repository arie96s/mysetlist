/* ═══════════════════════════════════════════════════════════════════
   PIMAPIKA.ID — Service Worker
   Strategi: App Shell caching + network-first untuk HTML,
             cache-first untuk asset statis, stale-while-revalidate
             untuk font/CDN eksternal.
   ═══════════════════════════════════════════════════════════════════ */

const SW_VERSION   = '3.6.4';
const CACHE_STATIC = `pimapika-static-v${SW_VERSION}`;
const CACHE_RUNTIME = `pimapika-runtime-v${SW_VERSION}`;

/* Ganti 'index.html' jika nama file HTML utama kamu berbeda saat deploy */
const APP_SHELL = [
  './',
  './PIMAPIKA-Pro-v3_3_1.html',
  './manifest.json',
  './PMPK.webp'
];

/* ── INSTALL: precache app shell ─────────────────────────────────── */
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_STATIC)
      .then((cache) => cache.addAll(APP_SHELL))
      .catch((err) => console.warn('[PMPK SW] Precache gagal:', err))
      .then(() => self.skipWaiting())
  );
});

/* ── ACTIVATE: bersihkan cache versi lama ────────────────────────── */
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_STATIC && key !== CACHE_RUNTIME)
          .map((key) => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

/* ── FETCH: strategi berbeda per jenis request ───────────────────── */
self.addEventListener('fetch', (event) => {
  const { request } = event;

  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  const isSameOrigin = url.origin === self.location.origin;

  // Navigasi halaman (HTML) → network-first, fallback ke cache/app shell
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((res) => {
          const clone = res.clone();
          caches.open(CACHE_STATIC).then((cache) => cache.put(request, clone));
          return res;
        })
        .catch(() =>
          caches.match(request).then((cached) => cached || caches.match('./PIMAPIKA-Pro-v3_3_1.html'))
        )
    );
    return;
  }

  // Asset statis milik origin sendiri → cache-first
  if (isSameOrigin) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((res) => {
          if (res && res.status === 200) {
            const clone = res.clone();
            caches.open(CACHE_STATIC).then((cache) => cache.put(request, clone));
          }
          return res;
        }).catch(() => cached);
      })
    );
    return;
  }

  // Resource eksternal (font, CDN Chart.js/jsPDF, dll) → stale-while-revalidate
  event.respondWith(
    caches.open(CACHE_RUNTIME).then((cache) =>
      cache.match(request).then((cached) => {
        const fetchPromise = fetch(request)
          .then((res) => {
            if (res && res.status === 200) cache.put(request, res.clone());
            return res;
          })
          .catch(() => cached);
        return cached || fetchPromise;
      })
    )
  );
});

/* ── PESAN dari halaman (skipWaiting, ping) ──────────────────────── */
self.addEventListener('message', (event) => {
  const { type } = event.data || {};
  if (type === 'SKIP_WAITING') self.skipWaiting();
  if (type === 'PING') {
    event.source && event.source.postMessage({ type: 'PONG', version: SW_VERSION });
  }
});

/* ── PUSH NOTIFICATION click → fokus/buka tab & beri tahu app ────── */
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientsArr) => {
      const targetUrl = (event.notification.data && event.notification.data.url) || './index.html';
      for (const client of clientsArr) {
        if ('focus' in client) {
          client.postMessage({ type: 'NOTIF_CLICK' });
          return client.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(targetUrl);
    })
  );
});

/* ── PERIODIC BACKGROUND SYNC — pengecekan tagihan harian ────────── */
self.addEventListener('periodicsync', (event) => {
  if (event.tag === 'pmpk-daily-reminder') {
    event.waitUntil(
      self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientsArr) => {
        clientsArr.forEach((client) => client.postMessage({ type: 'BG_SYNC_BILL_CHECK' }));
      })
    );
  }
});

/* ── BACKGROUND SYNC (fallback) ──────────────────────────────────── */
self.addEventListener('sync', (event) => {
  if (event.tag === 'pmpk-bill-check') {
    event.waitUntil(
      self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientsArr) => {
        clientsArr.forEach((client) => client.postMessage({ type: 'BG_SYNC_BILL_CHECK' }));
      })
    );
  }
});
