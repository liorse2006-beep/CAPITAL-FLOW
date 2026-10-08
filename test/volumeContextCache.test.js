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
const express = require('express');
const { issueToken } = require('../server/services/auth');

const db = require('../server/db');
before(async () => {
  await db.ready;
});

const yahoo = require('../server/services/yahoo');
const { getHistoricalVolumeContext, getHistoricalVolumeContextResult } = require('../server/services/volumeContext');
const { latestCompletedSessionDate, previousTradingDateKey } = require('../server/services/marketCalendar');

// 40 daily bars: volume is flat at 1,000,000 except one clear spike (5M) on
// day 20, followed by a real price move — enough history (>10 prior days)
// for the ratio window and >5 bars after the spike for the "5 days later" check.
function buildQuotes() {
  const quotes = [];
  const sessions = [latestCompletedSessionDate()];
  while (sessions.length < 40) sessions.unshift(previousTradingDateKey(sessions[0]));
  for (let i = 0; i < 40; i++) {
    const date = new Date(sessions[i] + 'T15:00:00.000Z');
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

function buildChart(symbol) {
  return { meta: { symbol, currency: 'USD' }, quotes: buildQuotes() };
}

test('a second call for the same symbol within 24h reuses the cached chart instead of refetching', async (t) => {
  let chartCallCount = 0;
  t.mock.method(yahoo, 'chart', async (symbol) => {
    chartCallCount++;
    return buildChart(symbol);
  });

  const first = await getHistoricalVolumeContext('CACHESYM1', 5);
  const second = await getHistoricalVolumeContext('CACHESYM1', 5);

  assert.strictEqual(chartCallCount, 1, 'the second call must reuse the cached chart, not refetch');
  assert.ok(first, 'a real spike must be found');
  assert.deepStrictEqual(second, first, 'cached-path result must be identical to the fresh-fetch result');
});

test('different ratio arguments against the same cached quotes still produce independently correct answers', async (t) => {
  t.mock.method(yahoo, 'chart', async (symbol) => buildChart(symbol));

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
  t.mock.method(yahoo, 'chart', async (symbol) => {
    attempt++;
    if (attempt === 1) throw new Error('Yahoo down');
    return buildChart(symbol);
  });

  const failed = await getHistoricalVolumeContext('CACHESYM3', 5);
  assert.strictEqual(failed, null);

  const retried = await getHistoricalVolumeContext('CACHESYM3', 5);
  assert.ok(retried, 'a failed fetch must not poison the cache — the retry must hit the network again and succeed');
  assert.strictEqual(attempt, 2);
});

for (const [label, alter] of [
  [
    'wrong-symbol',
    (chart) => {
      chart.meta.symbol = 'OTHER';
    },
  ],
  [
    'missing-symbol',
    (chart) => {
      delete chart.meta.symbol;
    },
  ],
  [
    'wrong-currency',
    (chart) => {
      chart.meta.currency = 'EUR';
    },
  ],
  [
    'invalid-date',
    (chart) => {
      chart.quotes[4].date = 'invalid';
    },
  ],
  [
    'future-date',
    (chart) => {
      chart.quotes[4].date = new Date(Date.now() + 86400000);
    },
  ],
  [
    'duplicate-session',
    (chart) => {
      chart.quotes[4].date = chart.quotes[5].date;
    },
  ],
  [
    'missing-trading-session',
    (chart) => {
      chart.quotes.splice(22, 1);
    },
  ],
  [
    'boolean-volume',
    (chart) => {
      chart.quotes[4].volume = true;
    },
  ],
  [
    'overflow-volume',
    (chart) => {
      chart.quotes.forEach((bar) => {
        bar.volume = 1e308;
      });
    },
  ],
]) {
  test(`historical context rejects ${label} instead of displaying a verified five-session move`, async (t) => {
    const symbol = 'V' + label;
    t.mock.method(yahoo, 'chart', async () => {
      const chart = buildChart(symbol);
      alter(chart);
      return chart;
    });
    assert.equal(await getHistoricalVolumeContext(symbol, 5), null);
  });
}

test('strict decimal strings are converted before volume sums and produce the same verified calculation', async (t) => {
  t.mock.method(yahoo, 'chart', async () => {
    const chart = buildChart('NUMERIC');
    chart.quotes.forEach((bar) => {
      bar.volume = String(bar.volume);
      bar.close = String(bar.close);
    });
    return chart;
  });
  const result = await getHistoricalVolumeContext('NUMERIC', 5);
  assert.ok(result);
  assert.equal(result.lastSpikeRatio, 5);
  assert.equal(result.movePercent, 20);
});

test('a provider outage is unavailable, while a verified empty comparison is complete', async (t) => {
  t.mock.method(yahoo, 'chart', async (symbol) => {
    if (symbol === 'DOWN') throw new Error('synthetic provider outage');
    return buildChart(symbol);
  });
  assert.deepEqual(await getHistoricalVolumeContextResult('DOWN', 5), { status: 'unavailable', context: null });
  const empty = await getHistoricalVolumeContextResult('EMPTY', 50);
  assert.equal(empty.status, 'complete');
  assert.equal(empty.context, null);
  assert.ok(empty.dataAsOf);
});

test('a newly completed trading session invalidates historical cache before its 24-hour TTL', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-08T19:00:00Z') });
  let calls = 0;
  t.mock.method(yahoo, 'chart', async (symbol) => {
    calls++;
    return buildChart(symbol);
  });
  const first = await getHistoricalVolumeContext('SESSIONFIX', 5);
  t.mock.timers.setTime(Date.parse('2026-10-08T21:00:00Z'));
  const second = await getHistoricalVolumeContext('SESSIONFIX', 5);
  assert.equal(calls, 2);
  assert.notEqual(first.dataAsOf, second.dataAsOf);
});

test('invalid chart data is not retained and provider recovery succeeds on the next call', async (t) => {
  let calls = 0;
  t.mock.method(yahoo, 'chart', async (symbol) => {
    calls++;
    const chart = buildChart(symbol);
    if (calls === 1) chart.meta.currency = 'EUR';
    return chart;
  });
  assert.equal(await getHistoricalVolumeContext('RECOVERY', 5), null);
  assert.equal((await getHistoricalVolumeContext('RECOVERY', 5)).movePercent, 20);
  assert.equal(calls, 2);
});

test('concurrent historical lookups share one provider fetch without mixing requested ratio computations', async (t) => {
  let calls = 0;
  t.mock.method(yahoo, 'chart', async (symbol) => {
    calls++;
    await new Promise((resolve) => setTimeout(resolve, 15));
    return buildChart(symbol);
  });
  const results = await Promise.all(
    Array.from({ length: 10 }, (_, index) => getHistoricalVolumeContext('SHARED', index % 2 ? 50 : 5))
  );
  assert.equal(calls, 1);
  results.forEach((result, index) => {
    if (index % 2) assert.equal(result, null);
    else assert.equal(result.movePercent, 20);
  });
});

test('three authenticated route cycles distinguish an outage from verified results and preserve recovery', async (t) => {
  let calls = 0;
  t.mock.method(yahoo, 'chart', async (symbol) => {
    calls++;
    if (calls === 1) throw new Error('synthetic chart outage');
    return buildChart(symbol);
  });
  const row = await db
    .prepare('INSERT INTO users (email, is_verified, tier) VALUES (?, 1, ?)')
    .run('volume-route@test.local', 'elite');
  const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(row.lastInsertRowid);
  const token = (await issueToken(user)).accessToken;
  const app = express();
  app.use('/api', require('../server/routes/volumeContext'));
  const server = await new Promise((resolve) => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
  });
  t.after(
    () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(resolve);
      })
  );
  const origin = `http://127.0.0.1:${server.address().port}/api/volume-context/ROUTECYCLE?ratio=5`;
  const results = [];
  for (let cycle = 0; cycle < 3; cycle++) {
    const response = await fetch(origin, { headers: { Authorization: 'Bearer ' + token } });
    results.push({ status: response.status, data: await response.json() });
  }
  assert.equal(results[0].status, 503);
  assert.equal(results[0].data.dataStatus, 'unavailable');
  assert.equal(results[0].data.context, null);
  for (const cycle of results.slice(1)) {
    assert.equal(cycle.status, 200);
    assert.equal(cycle.data.found, true);
    assert.equal(cycle.data.dataStatus, 'complete');
    assert.equal(cycle.data.context.movePercent, 20);
    assert.ok(cycle.data.dataAsOf);
    assert.equal(cycle.data.dataProvenance.status, 'complete');
  }
  assert.equal(calls, 2, 'the outage must not be cached and recovered data should be shared');
});
