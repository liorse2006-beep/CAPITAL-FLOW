// hasQuotaRemaining is the one piece of business logic in the Worker that
// isn't exercisable inside Cloudflare's own runtime from this repo — tested
// in plain Node instead (this directory has its own package.json with
// "type": "module" so `export`/`import` work without touching the app's
// own CommonJS setup). Not run by the app's normal `npm test`/`vitest`
// suites; run directly with `node --test cloudflare-worker/*.test.js`.
import { test } from 'node:test';
import assert from 'node:assert';
import { hasQuotaRemaining } from './scan-cache-worker.js';

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
