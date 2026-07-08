var CACHE_NAME = 'vs-v2';
var STATIC_ASSETS = ['/', '/index.html', '/styles.css', '/app.jsx', '/favicon.svg', '/manifest.json'];

self.addEventListener('install', function(event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function(cache) {
      return cache.addAll(STATIC_ASSETS);
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', function(event) {
  event.waitUntil(
    caches.keys().then(function(names) {
      return Promise.all(
        names.filter(function(n) { return n !== CACHE_NAME; }).map(function(n) { return caches.delete(n); })
      );
    }).then(function() { return clients.claim(); })
  );
});

self.addEventListener('fetch', function(event) {
  if (event.request.url.indexOf('/api/') !== -1) return;
  event.respondWith(
    fetch(event.request).then(function(response) {
      if (response && response.status === 200) {
        var clone = response.clone();
        caches.open(CACHE_NAME).then(function(cache) { cache.put(event.request, clone); });
      }
      return response;
    }).catch(function() {
      return caches.match(event.request);
    })
  );
});

self.addEventListener('push', function(event) {
  var data = {};
  try { data = event.data.json(); } catch(e) { data = { title: 'Capital Flow', body: event.data ? event.data.text() : 'New alert' }; }
  event.waitUntil(
    self.registration.showNotification(data.title || 'Capital Flow', {
      body: data.body || 'New stock alert',
      icon: '/favicon.svg',
      badge: '/favicon.svg',
      tag: 'volume-alert',
      renotify: true
    })
  );
});

self.addEventListener('notificationclick', function(event) {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(clientList) {
      for (var i = 0; i < clientList.length; i++) {
        if (clientList[i].url.indexOf('/') !== -1 && 'focus' in clientList[i]) {
          return clientList[i].focus();
        }
      }
      if (clients.openWindow) return clients.openWindow('/');
    })
  );
});
