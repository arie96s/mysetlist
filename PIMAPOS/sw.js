/* ═══════════════════════════════════════════════════════════════════
   PIMAPOS — Service Worker (v3.2.0)
   Strategi: App Shell caching + network-first untuk HTML,
             cache-first untuk asset statis, stale-while-revalidate
             untuk font/CDN eksternal.
   BARU v3.2.0: CDN kritis (Chart.js, jsPDF, QR) di-precache saat
   install — grafik & PDF berfungsi offline sejak kunjungan pertama.
   ═══════════════════════════════════════════════════════════════════ */

const SW_VERSION   = '3.2.0';
const CACHE_STATIC = `pimapos-static-v${SW_VERSION}`;
const CACHE_RUNTIME = `pimapos-runtime-v${SW_VERSION}`;

/* ⚠️ SESUAIKAN dengan nama file HTML PIMAPOS di repo kamu
   (mis. './index.html' atau './PIMAPOS.html') */
const APP_HTML = './index.html';

const APP_SHELL = [
  './',
  APP_HTML,
  './manifest.json'
];

/* CDN kritis — dimuat PIMAPOS via <script defer>. Precache di install
   supaya tersedia offline SEBELUM pernah dipakai (fix: grafik laporan
   tidak tampil saat pertama kali offline). */
const CDN_PRECACHE = [
  'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.4/chart.umd.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js'
];

/* ── INSTALL: precache app shell + CDN kritis ────────────────────── */
self.addEventListener('install', (event) => {
  event.waitUntil(
    Promise.all([
      caches.open(CACHE_STATIC)
        .then((cache) => cache.addAll(APP_SHELL))
        .catch((err) => console.warn('[PIMAPOS SW] Precache shell gagal:', err)),
      /* allSettled: satu CDN gagal tidak membatalkan yang lain */
      caches.open(CACHE_RUNTIME).then((cache) =>
        Promise.allSettled(
          CDN_PRECACHE.map((url) =>
            cache.add(url).catch((err) => console.warn('[PIMAPOS SW] Precache CDN gagal:', url, err))
          )
        )
      )
    ]).then(() => self.skipWaiting())
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
          caches.match(request).then((cached) =>
            cached || caches.match(APP_HTML).then((shell) => shell || caches.match('./'))
          )
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
      const targetUrl = (event.notification.data && event.notification.data.url) || APP_HTML;
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
