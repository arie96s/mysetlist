/**
 * PIMAPIKA Pro v3.3.1 — Service Worker
 * Strategy: Cache-first untuk asset statis, Network-first untuk data API
 * Offline fallback: tampilkan UI dari cache jika jaringan gagal
 */

const CACHE_NAME   = 'pimapika-v3.3.2';
const OFFLINE_URL  = './PIMAPIKA-Pro-v3_3_1.html';

// Asset yang di-pre-cache saat install
const PRECACHE_ASSETS = [
  './PIMAPIKA-Pro-v3_3_1.html',
  './manifest.json',
  './PMPK.webp',
  'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
  'https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/Tesseract.js/4.1.1/tesseract.min.js',
];

// ─── INSTALL: pre-cache aset utama ─────────────────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      // Buka satu per satu agar 1 CDN gagal tidak block semua
      return Promise.allSettled(
        PRECACHE_ASSETS.map(url =>
          cache.add(url).catch(e => console.warn('[SW] Precache skip:', url, e.message))
        )
      );
    }).then(() => self.skipWaiting())
  );
});

// ─── ACTIVATE: hapus cache versi lama ──────────────────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => {
          console.log('[SW] Deleting old cache:', k);
          return caches.delete(k);
        })
      )
    ).then(() => self.clients.claim())
  );
});

// ─── FETCH: strategi hybrid ─────────────────────────────────────────────────
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET dan chrome-extension
  if (request.method !== 'GET') return;
  if (url.protocol === 'chrome-extension:') return;

  // API calls (exchange rate, news, jina) → Network-first, no offline cache
  const isApiCall = [
    'open.er-api.com', 'api.exchangerate-api.com',
    'api.allorigins.win', 'corsproxy.io', 'api.codetabs.com',
    'r.jina.ai', 'news.google.com'
  ].some(h => url.hostname.includes(h));

  if (isApiCall) {
    // Network-only — jangan cache respons API (data berubah terus)
    event.respondWith(
      fetch(request).catch(() =>
        new Response(JSON.stringify({ error: 'offline' }), {
          headers: { 'Content-Type': 'application/json' }
        })
      )
    );
    return;
  }

  // Gambar lokal (logo, dll) → Cache-first, abaikan query string cache-busting.
  // BUG FIX v3.3.2: sebelumnya request gambar (mis. PMPK.webp?r=12345 dari retry
  // cache-busting di header/intro logo) jatuh ke cabang "HTML app utama" di bawah,
  // yang saat gagal/miss akan fallback ke OFFLINE_URL (file HTML!) sebagai response
  // gambar → <img> menerima HTML, gagal render → onerror lagi → logo flicker/hilang
  // berulang. Sekarang gambar lokal selalu cache-first & match tanpa query string.
  if (/\.(webp|png|jpe?g|gif|svg|ico)$/i.test(url.pathname) && url.origin === self.location.origin) {
    event.respondWith(
      caches.match(request, { ignoreSearch: true }).then(cached => {
        if (cached) return cached;
        return fetch(request).then(resp => {
          if (resp && resp.status === 200) {
            const clone = resp.clone();
            caches.open(CACHE_NAME).then(c => c.put(new Request(url.origin + url.pathname), clone));
          }
          return resp;
        }).catch(() => caches.match(request, { ignoreSearch: true }));
      })
    );
    return;
  }

  // Google Fonts & CDN → Cache-first
  if (url.hostname.includes('fonts.googleapis.com') ||
      url.hostname.includes('fonts.gstatic.com') ||
      url.hostname.includes('cdnjs.cloudflare.com') ||
      url.hostname.includes('cdn.jsdelivr.net')) {
    event.respondWith(
      caches.match(request).then(cached => {
        if (cached) return cached;
        return fetch(request).then(resp => {
          if (resp && resp.status === 200) {
            const clone = resp.clone();
            caches.open(CACHE_NAME).then(c => c.put(request, clone));
          }
          return resp;
        }).catch(() => new Response('', { status: 503 }));
      })
    );
    return;
  }

  // HTML app utama → Network-first dengan offline fallback ke cache
  event.respondWith(
    fetch(request).then(resp => {
      if (resp && resp.status === 200) {
        const clone = resp.clone();
        caches.open(CACHE_NAME).then(c => c.put(request, clone));
      }
      return resp;
    }).catch(() =>
      caches.match(request).then(cached =>
        cached || caches.match(OFFLINE_URL)
      )
    )
  );
});

// ─── SYNC: background sync untuk kirim data tertunda (future) ──────────────
self.addEventListener('sync', event => {
  if (event.tag === 'pmpk-sync') {
    console.log('[SW] Background sync triggered');
  }
});

console.log('[PMPK SW] v3.3.1 loaded');
