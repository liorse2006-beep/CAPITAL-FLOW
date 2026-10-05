var CACHE_NAME = 'vs-v6-public-assets';
// Only precache paths guaranteed to exist and stay stable across builds.
// Vite fingerprints every JS/CSS bundle with a content hash that changes on
// every build, so those can't be precached by name — they're picked up by
// the runtime cache-on-fetch handler below instead, the first time they're
// requested.
var STATIC_ASSETS = ['/', '/manifest.json', '/favicon.svg', '/icon-192.png', '/icon-512.png', '/default-avatar.svg'];
var PUBLIC_IMAGES = [
  '/home-logo.jpeg',
  '/logo-text.jpeg',
  '/logo-text-transparent.png',
  '/logo-gold.jpeg',
  '/capital-flow-guest-preview.png',
  '/capital-flow-phone-preview.png',
  '/og-image.png',
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      return cache.addAll(STATIC_ASSETS);
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches
      .keys()
      .then(function (names) {
        return Promise.all(
          names
            .filter(function (n) {
              return n.indexOf('vs-v') === 0 && n !== CACHE_NAME;
            })
            .map(function (n) {
              return caches.delete(n);
            })
        );
      })
      .then(function () {
        return clients.claim();
      })
  );
});

self.addEventListener('fetch', function (event) {
  if (event.request.method !== 'GET') return;
  var url = new URL(event.request.url);
  if (url.origin !== self.location.origin || event.request.headers.has('Authorization')) return;
  var shellPath = url.pathname.toLowerCase().replace(/\/+$/, '') || '/';
  var publicShell =
    [
      '/',
      '/scanner',
      '/ma',
      '/flow',
      '/watchlist',
      '/fundamentals',
      '/account',
      '/pricing',
      '/policy',
      '/accessibility',
    ].indexOf(shellPath) !== -1;
  var publicAsset =
    url.pathname.indexOf('/assets/') === 0 ||
    /^\/fonts\/[^/]+\.woff2$/.test(url.pathname) ||
    PUBLIC_IMAGES.indexOf(url.pathname) !== -1 ||
    STATIC_ASSETS.indexOf(url.pathname) !== -1;
  // Administrative, authentication, API and health responses are never
  // replayed from browser storage, even if an older worker cached them.
  if (!publicShell && !publicAsset) return;
  if (url.search && !publicShell) return;
  event.respondWith(
    fetch(event.request)
      .then(function (response) {
        var policy = (response && response.headers.get('Cache-Control')) || '';
        if (
          publicAsset &&
          !url.search &&
          response &&
          response.status === 200 &&
          !response.redirected &&
          !/no-store|private/i.test(policy)
        ) {
          var clone = response.clone();
          caches
            .open(CACHE_NAME)
            .then(function (cache) {
              return cache.put(event.request, clone);
            })
            .catch(function () {});
        }
        return response;
      })
      .catch(function () {
        return caches.open(CACHE_NAME).then(function (cache) {
          return cache.match(publicShell ? '/' : event.request);
        });
      })
  );
});

self.addEventListener('push', function (event) {
  var data = {};
  try {
    data = event.data.json();
  } catch (e) {
    data = {
      title: 'Market Signal Detected',
      body: event.data ? event.data.text() : 'Open the app to review the signal.',
    };
  }

  var title = data.title || 'Market Signal Detected';
  var options = {
    body: data.body || 'Open the app to review the signal.',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag: data.tag || 'volume-alert',
    // A retry replaces the same occurrence without requesting another alert.
    renotify: !/^capital-flow-notification-[1-9][0-9]*$/.test(data.tag || ''),
    requireInteraction: false,
    vibrate: [100, 50, 100],
    actions: [{ action: 'open', title: 'Open App' }],
    data: {
      url: appDestination(data.data && data.data.url),
    },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  var targetUrl = appDestination(event.notification.data && event.notification.data.url);

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async function (clientList) {
      for (var i = 0; i < clientList.length; i++) {
        var c = clientList[i];
        var current = new URL(c.url, self.location.origin);
        if (
          'focus' in c &&
          current.origin === self.location.origin &&
          !/^\/(admin|status)(\/|$)/i.test(current.pathname)
        ) {
          try {
            if (typeof c.navigate !== 'function') continue;
            var navigated = await c.navigate(targetUrl);
            if (navigated && typeof navigated.focus === 'function') return await navigated.focus();
          } catch (_) {}
        }
      }
      if (clients.openWindow) return clients.openWindow(targetUrl);
    })
  );
});

function appDestination(value) {
  if (typeof value !== 'string') return '/';
  try {
    var url = new URL(value, self.location.origin);
    if (url.origin !== self.location.origin || url.username || url.password || !/^https?:$/.test(url.protocol))
      return '/';
    return url.pathname + url.search + url.hash;
  } catch (_) {
    return '/';
  }
}
