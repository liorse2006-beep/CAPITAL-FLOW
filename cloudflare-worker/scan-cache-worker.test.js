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

async function signedToken(secret) {
  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = base64url(JSON.stringify({ id: 7, sid: 11, exp: Math.floor(Date.now() / 1000) + 60 }));
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
