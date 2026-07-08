// Regression tests for the Finnhub multi-account rotation pool: a single
// account's free-tier rate limit (60/min) must never take down enrichment
// data — the pool should round-robin across every configured account and
// skip any account currently cooling down from a 429.
require('./helpers/testEnv');
const { test } = require('node:test');
const assert = require('node:assert');

// The pool reads keys once at module load from config. node:test can share
// a worker (and therefore the require cache) across files, so force a fresh
// load of both config and the pool after setting known, fixed test keys —
// otherwise this test would silently pick up whatever real keys are in the
// project's actual .env from a previously-loaded test file.
// dotenv only fills in vars that are still unset, and would otherwise pull
// POOL_4 in from the project's real .env — pin it to a known duplicate too
// so the test's key count stays deterministic regardless of what's configured.
process.env.FINNHUB_API_KEY = 'key-a';
process.env.FINNHUB_API_KEY_POOL_1 = 'key-b';
process.env.FINNHUB_API_KEY_POOL_2 = 'key-c';
process.env.FINNHUB_API_KEY_POOL_3 = 'key-a'; // duplicate of the base key — must be deduped
process.env.FINNHUB_API_KEY_POOL_4 = 'key-a'; // also a duplicate — must be deduped

delete require.cache[require.resolve('../server/config')];
delete require.cache[require.resolve('../server/services/finnhubKeyPool')];
const pool = require('../server/services/finnhubKeyPool');

test('the pool deduplicates keys shared between FINNHUB_API_KEY and the pool slots', () => {
  assert.strictEqual(pool.poolSize(), 3, 'key-a should only be counted once despite appearing twice');
});

test('getKey round-robins across every configured account', () => {
  const seen = new Set();
  for (let i = 0; i < 6; i++) seen.add(pool.getKey());
  assert.strictEqual(seen.size, 3, 'all three distinct accounts should be used in rotation');
});

test('reportRateLimited takes a key out of rotation until it cools down', () => {
  const first = pool.getKey();
  pool.reportRateLimited(first);

  // The next several draws must never return the cooling-down key
  for (let i = 0; i < 5; i++) {
    assert.notStrictEqual(pool.getKey(), first, 'a rate-limited key must be skipped while cooling down');
  }
});
