// Regression for an API-call-reduction fix: getHistoricalVolumeContext used
// to re-fetch the same 6-month Yahoo chart on every single call with zero
// caching, even for the same symbol seconds apart. Only the raw quote
// series is now cached (24h, matching the sibling caches in scanner.js and
// maScanner.js) — the ratio-dependent spike computation still runs fresh
// every call, so two different ratios against the same cached quotes must
// still produce correct, independently-computed answers.
require('./helpers/testEnv');
const { test, before } = require('node:test');
const assert = require('node:assert');

const db = require('../server/db');
before(async () => { await db.ready; });

const yahoo = require('../server/services/yahoo');
const { getHistoricalVolumeContext } = require('../server/services/volumeContext');

// 40 daily bars: volume is flat at 1,000,000 except one clear spike (5M) on
// day 20, followed by a real price move — enough history (>10 prior days)
// for the ratio window and >5 bars after the spike for the "5 days later" check.
function buildQuotes() {
  const quotes = [];
  for (let i = 0; i < 40; i++) {
    const date = new Date(Date.now() - (40 - i) * 86400_000);
    const isSpike = i === 20;
    quotes.push({
      date,
      volume: isSpike ? 5_000_000 : 1_000_000,
      close: isSpike ? 100 : 100 + i * 0.01,
    });
  }
  // Price 5 bars after the spike is clearly higher, for a deterministic "up" move.
  quotes[25].close = 120;
  return quotes;
}

test('a second call for the same symbol within 24h reuses the cached chart instead of refetching', async (t) => {
  let chartCallCount = 0;
  t.mock.method(yahoo, 'chart', async () => {
    chartCallCount++;
    return { quotes: buildQuotes() };
  });

  const first = await getHistoricalVolumeContext('CACHESYM1', 5);
  const second = await getHistoricalVolumeContext('CACHESYM1', 5);

  assert.strictEqual(chartCallCount, 1, 'the second call must reuse the cached chart, not refetch');
  assert.ok(first, 'a real spike must be found');
  assert.deepStrictEqual(second, first, 'cached-path result must be identical to the fresh-fetch result');
});

test('different ratio arguments against the same cached quotes still produce independently correct answers', async (t) => {
  t.mock.method(yahoo, 'chart', async () => ({ quotes: buildQuotes() }));

  // A high current ratio (50x) sets a threshold (40x) no historical day
  // meets, so no spike should be found even though the cache is warm.
  const noMatch = await getHistoricalVolumeContext('CACHESYM2', 50);
  assert.strictEqual(noMatch, null, 'threshold above every historical ratio must find nothing');

  // A low current ratio (5x) sets a threshold (4x) the real 5x spike clears.
  const match = await getHistoricalVolumeContext('CACHESYM2', 5);
  assert.ok(match, 'a threshold the real spike clears must find it, even served from the same cache entry');
  assert.strictEqual(match.direction, 'up');
});

test('a chart fetch failure is not cached, so a later retry can still succeed', async (t) => {
  let attempt = 0;
  t.mock.method(yahoo, 'chart', async () => {
    attempt++;
    if (attempt === 1) throw new Error('Yahoo down');
    return { quotes: buildQuotes() };
  });

  const failed = await getHistoricalVolumeContext('CACHESYM3', 5);
  assert.strictEqual(failed, null);

  const retried = await getHistoricalVolumeContext('CACHESYM3', 5);
  assert.ok(retried, 'a failed fetch must not poison the cache — the retry must hit the network again and succeed');
  assert.strictEqual(attempt, 2);
});
