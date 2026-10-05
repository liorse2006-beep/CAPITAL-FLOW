const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../public/sw.js'), 'utf8');
function harness(fetcher = async () => new Response('network')) {
  const handlers = {};
  const entries = new Map([['/', new Response('public offline shell')]]);
  const removed = [];
  const writes = [];
  const shown = [];
  const opened = [];
  const cache = {
    addAll: async () => {},
    put: async (request, response) => {
      writes.push(request);
      entries.set(typeof request === 'string' ? request : request.url, response);
    },
    match: async (request) => entries.get(typeof request === 'string' ? request : request.url)?.clone(),
  };
  const clients = {
    claim: async () => {},
    matchAll: async () => [],
    openWindow: async (url) => {
      opened.push(url);
    },
  };
  const context = vm.createContext({
    URL,
    Request,
    Response,
    clients,
    fetch: fetcher,
    caches: {
      open: async () => cache,
      keys: async () => ['vs-v5-brand-assets', 'vs-v6-public-assets', 'unrelated'],
      delete: async (name) => {
        removed.push(name);
      },
    },
    self: {
      location: { origin: 'https://capitalflow.test' },
      skipWaiting() {},
      addEventListener: (name, handler) => {
        handlers[name] = handler;
      },
      registration: {
        showNotification: async (title, options) => {
          shown.push({ title, options });
        },
      },
    },
  });
  vm.runInContext(source, context);
  return { handlers, writes, shown, opened, removed, clients, entries };
}
test('private, status, health, credentials and cross-origin requests never use browser cache', () => {
  const h = harness();
  for (const url of [
    '/admin',
    '/status/admin',
    '/health',
    '/status/internal/market-data',
    '/api/me',
    'https://other.test/assets/a.js',
  ]) {
    h.handlers.fetch({
      request: new Request(new URL(url, 'https://capitalflow.test')),
      respondWith() {
        assert.fail('must be network-only: ' + url);
      },
    });
  }
  h.handlers.fetch({
    request: new Request('https://capitalflow.test/assets/a.js', { headers: { Authorization: 'Bearer synthetic' } }),
    respondWith() {
      assert.fail('must not cache credentials');
    },
  });
});
test('no-store public asset responses are not persisted; live HTTP failures stay authoritative', async () => {
  const h = harness(async () => new Response('private', { headers: { 'Cache-Control': 'no-store' } }));
  let response;
  h.handlers.fetch({
    request: new Request('https://capitalflow.test/assets/a.js'),
    respondWith(promise) {
      response = promise;
    },
  });
  assert.equal(await (await response).text(), 'private');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(h.writes.length, 0);
  const denied = harness(async () => new Response('denied', { status: 401 }));
  denied.handlers.fetch({
    request: new Request('https://capitalflow.test/scanner'),
    respondWith(promise) {
      response = promise;
    },
  });
  assert.equal((await response).status, 401);
});
test('offline scan deep links only receive the public app shell and old owned caches are removed', async () => {
  const h = harness(async () => {
    throw new Error('offline');
  });
  let response;
  h.handlers.fetch({
    request: new Request('https://capitalflow.test/scanner?notif=srv-123'),
    respondWith(promise) {
      response = promise;
    },
  });
  assert.equal(await (await response).text(), 'public offline shell');
  let activation;
  h.handlers.activate({
    waitUntil(promise) {
      activation = promise;
    },
  });
  await activation;
  assert.deepEqual(h.removed, ['vs-v5-brand-assets']);
});
test('same occurrence retries do not request reannouncement and external click destinations are rejected', async () => {
  const h = harness();
  for (const tag of [
    'capital-flow-notification-123',
    'capital-flow-notification-123',
    'capital-flow-notification-124',
  ]) {
    let pending;
    h.handlers.push({
      data: { json: () => ({ title: 'test', tag, data: { url: 'https://evil.test/' } }) },
      waitUntil(promise) {
        pending = promise;
      },
    });
    await pending;
  }
  assert.equal(h.shown.length, 3);
  assert.ok(h.shown.every((notice) => notice.options.renotify === false && notice.options.data.url === '/'));
  for (const url of [
    'https://evil.test',
    '//evil.test',
    'javascript:alert(1)',
    'https://user:pass@capitalflow.test/',
    { bad: true },
  ]) {
    let pending;
    h.handlers.notificationclick({
      notification: { close() {}, data: { url } },
      waitUntil(promise) {
        pending = promise;
      },
    });
    await pending;
    assert.equal(h.opened.at(-1), '/');
  }
});
test('click keeps administrative windows intact and falls back after app navigation failure', async () => {
  const h = harness();
  let adminNavigated = false;
  h.clients.matchAll = async () => [
    {
      url: 'https://capitalflow.test/admin',
      focus() {},
      navigate() {
        adminNavigated = true;
      },
    },
    {
      url: 'https://capitalflow.test/scanner',
      focus() {},
      async navigate() {
        throw new Error('closed tab');
      },
    },
  ];
  let pending;
  h.handlers.notificationclick({
    notification: { close() {}, data: { url: '/scanner?notif=srv-12' } },
    waitUntil(promise) {
      pending = promise;
    },
  });
  await pending;
  assert.equal(adminNavigated, false);
  assert.deepEqual(h.opened, ['/scanner?notif=srv-12']);
});

