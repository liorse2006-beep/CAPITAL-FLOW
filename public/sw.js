var CACHE_NAME = 'vs-v3';
// Only precache paths guaranteed to exist and stay stable across builds.
// Vite fingerprints every JS/CSS bundle with a content hash that changes on
// every build, so those can't be precached by name — they're picked up by
// the runtime cache-on-fetch handler below instead, the first time they're
// requested. (An earlier version of this list named pre-Vite files —
// /styles.css, /app.jsx — that no longer exist; cache.addAll() rejects the
// whole install if even one URL 404s, which silently broke installation and
// therefore navigator.serviceWorker.ready, which push notifications rely
// on.)
var STATIC_ASSETS = ['/', '/favicon.svg', '/manifest.json'];

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
              return n !== CACHE_NAME;
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
  if (event.request.url.indexOf('/api/') !== -1) return;
  event.respondWith(
    fetch(event.request)
      .then(function (response) {
        if (response && response.status === 200) {
          var clone = response.clone();
          caches.open(CACHE_NAME).then(function (cache) {
            cache.put(event.request, clone);
          });
        }
        return response;
      })
      .catch(function () {
        return caches.match(event.request);
      })
  );
});

self.addEventListener('push', function (event) {
  var data = {};
  try {
    data = event.data.json();
  } catch (e) {
    data = { title: 'Capital Flow', body: event.data ? event.data.text() : 'New alert' };
  }
  event.waitUntil(
    self.registration.showNotification(data.title || 'Capital Flow', {
      body: data.body || 'New stock alert',
      icon: '/favicon.svg',
      badge: '/favicon.svg',
      tag: 'volume-alert',
      renotify: true,
    })
  );
});

self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (clientList) {
      for (var i = 0; i < clientList.length; i++) {
        if (clientList[i].url.indexOf('/') !== -1 && 'focus' in clientList[i]) {
          return clientList[i].focus();
        }
      }
      if (clients.openWindow) return clients.openWindow('/');
    })
  );
});
