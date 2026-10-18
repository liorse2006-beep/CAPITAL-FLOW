import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import worker from './scan-cache-worker.js';

const env = { JWT_SECRET: 'isolated-worker-secret', ORIGIN: 'https://origin.example' };
function request(path, id = 1, method = 'GET') {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const claims = Buffer.from(JSON.stringify({ id, sid: id, exp: Math.floor(Date.now() / 1000) + 60 })).toString(
    'base64url'
  );
  const signature = createHmac('sha256', env.JWT_SECRET).update(`${header}.${claims}`).digest('base64url');
  return new Request(`https://worker.example${path}`, {
    method,
    headers: { Authorization: `Bearer ${header}.${claims}.${signature}` },
  });
}

async function fixture(run, origin) {
  const entries = new Map();
  const pending = [];
  const calls = [];
  const savedFetch = globalThis.fetch;
  const savedCaches = globalThis.caches;
  let cacheReads = 0;
  globalThis.caches = {
    default: {
      async match(key) {
        cacheReads++;
        return entries.get(key.url)?.clone();
      },
      async put(key, value) {
        entries.set(key.url, value.clone());
      },
    },
  };
  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), options });
    return origin(String(url), options);
  };
  const send = async (path, id = 1, method = 'GET') => {
    const result = await worker.fetch(request(path, id, method), env, {
      waitUntil(promise) {
        pending.push(promise);
      },
    });
    await Promise.all(pending);
    return result;
  };
  try {
    await run({ send, entries, calls, cacheReads: () => cacheReads });
  } finally {
    globalThis.fetch = savedFetch;
    if (savedCaches === undefined) delete globalThis.caches;
    else globalThis.caches = savedCaches;
  }
}

function scan(options = {}) {
  return new Response(
    JSON.stringify({
      results: [{ ticker: 'TEST', price: 10 }],
      scanTime: '2026-10-18T10:00:00Z',
      tier: 'elite',
      scanId: 'private-job-owner-one',
      ...options.body,
    }),
    { headers: { 'Content-Type': 'application/json', ...options.headers }, status: options.status || 200 }
  );
}

test('private paths never read old shared entries or proxy customer data', async () => {
  await fixture(
    async ({ send, entries, calls, cacheReads }) => {
      for (const path of [
        '/api/account/export',
        '/api/account',
        '/api/notifications',
        '/api/progress',
        '/api/last-results',
        '/api/%73can',
        '/api/scan/',
        '/api/scan%2f..%2faccount/export',
      ]) {
        entries.set(
          `https://worker.example${path}?`,
          new Response(JSON.stringify({ account: { email: 'other-account@example.test' } }))
        );
        assert.equal((await send(path, 2)).status, 404);
      }
      assert.equal(cacheReads(), 0);
      assert.equal(calls.length, 0);
    },
    async () =>
      new Response(JSON.stringify({ account: { email: 'owner@example.test' } }), {
        headers: { 'Cache-Control': 'no-store' },
      })
  );
});

test('a victim export cannot be primed and subsequently returned to another customer', async () => {
  await fixture(
    async ({ send }) => {
      await send('/api/account/export', 1);
      const second = await send('/api/account/export', 2);
      const body = await second.json();
      assert.notEqual(body.account?.email, 'victim@example.test');
      assert.equal(second.status, 404);
    },
    async (url) =>
      new Response(
        JSON.stringify(
          url.endsWith('/api/scan-quota') ? { tier: 'elite' } : { account: { email: 'victim@example.test' } }
        ),
        { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } }
      )
  );
});

test('two identities share only market data, never the original scan job or quotas', async () => {
  await fixture(
    async ({ send, entries }) => {
      const first = await (await send('/api/scan?list=nasdaq100')).json();
      assert.equal(first.scanId, 'private-job-owner-one');
      assert.equal(entries.size, 1);
      const stored = await entries.values().next().value.clone().json();
      assert.equal(stored.scanId, undefined);
      assert.equal(stored.tier, undefined);
      assert.equal(stored.account, undefined);
      const second = await (await send('/api/scan?list=nasdaq100', 2)).json();
      assert.deepEqual(second.results, first.results);
      assert.equal(second.scanId, undefined);
      assert.equal(second.tier, 'premium');
      assert.deepEqual(second.premium, { left: 2 });
      assert.equal(second.fromCache, true);
    },
    async (url) =>
      url.endsWith('/api/scan-quota')
        ? new Response(JSON.stringify({ tier: 'premium', premium: { left: 2 } }))
        : scan({ body: { account: { id: 1 } } })
  );
});

test('scan no-store/private responses are preserved and never cached', async () => {
  for (const directive of ['no-store', 'private, max-age=60', 'NO-STORE']) {
    await fixture(
      async ({ send, entries, calls }) => {
        for (const id of [1, 2]) {
          const response = await send('/api/scan', id);
          assert.equal(response.headers.get('Cache-Control'), directive);
          assert.equal(response.headers.get('Set-Cookie'), null);
        }
        assert.equal(entries.size, 0);
        assert.equal(calls.length, 2);
      },
      async () => scan({ headers: { 'Cache-Control': directive } })
    );
  }
});

test('queued, malformed and non-JSON successes never enter the shared cache', async () => {
  for (const origin of [
    async () => scan({ body: { queued: true }, status: 202 }),
    async () =>
      new Response(JSON.stringify({ account: { id: 1 } }), { headers: { 'Content-Type': 'application/json' } }),
    async () => new Response('not json', { headers: { 'Content-Type': 'text/plain' } }),
    async () => scan({ headers: { 'Set-Cookie': 'private=synthetic' } }),
  ]) {
    await fixture(async ({ send, entries }) => {
      assert.equal((await send('/api/scan')).status >= 200, true);
      assert.equal(entries.size, 0);
    }, origin);
  }
});

test('old unversioned scan entries cannot leak old private fields', async () => {
  await fixture(
    async ({ send, entries }) => {
      entries.set('https://worker.example/api/scan?list=nasdaq100', scan({ body: { account: { id: 99 } } }));
      const result = await (await send('/api/scan?list=nasdaq100', 2)).json();
      assert.equal(result.account, undefined);
      assert.equal(result.tier, 'elite');
    },
    async () => scan()
  );
});

test('cached scans still fail closed for revoked sessions and exhausted quotas', async () => {
  for (const quota of [
    new Response('{}', { status: 401 }),
    new Response('{}', { status: 503 }),
    new Response(JSON.stringify({ tier: 'premium', premium: { left: 0 } })),
  ]) {
    await fixture(
      async ({ send }) => {
        await send('/api/scan');
        const response = await send('/api/scan', 2);
        assert.equal(response.status, 403);
        assert.equal((await response.json()).results, undefined);
      },
      async (url) => (url.endsWith('/api/scan-quota') ? quota.clone() : scan())
    );
  }
});

test('supported preflight works but unsupported methods do not forward credentials', async () => {
  await fixture(
    async ({ send, calls }) => {
      assert.equal((await send('/api/scan', 1, 'OPTIONS')).status, 204);
      assert.equal((await send('/api/scan', 1, 'POST')).status, 405);
      assert.equal(calls.length, 0);
    },
    async () => scan()
  );
});
