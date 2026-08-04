/* Meristem service worker.
 *
 * It exists for two reasons: Chrome requires one before it will treat the app
 * as installable (and only an installed app can appear in the Android share
 * sheet), and once it's here the app works with no network at all.
 *
 * The strategy is deliberately network-first for the page itself. A
 * cache-first worker is the classic way to ship an app that never updates —
 * you deploy, and everyone keeps running last week's build until they
 * happen to clear storage. Here the network always wins when it's reachable,
 * and the cache is only a fallback for being offline.
 */

const VERSION = 'meristem-v1';
const SHELL = ['./', './index.html', './manifest.json', './icon.svg', './icon-maskable.svg'];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(VERSION)
      .then(cache => cache.addAll(SHELL))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting())   // a failed pre-cache must not block install
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;   // fonts and anything else: leave alone

  // Navigations — including a share, which arrives as a GET with ?text=.
  // Always try the network so a deploy lands immediately; fall back to the
  // cached shell when offline. Never serve a cached copy that carries someone
  // else's query string.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then(res => {
          const copy = res.clone();
          caches.open(VERSION).then(c => c.put('./index.html', copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match('./index.html').then(hit => hit || Response.error()))
    );
    return;
  }

  // Everything else on our own origin: cache first, refresh in the background.
  event.respondWith(
    caches.match(req).then(hit => {
      const live = fetch(req).then(res => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(VERSION).then(c => c.put(req, copy)).catch(() => {});
        }
        return res;
      }).catch(() => hit);
      return hit || live;
    })
  );
});
