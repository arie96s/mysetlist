// ╔══════════════════════════════════════════════════════════════╗
// ║  PIMAPIKA Pro — Service Worker v3.4.0                       ║
// ║  Android Chrome · Samsung Internet · Edge Mobile            ║
// ║  Notification API · Push API · Background Sync              ║
// ║  FCM-ready architecture                                     ║
// ╚══════════════════════════════════════════════════════════════╝

'use strict';

const SW_VERSION   = '3.4.0';
const CACHE_NAME   = `pimapika-v${SW_VERSION}`;
const OFFLINE_URL  = './';

// ─── Assets to pre-cache ───────────────────────────────────────
const PRECACHE_ASSETS = [
  './',
  './PMPK.webp',
  // Tambahkan aset statis lain jika diperlukan
];

// ─── INSTALL ──────────────────────────────────────────────────
self.addEventListener('install', event => {
  console.log(`[PMPK SW ${SW_VERSION}] Installing…`);
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(PRECACHE_ASSETS.map(u => new Request(u, { cache: 'reload' }))))
      .then(() => {
        console.log(`[PMPK SW] Pre-cache done`);
        return self.skipWaiting(); // Activate immediately
      })
      .catch(err => console.warn('[PMPK SW] Pre-cache partial failure:', err))
  );
});

// ─── ACTIVATE ─────────────────────────────────────────────────
self.addEventListener('activate', event => {
  console.log(`[PMPK SW ${SW_VERSION}] Activating…`);
  event.waitUntil(
    Promise.all([
      // Hapus cache versi lama
      caches.keys().then(keys =>
        Promise.all(
          keys
            .filter(key => key.startsWith('pimapika-') && key !== CACHE_NAME)
            .map(key => {
              console.log(`[PMPK SW] Deleting old cache: ${key}`);
              return caches.delete(key);
            })
        )
      ),
      // Ambil alih semua client tanpa reload
      self.clients.claim()
    ])
  );
});

// ─── FETCH — Cache-first untuk aset, Network-first untuk API ──
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET dan cross-origin (kecuali CDN tertentu)
  if (request.method !== 'GET') return;
  if (url.origin !== self.location.origin &&
      !url.hostname.endsWith('cdnjs.cloudflare.com') &&
      !url.hostname.endsWith('fonts.googleapis.com') &&
      !url.hostname.endsWith('fonts.gstatic.com')) return;

  // Network-first untuk navigasi utama (biar selalu fresh)
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then(res => {
          if (res.ok) {
            const clone = res.clone();
            caches.open(CACHE_NAME).then(c => c.put(request, clone));
          }
          return res;
        })
        .catch(() => caches.match(request).then(cached => cached || caches.match(OFFLINE_URL)))
    );
    return;
  }

  // Cache-first untuk aset statis (.webp, font, icon)
  if (/\.(webp|png|jpg|jpeg|svg|ico|woff2?|ttf)$/.test(url.pathname)) {
    event.respondWith(
      caches.match(request).then(cached => {
        if (cached) return cached;
        return fetch(request).then(res => {
          if (res.ok) {
            const clone = res.clone();
            caches.open(CACHE_NAME).then(c => c.put(request, clone));
          }
          return res;
        }).catch(() => cached);
      })
    );
    return;
  }
});

// ─── PUSH (FCM-ready) ─────────────────────────────────────────
self.addEventListener('push', event => {
  let data = { title: '🔔 PIMAPIKA', body: 'Ada pengingat tagihan baru.', tag: 'pimpk-push' };
  try {
    if (event.data) {
      const parsed = event.data.json();
      data = { ...data, ...parsed };
    }
  } catch (e) {
    if (event.data) data.body = event.data.text();
  }

  const options = {
    body      : data.body,
    icon      : data.icon  || './PMPK.webp',
    badge     : data.badge || './PMPK.webp',
    tag       : data.tag   || 'pmpk-push',
    vibrate   : [200, 100, 200, 100, 200],
    requireInteraction: false,
    data      : { url: data.url || self.location.origin, timestamp: Date.now() },
    actions   : [
      { action: 'open',    title: '📂 Buka Tagihan' },
      { action: 'dismiss', title: '✕ Tutup'         }
    ]
  };

  event.waitUntil(
    self.registration.showNotification(data.title, options)
  );
});

// ─── NOTIFICATION CLICK ───────────────────────────────────────
self.addEventListener('notificationclick', event => {
  event.notification.close();

  if (event.action === 'dismiss') return;

  const targetUrl = (event.notification.data && event.notification.data.url)
    ? event.notification.data.url
    : self.location.origin;

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then(windowClients => {
        // Fokus tab yang sudah terbuka jika ada
        for (const client of windowClients) {
          if (client.url === targetUrl && 'focus' in client) {
            client.postMessage({ type: 'NOTIF_CLICK', action: 'openTagihan' });
            return client.focus();
          }
        }
        // Buka tab baru
        if (clients.openWindow) return clients.openWindow(targetUrl);
      })
  );
});

// ─── NOTIFICATION CLOSE ───────────────────────────────────────
self.addEventListener('notificationclose', event => {
  // Analytics hook (optional)
  console.log('[PMPK SW] Notification closed:', event.notification.tag);
});

// ─── BACKGROUND SYNC ──────────────────────────────────────────
self.addEventListener('sync', event => {
  if (event.tag === 'pmpk-bill-check') {
    event.waitUntil(_backgroundBillCheck());
  }
});

async function _backgroundBillCheck() {
  // Background sync: kirim notifikasi tagihan mendatang jika ada
  // Data dibaca dari IndexedDB / message dari client (arsitektur ringan)
  const windowClients = await clients.matchAll({ type: 'window' });
  for (const client of windowClients) {
    client.postMessage({ type: 'BG_SYNC_BILL_CHECK' });
  }
}

// ─── MESSAGE (komunikasi 2-arah dengan halaman) ───────────────
self.addEventListener('message', event => {
  const { type, payload } = event.data || {};

  switch (type) {
    // Halaman meminta SW untuk menampilkan notifikasi
    case 'SHOW_NOTIFICATION': {
      const { title, body, tag, billId } = payload || {};
      if (!title) break;
      self.registration.showNotification(title, {
        body      : body || '',
        icon      : './PMPK.webp',
        badge     : './PMPK.webp',
        tag       : tag  || `pmpk-bill-${billId || Date.now()}`,
        vibrate   : [200, 100, 200],
        data      : { url: self.location.origin, billId }
      });
      break;
    }

    // Skip waiting — halaman meminta aktifkan SW baru segera
    case 'SKIP_WAITING': {
      self.skipWaiting();
      break;
    }

    // Ping — health check dari halaman
    case 'PING': {
      event.source && event.source.postMessage({ type: 'PONG', version: SW_VERSION });
      break;
    }

    default:
      break;
  }
});

// ─── PERIODIC BACKGROUND SYNC (Chrome 80+ Android) ───────────
self.addEventListener('periodicsync', event => {
  if (event.tag === 'pmpk-daily-reminder') {
    event.waitUntil(_backgroundBillCheck());
  }
});

console.log(`[PMPK SW ${SW_VERSION}] Script parsed OK`);
