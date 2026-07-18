/* sw.js — kill switch: bersihkan cache lama & lepaskan diri */
self.addEventListener('install',e=>self.skipWaiting());
self.addEventListener('activate',e=>{
  e.waitUntil((async()=>{
    const keys=await caches.keys();
    await Promise.all(keys.map(k=>caches.delete(k)));
    await self.registration.unregister();
    const cs=await self.clients.matchAll();
    cs.forEach(c=>c.navigate(c.url)); /* muat ulang → pengalih tampil */
  })());
});