/* Offline support.
   - The app shell (HTML, CSS, JS, icons) is served from cache and refreshed in
     the background, so the app opens instantly and updates on the next visit.
   - Event data is fetched from the network first and falls back to the last
     copy, so the app still shows something on the Tube. */

const CACHE = 'after-lectures-v1';
const SHELL = [
  './', 'index.html', 'styles.css', 'app.js', 'manifest.webmanifest',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;

  if (url.pathname.endsWith('/data/events.json')) {
    event.respondWith(
      fetch(request)
        .then((res) => {
          if (res.ok) caches.open(CACHE).then((cache) => cache.put('data/events.json', res.clone()));
          return res;
        })
        .catch(() => caches.match('data/events.json').then((hit) => hit || Response.error())),
    );
    return;
  }

  // Page loads: answer with the cached app shell (the hash route does the rest).
  const key = request.mode === 'navigate' ? 'index.html' : request;
  event.respondWith(
    caches.match(key).then((cached) => {
      const fresh = fetch(request)
        .then((res) => {
          if (res.ok && request.mode !== 'navigate') caches.open(CACHE).then((cache) => cache.put(request, res.clone()));
          return res;
        })
        .catch(() => cached);
      return cached || fresh;
    }),
  );
});
