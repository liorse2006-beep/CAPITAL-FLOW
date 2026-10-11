const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../public/sw.js'), 'utf8');

function harness() {
  const listeners = {};
  const stored = [];
  const deleted = [];
  const matches = [];
  const context = {
    URL,
    self: {
      location: { origin: 'https://capitalflow.test' },
      addEventListener: (name, handler) => {
        listeners[name] = handler;
      },
      skipWaiting() {},
    },
    clients: { claim: async () => {} },
    caches: {
      open: async () => ({
        addAll: async () => {},
        put: async (request) => {
          stored.push(request.url);
        },
      }),
      keys: async () => ['vs-v5-brand-assets', 'vs-v6-private-pages-excluded'],
      delete: async (name) => {
        deleted.push(name);
      },
      match: async (request) => {
        matches.push(request.url);
        return 'cached-public-asset';
      },
    },
    fetch: async () => ({ status: 200, headers: { get: () => '' }, clone: () => ({}) }),
  };
  vm.runInNewContext(source, context);
  return { context, listeners, stored, deleted, matches };
}

test('private pages, APIs, mixed-case routes and external origins are never intercepted or replayed offline', () => {
  const { listeners, context, stored, matches } = harness();
  context.fetch = async () => {
    throw new Error('offline');
  };
  for (const path of [
    '/admin',
    '/ADMIN/',
    '/admin/api/users',
    '/status',
    '/STATUS/admin',
    '/api/auth/admin',
    '/api/auth/status',
    '/api',
    'https://external.test/page',
  ]) {
    let intercepted = false;
    listeners.fetch({
      request: { method: 'GET', url: path.startsWith('https:') ? path : `https://capitalflow.test${path}` },
      respondWith: () => {
        intercepted = true;
      },
    });
    assert.equal(intercepted, false, path);
  }
  assert.deepEqual(stored, []);
  assert.deepEqual(matches, []);
});

test('no-store and private responses are not cached, while public brand assets keep their offline fallback', async () => {
  const { listeners, context, stored, matches } = harness();
  async function request(path) {
    let response;
    listeners.fetch({
      request: { method: 'GET', url: `https://capitalflow.test${path}` },
      respondWith: (promise) => {
        response = promise;
      },
    });
    await response;
    await Promise.resolve();
  }
  for (const directive of ['no-store', 'private, max-age=30', 'Private']) {
    context.fetch = async () => ({ status: 200, headers: { get: () => directive }, clone: () => ({}) });
    await request('/sensitive-response');
  }
  assert.deepEqual(stored, []);
  context.fetch = async () => ({ status: 200, headers: { get: () => 'public, max-age=86400' }, clone: () => ({}) });
  await request('/icon-192.png');
  assert.deepEqual(stored, ['https://capitalflow.test/icon-192.png']);
  context.fetch = async () => {
    throw new Error('offline');
  };
  await request('/icon-192.png');
  assert.deepEqual(matches, ['https://capitalflow.test/icon-192.png']);
});

test('activation deletes the old cache containing any previously cached private HTML', async () => {
  const { listeners, deleted } = harness();
  let done;
  listeners.activate({
    waitUntil: (promise) => {
      done = promise;
    },
  });
  await done;
  assert.deepEqual(deleted, ['vs-v5-brand-assets']);
});
