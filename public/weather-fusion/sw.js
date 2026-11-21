const CACHE_NAME = 'weather-nourie-render-v4';
const STATIC_SHELL = [
  '/weather-fusion/manifest.webmanifest',
  '/weather-fusion/pwa-192x192.png',
  '/weather-fusion/pwa-512x512.png',
  '/weather-fusion/pwa-maskable-512x512.png',
  '/weather-fusion/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(STATIC_SHELL))
      .catch(() => undefined)
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // Never intercept or cache live API forecast/alert endpoints.
  if (url.pathname.startsWith('/api/')) return;

  // Always bypass HTTP cache for HTML, JS, and CSS so stale cached builds never flash on load.
  const isFreshAsset =
    request.mode === 'navigate' ||
    /\.(html|js|css)$/i.test(url.pathname) ||
    url.pathname.endsWith('/');
  const networkReq = isFreshAsset ? new Request(request, { cache: 'no-store' }) : request;

  event.respondWith(
    fetch(networkReq)
      .then((response) => {
        if (!isFreshAsset && response && response.status === 200 && response.type === 'basic') {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy)).catch(() => undefined);
        }
        return response;
      })
      .catch(async () => {
        const cached = await caches.match(request);
        if (cached) return cached;
        return Response.error();
      })
  );
});
