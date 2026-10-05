// hasQuotaRemaining is the one piece of business logic in the Worker that
// isn't exercisable inside Cloudflare's own runtime from this repo — tested
// in plain Node instead (this directory has its own package.json with
// "type": "module" so `export`/`import` work without touching the app's
// own CommonJS setup). Not run by the app's normal `npm test`/`vitest`
// suites; run directly with `node --test cloudflare-worker/*.test.js`.
import { test } from 'node:test';
import assert from 'node:assert';
import worker, { hasQuotaRemaining } from './scan-cache-worker.js';

function base64url(value) {
  return Buffer.from(value).toString('base64url');
}

async function signedToken(secret, id = 7) {
  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = base64url(JSON.stringify({ id, sid: 11, exp: Math.floor(Date.now() / 1000) + 60 }));
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${header}.${payload}`));
  return `${header}.${payload}.${Buffer.from(signature).toString('base64url')}`;
}

test('elite is always allowed, regardless of premium/free fields', () => {
  assert.strictEqual(hasQuotaRemaining({ tier: 'elite', premium: null, free: null }), true);
});

test('premium is allowed while scans remain', () => {
  assert.strictEqual(hasQuotaRemaining({ tier: 'premium', premium: { left: 1 }, free: null }), true);
  assert.strictEqual(hasQuotaRemaining({ tier: 'premium', premium: { left: 5 }, free: null }), true);
});

test('premium is rejected once its daily scans are exhausted', () => {
  assert.strictEqual(hasQuotaRemaining({ tier: 'premium', premium: { left: 0 }, free: null }), false);
});

test('free is allowed only while the trial is active', () => {
  assert.strictEqual(hasQuotaRemaining({ tier: 'free', premium: null, free: { trialActive: true } }), true);
  assert.strictEqual(hasQuotaRemaining({ tier: 'free', premium: null, free: { trialActive: false } }), false);
});

test('a missing or malformed quota response fails closed, never open', () => {
  assert.strictEqual(hasQuotaRemaining(null), false);
  assert.strictEqual(hasQuotaRemaining(undefined), false);
  assert.strictEqual(hasQuotaRemaining({}), false);
  // A tier that claims to be premium but is missing its own premium block
  // (a malformed/tampered response) must not be read as "unlimited".
  assert.strictEqual(hasQuotaRemaining({ tier: 'premium', premium: null }), false);
});

test('the Worker fails closed when its required deployment variables are missing', async () => {
  const response = await worker.fetch(new Request('https://worker.example/api/scan'), {}, {});
  assert.strictEqual(response.status, 503);
  assert.deepStrictEqual(await response.json(), { error: 'Worker is not configured' });
});

test('malformed JWT input is rejected without throwing', async () => {
  const response = await worker.fetch(
    new Request('https://worker.example/api/scan', { headers: { Authorization: 'Bearer not-a-jwt' } }),
    { JWT_SECRET: 'test-secret', ORIGIN: 'https://origin.example' },
    {}
  );
  assert.strictEqual(response.status, 401);
  assert.deepStrictEqual(await response.json(), { error: 'Unauthorized' });
});

test('JWT algorithm confusion and incomplete identity claims are rejected at the edge', async () => {
  const header = btoa(JSON.stringify({ alg: 'none', typ: 'JWT' })).replace(/=/g, '');
  const payload = btoa(JSON.stringify({ id: 1, exp: Math.floor(Date.now() / 1000) + 60 })).replace(/=/g, '');
  const response = await worker.fetch(
    new Request('https://worker.example/api/scan', {
      headers: { Authorization: `Bearer ${header}.${payload}.ignored` },
    }),
    { JWT_SECRET: 'test-secret', ORIGIN: 'https://origin.example' },
    {}
  );
  assert.strictEqual(response.status, 401);
});

test('queued scans bypass the shared cache and preserve the origin job response', async () => {
  const secret = 'test-secret';
  const token = await signedToken(secret);
  const originalFetch = globalThis.fetch;
  let originRequest = null;
  globalThis.fetch = async (url, options) => {
    originRequest = { url, options };
    return new Response(JSON.stringify({ queued: true, scanId: 'job-123' }), {
      status: 202,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  try {
    const response = await worker.fetch(
      new Request('https://worker.example/api/scan?async=1&list=nasdaq100', {
        headers: { Authorization: `Bearer ${token}` },
      }),
      { JWT_SECRET: secret, ORIGIN: 'https://origin.example' },
      {}
    );
    assert.strictEqual(response.status, 202);
    assert.deepStrictEqual(await response.json(), { queued: true, scanId: 'job-123' });
    assert.strictEqual(originRequest.url, 'https://origin.example/api/scan?async=1&list=nasdaq100');
    assert.strictEqual(originRequest.options.headers.Authorization, `Bearer ${token}`);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

function edgeHarness(t, fetcher) {
  const oldFetch = globalThis.fetch;
  const oldCaches = globalThis.caches;
  const entries = new Map();
  const calls = [];
  const writes = [];
  const background = [];
  globalThis.fetch = async (input, options) => {
    calls.push({ input, options });
    return fetcher(input, options);
  };
  globalThis.caches = {
    default: {
      match: async (request) => entries.get(request.url)?.clone(),
      put: async (request, response) => {
        writes.push(request.url);
        entries.set(request.url, response);
      },
    },
  };
  t.after(() => {
    globalThis.fetch = oldFetch;
    globalThis.caches = oldCaches;
  });
  return {
    entries,
    calls,
    writes,
    ctx: { waitUntil: (promise) => background.push(promise) },
    flush: () => Promise.all(background),
  };
}

const edgeEnv = { JWT_SECRET: 'isolated-edge-test-secret', ORIGIN: 'https://origin.example' };
async function edgeRequest(path, userId = 7, options = {}) {
  return new Request('https://worker.example' + path, {
    ...options,
    headers: {
      Authorization: 'Bearer ' + (await signedToken(edgeEnv.JWT_SECRET, userId)),
      Origin: 'https://capitalflow.vip',
      ...options.headers,
    },
  });
}

test('shared hits keep market metadata but fetch each callers current quota without leaking origin identity', async (t) => {
  const h = edgeHarness(t, async (input, options) => {
    const url = typeof input === 'string' ? input : input.url;
    if (url.endsWith('/api/scan-quota')) {
      const token = options.headers.Authorization.slice(7);
      assert.equal(JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()).id, 8);
      return Response.json({ tier: 'premium', premium: { left: 2 }, free: null });
    }
    return Response.json({
      results: [{ symbol: 'NVDA' }],
      marketClosed: true,
      cacheAge: 123,
      tickersScanned: 42,
      dataStatus: 'partial',
      dataAsOf: '2026-01-01T00:00:00Z',
      tier: 'elite',
      premium: null,
      userId: 7,
      scanId: 'owner-job',
      unknownPrivateField: 'private',
    });
  });
  const first = await worker.fetch(await edgeRequest('/api/scan?list=sp500'), edgeEnv, h.ctx);
  assert.equal((await first.json()).tier, 'elite');
  await h.flush();
  const stored = await h.entries.values().next().value.clone().json();
  for (const key of ['tier', 'premium', 'userId', 'scanId', 'unknownPrivateField'])
    assert.equal(Object.hasOwn(stored, key), false);
  const second = await worker.fetch(await edgeRequest('/api/scan?list=sp500', 8), edgeEnv, h.ctx);
  const body = await second.json();
  assert.equal(body.tier, 'premium');
  assert.equal(body.premium.left, 2);
  assert.equal(body.marketClosed, true);
  assert.equal(body.cacheAge, 123);
  assert.equal(body.tickersScanned, 42);
  assert.equal(body.dataStatus, 'partial');
  assert.equal(body.fromCache, true);
  assert.equal(Object.hasOwn(body, 'scanId'), false);
  assert.equal(Object.hasOwn(body, 'userId'), false);
  assert.equal(h.writes.length, 1);
  assert.equal(h.calls.length, 2);
});

test('a warmed shared response cannot bypass a revoked session or an exhausted account', async (t) => {
  let allowed = true;
  const h = edgeHarness(t, async (input) => {
    if (String(input).endsWith('/api/scan-quota'))
      return allowed
        ? new Response('revoked', { status: 401 })
        : Response.json({ tier: 'premium', premium: { left: 0 } });
    return Response.json({ results: [{ symbol: 'NVDA' }], tier: 'elite' });
  });
  await worker.fetch(await edgeRequest('/api/scan'), edgeEnv, h.ctx);
  await h.flush();
  let response = await worker.fetch(await edgeRequest('/api/scan', 8), edgeEnv, h.ctx);
  assert.equal(response.status, 403);
  assert.equal(Object.hasOwn(await response.json(), 'results'), false);
  allowed = false;
  response = await worker.fetch(await edgeRequest('/api/scan', 8), edgeEnv, h.ctx);
  assert.equal(response.status, 403);
  assert.equal((await response.json()).premium.left, 0);
});

test('private routes, methods, below-floor scans and ambiguous query shapes always reach the configured origin uncached', async (t) => {
  const h = edgeHarness(t, async (input) => {
    assert.ok(input instanceof Request);
    assert.equal(new URL(input.url).origin, edgeEnv.ORIGIN);
    assert.ok(input.headers.has('Authorization'));
    return Response.json({ private: true });
  });
  const paths = [
    '/api/watchlist',
    '/api/notifications',
    '/api/scan-result?scanId=mine',
    '/api/scan?minVolumeRatio=1',
    '/api/scan?minMarketCap=10',
    '/api/scan?minMarketCap=NaN',
    '/api/scan?list=sp500&list=nasdaq100',
    '/api/scan?custom=secret',
    '/api/scan/',
  ];
  for (const path of paths) {
    const response = await worker.fetch(await edgeRequest(path), edgeEnv, h.ctx);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
  }
  await worker.fetch(await edgeRequest('/api/scan', 7, { method: 'POST', body: '{}' }), edgeEnv, h.ctx);
  assert.equal(h.writes.length, 0);
  assert.equal(h.calls.length, paths.length + 1);
});

test('unexpected queued or malformed origin result envelopes never populate the shared cache', async (t) => {
  let status = 202;
  let body = { queued: true, scanId: 'owner-job' };
  const h = edgeHarness(t, async () => Response.json(body, { status }));
  let response = await worker.fetch(await edgeRequest('/api/scan'), edgeEnv, h.ctx);
  assert.equal(response.status, 202);
  assert.equal((await response.json()).scanId, 'owner-job');
  status = 200;
  body = { results: null, scanId: 'owner-job' };
  response = await worker.fetch(await edgeRequest('/api/scan'), edgeEnv, h.ctx);
  assert.equal((await response.json()).results, null);
  await h.flush();
  assert.equal(h.writes.length, 0);
});
