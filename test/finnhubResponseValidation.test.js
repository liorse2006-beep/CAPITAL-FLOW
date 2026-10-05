require('./helpers/testEnv');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { parseFinnhubQuote, parseFinnhubMetric } = require('../server/services/finnhub');

const NOW = Date.parse('2026-09-15T16:00:00.000Z');
const COMPLETE_QUOTE = {
  c: 100,
  d: 1.5,
  dp: 1.53,
  h: 101,
  l: 98,
  o: 99,
  pc: 98.5,
  t: Math.floor((NOW - 60_000) / 1000),
};

test('Finnhub quote is complete only when required quote fields and a fresh provider timestamp exist', () => {
  const result = parseFinnhubQuote(COMPLETE_QUOTE, NOW);

  assert.equal(result.dataStatus, 'complete');
  assert.deepEqual(result.missingFields, []);
  assert.equal(result.price, 100);
  assert.equal(result.dataAsOf, '2026-09-15T15:59:00.000Z');
});

test('Finnhub quote with missing optional fields is usable but explicitly partial', () => {
  const result = parseFinnhubQuote({ ...COMPLETE_QUOTE, h: null, dp: null }, NOW);

  assert.equal(result.dataStatus, 'partial');
  assert.deepEqual(result.missingFields, ['dp', 'h']);
  assert.equal(result.price, 100);
});

test('Finnhub quote without a trustworthy timestamp is rejected instead of appearing live', () => {
  assert.equal(parseFinnhubQuote({ ...COMPLETE_QUOTE, t: null }, NOW), null);
  assert.equal(parseFinnhubQuote({ ...COMPLETE_QUOTE, t: Math.floor((NOW - 25 * 60 * 60 * 1000) / 1000) }, NOW), null);
});

test('Finnhub metric reports missing scanner fields as partial and never invents zeroes', () => {
  const result = parseFinnhubMetric({ metric: { marketCapitalization: 1234 } });

  assert.equal(result.dataStatus, 'partial');
  assert.deepEqual(result.missingFields, ['avgVol10d']);
  assert.equal(result.marketCap, 1_234_000_000);
  assert.equal(result.avgVol10d, null);
});

test('Finnhub metric is complete only when market cap and average volume are present', () => {
  const result = parseFinnhubMetric({
    metric: {
      marketCapitalization: 1234,
      '10DayAverageTradingVolume': 5678,
      peTTM: 22,
    },
  });

  assert.equal(result.dataStatus, 'complete');
  assert.deepEqual(result.missingFields, []);
  assert.equal(result.marketCap, 1_234_000_000);
  assert.equal(result.avgVol10d, 5_678_000_000);
});

test('Finnhub rejects coercible nonnumeric prices and timestamps while preserving numeric strings', () => {
  for (const value of [true, false, [100], { valueOf: () => 100 }, '100junk']) {
    assert.equal(parseFinnhubQuote({ ...COMPLETE_QUOTE, c: value }, NOW), null);
    assert.equal(parseFinnhubQuote({ ...COMPLETE_QUOTE, t: value }, NOW), null);
  }
  const quote = parseFinnhubQuote({ ...COMPLETE_QUOTE, c: '100', dp: '-1.25', d: '0' }, NOW);
  assert.equal(quote.price, 100);
  assert.equal(quote.change, -1.25);
  assert.equal(quote.changeAbs, 0);
});

test('Finnhub invalid optional positive values remain null and partial, never synthetic numbers', () => {
  const quote = parseFinnhubQuote({ ...COMPLETE_QUOTE, h: true, l: -1, o: 0, pc: [98.5] }, NOW);
  assert.equal(quote.dataStatus, 'partial');
  assert.deepEqual(quote.missingFields, ['h', 'l', 'o', 'pc']);
  assert.deepEqual([quote.dayHigh, quote.dayLow, quote.open, quote.prevClose], [null, null, null, null]);
});

test('Finnhub metrics cannot publish negative or coerced market cap and average volume', () => {
  for (const value of [true, [1234], -1, '1234junk', 1e308]) {
    const metric = parseFinnhubMetric({ metric: { marketCapitalization: value, '10DayAverageTradingVolume': value } });
    assert.equal(metric.marketCap, null);
    assert.equal(metric.avgVol10d, null);
    assert.equal(metric.dataStatus, 'partial');
  }
});

