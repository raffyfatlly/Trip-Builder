// The service worker for an installed trip.
//
// Two jobs, and deliberately no more: make the trip installable at all (a
// worker with a fetch handler is the browser's requirement), and make it open
// when there is no signal — which is the whole point of having it on a phone in
// another country.
//
// Cache-first for the trip itself, network-first for nothing. A built trip does
// not change unless it is rebuilt, and a traveller standing in an airport wants
// the copy they already have, immediately.

const CACHE = 'trip-v1';

self.addEventListener('install', (e) => {
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  // Only the trip page and its manifest. Everything else — the chat, the API —
  // is live by nature and must never be served stale.
  if (!/^\/t\//.test(url.pathname) && url.pathname !== '/api/manifest') return;

  e.respondWith((async () => {
    const hit = await caches.match(req);
    if (hit) {
      // Refresh in the background so the next open is current, without making
      // this one wait for a network that may not be there.
      e.waitUntil((async () => {
        try {
          const fresh = await fetch(req);
          if (fresh && fresh.ok) (await caches.open(CACHE)).put(req, fresh.clone());
        } catch (err) { /* offline is the case this exists for */ }
      })());
      return hit;
    }
    try {
      const fresh = await fetch(req);
      if (fresh && fresh.ok) (await caches.open(CACHE)).put(req, fresh.clone());
      return fresh;
    } catch (err) {
      const any = await caches.match(url.pathname);
      if (any) return any;
      throw err;
    }
  })());
});
