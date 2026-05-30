const PRECACHE = 'mchg-precache-v1';
const RUNTIME = 'mchg-runtime-v1';
const RUNTIME_MAX_ENTRIES = 50;
const PRECACHE_URLS = [
  './',
  'index.html',
  'manifest.json',
  'styles.css',
  'app.js',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'data/scenes.json',
  'data/modeA-problems.json',
  'data/modeB-problems.json',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(PRECACHE).then(cache =>
      Promise.allSettled(
        PRECACHE_URLS.map(u =>
          cache.add(u).catch(err => console.warn('precache miss', u, err))
        )
      )
    )
  );
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  const allowlist = [PRECACHE, RUNTIME];
  e.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(k => !allowlist.includes(k)).map(k => caches.delete(k))
    ))
  );
  self.clients.claim();
});

async function trimCache(cacheName, maxEntries) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  if (keys.length > maxEntries) {
    await cache.delete(keys[0]);
    await trimCache(cacheName, maxEntries);
  }
}

// Decide whether a request should use stale-while-revalidate (HTML/JSON)
// vs pure cache-first (static assets like CSS/JS/images).
// HTML/JSON change between releases; SWR lets users get fresh content on the
// NEXT load without needing PRECACHE version bumps on every deploy.
function isStaleWhileRevalidate(request) {
  if (request.mode === 'navigate') return true;
  const url = new URL(request.url);
  if (url.pathname.endsWith('.html')) return true;
  if (url.pathname.endsWith('.json')) return true;
  const accept = request.headers.get('accept') || '';
  if (accept.includes('text/html')) return true;
  return false;
}

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;

  if (isStaleWhileRevalidate(e.request)) {
    // Stale-while-revalidate: serve cache immediately, refresh in background
    // so the NEXT load has fresh content even without a precache version bump.
    e.respondWith((async () => {
      const precache = await caches.open(PRECACHE);
      const runtime = await caches.open(RUNTIME);
      const cached = (await precache.match(e.request)) || (await runtime.match(e.request));
      const networkPromise = fetch(e.request).then(resp => {
        if (resp && resp.status === 200 && resp.type !== 'opaque') {
          // Keep refreshed copies in RUNTIME so PRECACHE stays as the
          // pinned offline baseline.
          runtime.put(e.request, resp.clone()).then(() =>
            trimCache(RUNTIME, RUNTIME_MAX_ENTRIES)
          );
        }
        return resp;
      }).catch(() => null);

      if (cached) {
        // Kick off the background refresh but don't block on it.
        e.waitUntil(networkPromise);
        return cached;
      }
      const resp = await networkPromise;
      if (resp) return resp;
      if (e.request.mode === 'navigate') {
        return (await caches.match('index.html')) ||
          new Response('', { status: 504, statusText: 'offline' });
      }
      return new Response('', { status: 504, statusText: 'offline' });
    })());
    return;
  }

  // Cache-first for static assets (CSS, JS, images, fonts).
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(resp => {
        if (!resp || resp.status !== 200 || resp.type === 'opaque') return resp;
        const clone = resp.clone();
        caches.open(RUNTIME).then(c =>
          c.put(e.request, clone).then(() => trimCache(RUNTIME, RUNTIME_MAX_ENTRIES))
        );
        return resp;
      }).catch(() => {
        if (e.request.mode === 'navigate') return caches.match('index.html');
        return caches.match(e.request, { ignoreSearch: true }).then(fallback => {
          return fallback || new Response('', { status: 504, statusText: 'offline' });
        });
      });
    })
  );
});
