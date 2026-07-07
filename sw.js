/* ════════════════════════════════════════════════════════
   PIMAPOS SERVICE WORKER
   Dua tugas:
   1) Offline-first app shell caching — supaya refresh/buka
      ulang PIMAPOS saat TIDAK ADA internet tetap berhasil
      (sebelumnya cuma bekerja kalau tab masih di memori).
   2) Menampilkan notifikasi sistem lokal (pengingat BOD),
      dipanggil dari halaman utama via self.registration.
   TIDAK ADA sinkronisasi ke server — PIMAPOS memang tanpa
   backend. "Cache" di sini murni salinan lokal file app.
════════════════════════════════════════════════════════ */

const CACHE_VERSION = 'pimapos-v1';
const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './PIMAPOS-logo.png',
];

// INSTALL — simpan app shell ke cache. Pakai addAll dengan
// fallback per-file supaya satu file gagal (mis. logo belum
// diupload) tidak menggagalkan instalasi SW secara keseluruhan.
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then(async (cache) => {
      await Promise.all(
        APP_SHELL.map((url) =>
          cache.add(url).catch((err) => {
            console.warn('[PIMAPOS SW] Lewati cache (tidak ditemukan):', url, err.message);
          })
        )
      );
      return self.skipWaiting();
    })
  );
});

// ACTIVATE — bersihkan cache versi lama supaya update app
// tidak menyisakan file basi selamanya.
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k !== CACHE_VERSION)
          .map((k) => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// FETCH — strategi "stale-while-revalidate": langsung sajikan
// dari cache kalau ada (cepat + jalan offline), sekaligus
// update cache di background kalau ada internet. Hanya untuk
// request GET dan hanya untuk origin sendiri (bukan CDN pihak
// ketiga — biar tidak menyimpan/mengunci versi lama Chart.js dkk).
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // biarkan CDN lewat jalur normal browser

  event.respondWith(
    caches.open(CACHE_VERSION).then(async (cache) => {
      const cached = await cache.match(req);
      const networkFetch = fetch(req)
        .then((res) => {
          if (res && res.status === 200) cache.put(req, res.clone());
          return res;
        })
        .catch(() => cached); // offline & tidak ada di cache -> biarkan gagal wajar
      return cached || networkFetch;
    })
  );
});

// PUSH-LIKE LOCAL NOTIFICATION — dipicu dari halaman utama
// (bukan push server sungguhan, karena PIMAPOS tanpa backend).
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SHOW_NOTIFICATION') {
    const { title, body, tag } = event.data.payload || {};
    self.registration.showNotification(title || 'PIMAPOS', {
      body: body || '',
      tag: tag || 'pimapos-reminder',
      icon: './PIMAPOS-logo.png',
      badge: './PIMAPOS-logo.png',
      renotify: true,
    });
  }
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window' }).then((clientsArr) => {
      const existing = clientsArr.find((c) => c.url.includes(self.location.origin));
      if (existing) return existing.focus();
      return self.clients.openWindow('./');
    })
  );
});