test('all public deep links retain offline shell recovery, including trailing slashes', async () => {
  const h = harness(async () => {
    throw new Error('offline');
  });
  for (const path of ['/policy', '/accessibility', '/scanner/?notif=srv-123']) {
    let response;
    h.handlers.fetch({
      request: new Request('https://capitalflow.test' + path),
      respondWith(promise) {
        response = promise;
      },
    });
    assert.ok(response, 'must intercept public route: ' + path);
    assert.equal(await (await response).text(), 'public offline shell');
  }
});

test('known public fonts and images retain asset caching without admitting private-looking paths', async () => {
  const h = harness();
  for (const path of ['/fonts/switzer-400.woff2', '/home-logo.jpeg', '/capital-flow-guest-preview.png']) {
    let response;
    h.handlers.fetch({
      request: new Request('https://capitalflow.test' + path),
      respondWith(promise) {
        response = promise;
      },
    });
    assert.ok(response, 'must intercept asset: ' + path);
    assert.equal((await response).status, 200);
  }
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(h.writes.length, 3);
  for (const path of ['/admin/export.png', '/private.png', '/status/report.json']) {
    h.handlers.fetch({
      request: new Request('https://capitalflow.test' + path),
      respondWith() {
        assert.fail('must stay network-only');
      },
    });
  }
});

test('mixed-case operational windows are not repurposed for notification clicks', async () => {
  const h = harness();
  let navigated = false;
  h.clients.matchAll = async () =>
    ['/Admin', '/Status/Admin'].map((path) => ({
      url: 'https://capitalflow.test' + path,
      focus() {},
      navigate() {
        navigated = true;
      },
    }));
  let pending;
  h.handlers.notificationclick({
    notification: { close() {}, data: { url: '/scanner?notif=srv-12' } },
    waitUntil(promise) {
      pending = promise;
    },
  });
  await pending;
  assert.equal(navigated, false);
  assert.deepEqual(h.opened, ['/scanner?notif=srv-12']);
});

test('a rejected focus promise continues to another eligible app window', async () => {
  const h = harness();
  let secondFocused = false;
  h.clients.matchAll = async () => [
    {
      url: 'https://capitalflow.test/scanner',
      focus() {},
      async navigate() {
        return {
          async focus() {
            throw new Error('focus refused');
          },
        };
      },
    },
    {
      url: 'https://capitalflow.test/ma',
      focus() {},
      async navigate() {
        return {
          async focus() {
            secondFocused = true;
          },
        };
      },
    },
  ];
  let pending;
  h.handlers.notificationclick({
    notification: { close() {}, data: { url: '/scanner?notif=srv-12' } },
    waitUntil(promise) {
      pending = promise;
    },
  });
  await pending;
  assert.equal(secondFocused, true);
  assert.equal(h.opened.length, 0);
});