for (const status of [401, 500]) {
  test(`Finnhub HTTP ${status} cannot become a successful quote or metric from success-shaped JSON`, async (t) => {
    const pool = require('../server/services/finnhubKeyPool');
    t.mock.method(pool, 'getKey', () => 'isolated-fake-test-key');
    t.mock.method(pool, 'poolSize', () => 1);
    t.mock.method(
      globalThis,
      'fetch',
      async () =>
        new Response(
          JSON.stringify({
            ...COMPLETE_QUOTE,
            t: Math.floor(Date.now() / 1000),
            metric: { marketCapitalization: 1234, '10DayAverageTradingVolume': 10 },
          }),
          { status }
        )
    );
    delete require.cache[require.resolve('../server/services/finnhub')];
    const adapter = require('../server/services/finnhub');
    assert.equal(await adapter.fetchFinnhubQuote('TEST'), null);
    assert.equal(await adapter.fetchFinnhubMetric('TEST'), null);
  });
}

test('Finnhub preserves exact quote-age boundaries without accepting future or older values', () => {
  for (const offsetMs of [-5 * 60_000, 24 * 60 * 60_000]) {
    assert.ok(parseFinnhubQuote({ ...COMPLETE_QUOTE, t: (NOW - offsetMs) / 1000 }, NOW));
  }
  for (const offsetMs of [-5 * 60_000 - 1, 24 * 60 * 60_000 + 1]) {
    assert.equal(parseFinnhubQuote({ ...COMPLETE_QUOTE, t: (NOW - offsetMs) / 1000 }, NOW), null);
  }
});

test('Finnhub recovers from unsuccessful HTTP without parsing the failed body as market data', async (t) => {
  const pool = require('../server/services/finnhubKeyPool');
  t.mock.method(pool, 'getKey', () => 'isolated-fake-test-key');
  t.mock.method(pool, 'poolSize', () => 1);
  let calls = 0;
  t.mock.method(
    globalThis,
    'fetch',
    async () =>
      new Response(
        JSON.stringify({
          ...COMPLETE_QUOTE,
          t: Math.floor(Date.now() / 1000),
        }),
        { status: ++calls === 1 ? 500 : 200 }
      )
  );
  delete require.cache[require.resolve('../server/services/finnhub')];
  const adapter = require('../server/services/finnhub');
  assert.equal(await adapter.fetchFinnhubQuote('TEST'), null);
  const recovered = await adapter.fetchFinnhubQuote('TEST');
  assert.equal(recovered.price, 100);
  assert.equal(recovered.dataStatus, 'complete');
  assert.equal(calls, 2);
});

test('Finnhub rate-limit fallback remains bounded and accepts only the successful response', async (t) => {
  const pool = require('../server/services/finnhubKeyPool');
  t.mock.method(pool, 'getKey', () => 'isolated-fake-test-key');
  t.mock.method(pool, 'poolSize', () => 2);
  const limited = t.mock.method(pool, 'reportRateLimited', () => {});
  let calls = 0;
  t.mock.method(
    globalThis,
    'fetch',
    async () =>
      new Response(
        JSON.stringify({
          ...COMPLETE_QUOTE,
          t: Math.floor(Date.now() / 1000),
        }),
        { status: ++calls === 1 ? 429 : 200 }
      )
  );
  delete require.cache[require.resolve('../server/services/finnhub')];
  const adapter = require('../server/services/finnhub');
  assert.equal((await adapter.fetchFinnhubQuote('TEST')).price, 100);
  assert.equal(calls, 2);
  assert.equal(limited.mock.calls.length, 1);
});

test('Finnhub releases unsuccessful response bodies without consuming provider error JSON', async (t) => {
  const pool = require('../server/services/finnhubKeyPool');
  t.mock.method(pool, 'getKey', () => 'isolated-fake-test-key');
  t.mock.method(pool, 'poolSize', () => 2);
  t.mock.method(pool, 'reportRateLimited', () => {});
  let cancellations = 0;
  const errorResponse = (status) => ({
    status,
    ok: false,
    body: {
      cancel: async () => {
        cancellations++;
      },
    },
    json: async () => {
      assert.fail('failed provider body must not be parsed');
    },
  });
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => errorResponse(++calls === 1 ? 429 : 500));
  delete require.cache[require.resolve('../server/services/finnhub')];
  const adapter = require('../server/services/finnhub');
  assert.equal(await adapter.fetchFinnhubQuote('TEST'), null);
  assert.equal(calls, 2);
  assert.equal(cancellations, 2);
});
