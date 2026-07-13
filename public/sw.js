var CACHE_NAME = 'vs-v4';
// Only precache paths guaranteed to exist and stay stable across builds.
// Vite fingerprints every JS/CSS bundle with a content hash that changes on
// every build, so those can't be precached by name — they're picked up by
// the runtime cache-on-fetch handler below instead, the first time they're
// requested.
var STATIC_ASSETS = ['/', '/favicon.svg', '/manifest.json', '/icon-192.png'];

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
            .filter(function (n) { return n !== CACHE_NAME; })
            .map(function (n) { return caches.delete(n); })
        );
      })
      .then(function () { return clients.claim(); })
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

  var title = data.title || 'Capital Flow';
  var options = {
    body: data.body || 'New stock alert',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag: data.tag || 'volume-alert',
    renotify: true,
    // Forward structured data so notificationclick can navigate
    data: {
      url: (data.data && data.data.url) || '/',
    },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  var targetUrl = (event.notification.data && event.notification.data.url) || '/';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (clientList) {
      // Focus existing tab if open
      for (var i = 0; i < clientList.length; i++) {
        var c = clientList[i];
        if ('focus' in c) {
          if (typeof c.navigate === 'function') c.navigate(targetUrl);
          return c.focus();
        }
      }
      // Otherwise open new window
      if (clients.openWindow) return clients.openWindow(targetUrl);
    })
  );
});
