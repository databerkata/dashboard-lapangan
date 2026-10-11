/* LAPANGANKU SERVICE WORKER — varian single-file (2026-10-10).
   index.html sudah memuat seluruh CSS+JS inline, jadi precache hanya file yang ada.
   (Sebelumnya: precache daftar file multi-file yang sudah tidak ada -> install gagal.)
   Strategi (dipertahankan dari versi lama):
   - Navigasi (HTML): network-first dengan fallback cache.
   - Asset (ikon/gambar): cache-first.
   - API Apps Script: TIDAK pernah di-cache (data slot harus segar; respons bisa memuat PII).
   WHY vanilla: zero build, tanpa Workbox.
*/
var CACHE = 'lapanganku-single-v1';
var PRECACHE = [
  './',
  './index.html',
  './manifest.json',
  './icon.svg',
  './icons/favicon.svg',
  './icons/favicon-32.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return; // POST API: jangan disentuh
  // WHY VULN-003: API Apps Script SELALU langsung ke jaringan, tidak pernah di-cache.
  // Respons API bisa memuat PII (nama, email pelanggan) - men-cachenya membuat data tetap
  // bisa dibaca dari Cache Storage setelah logout, terutama di perangkat bersama.
  if (url.hostname === 'script.google.com' || url.hostname === 'www.google.com' || url.hostname === 'accounts.google.com') return;

  // Navigasi: network-first, fallback ke cache
  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request).then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put('./index.html', copy));
        return res;
      }).catch(() => caches.match('./index.html'))
    );
    return;
  }

  // Asset same-origin: cache-first
  if (url.origin === location.origin) {
    e.respondWith(
      caches.match(e.request).then(hit => hit || fetch(e.request).then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy));
        return res;
      }))
    );
  }
});

// Push notification handler
self.addEventListener('push', (event) => {
  // WHY (Batch A): event.data.json() melempar bila payload bukan JSON -> notifikasi gagal diam-diam.
  var data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) { data = {}; }
  const title = data.title || 'LapanganKu';
  const options = {
    body: data.body || 'Ada notifikasi baru dari LapanganKu.',
    icon: './icons/icon-192.png',
    badge: './icons/icon-192.png',
    data: { url: data.url || '/' }
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

// Notification click handler
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/';
  event.waitUntil(clients.openWindow(url));
});
