/* ════════════════════════════════════════════════════
   PIMAPOS — Service Worker
   Fungsi utama: memungkinkan notifikasi pengingat BOD
   (Begin of Day) tampil sebagai notifikasi sistem lewat
   registration.showNotification(), bukan cuma alert di
   dalam tab. Tidak melakukan caching/offline apa pun agar
   tetap aman dipakai berdampingan dengan arsitektur
   single-file PWA PIMAPOS.

   CATATAN PENTING:
   Ini BUKAN push notification dari server (Web Push API
   butuh backend + VAPID key untuk benar-benar membangunkan
   notifikasi saat app/tab sepenuhnya tertutup). Service
   worker ini hanya memastikan notifikasi tetap bisa
   ditampilkan & diklik dengan baik selama browser/tab
   PIMAPOS pernah dibuka, dan registrasinya persisten lintas
   sesi (tidak perlu didaftarkan ulang tiap buka app).
════════════════════════════════════════════════════ */

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(self.clients.claim());
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if ('focus' in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow('./');
    })
  );
});
