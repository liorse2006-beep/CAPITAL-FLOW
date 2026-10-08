// Regression for an API-call-reduction fix: /api/sector-flow used to call
// yahooFinance.quote(symbol) once per ETF (15 individual Yahoo requests per
// cache-miss cycle) instead of one batched call for all 15 — yahoo-finance2
// supports array input, already relied on elsewhere (quoteCache.js). This
// must now make exactly ONE quote() call covering all 15 symbols, with
// identical output to the old per-symbol version.
// testEnv.js neutralizes Resend/Turnstile but not Finnhub — the developer's
// real FINNHUB_API_KEY from .env otherwise leaks in via dotenv and this test
// would hit the real Finnhub API instead of the mock. Must be set before
// requiring testEnv/config.
process.env.FINNHUB_API_KEY = '';
process.env.FINNHUB_API_KEY_POOL_1 = '';
process.env.FINNHUB_API_KEY_POOL_2 = '';
process.env.FINNHUB_API_KEY_POOL_3 = '';
process.env.FINNHUB_API_KEY_POOL_4 = '';
process.env.FINNHUB_API_KEY_POOL_5 = '';

require('./helpers/testEnv');
const { test, before } = require('node:test');
const assert = require('node:assert');
const express = require('express');

const db = require('../server/db');
before(async () => {
  await db.ready;
});

const yahoo = require('../server/services/yahoo');
const { issueToken } = require('../server/services/auth');
const sectorsRouter = require('../server/routes/sectors');
const { latestCompletedSessionDate, holidayDates } = require('../server/services/marketCalendar');

function chartFixture(symbol) {
  const cursor = new Date(latestCompletedSessionDate() + 'T16:00:00.000Z');
  const quotes = [];
  while (quotes.length < 10) {
    const key = cursor.toISOString().slice(0, 10);
    if (![0, 6].includes(cursor.getUTCDay()) && !holidayDates(cursor.getUTCFullYear()).has(key)) {
      quotes.push({ date: new Date(cursor), volume: 900000, close: 40, high: 41, low: 39 });
    }
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  return { meta: { symbol, currency: 'USD' }, quotes };
}

async function makeEliteUser(email) {
  const result = await db
    .prepare("INSERT INTO users (email, is_verified, tier, is_premium) VALUES (?, 1, 'elite', 1)")
    .run(email);
  return db.prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid);
}

function startTestApp(router = sectorsRouter) {
  const app = express();
  app.use('/api', router);
  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve(server));
  });
}

test('GET /api/sector-flow batches all 15 ETF quotes into a single Yahoo call', async (t) => {
  let quoteCallCount = 0;
  let quoteCallArgs = null;
  t.mock.method(yahoo, 'quote', async (symbols) => {
    quoteCallCount++;
    quoteCallArgs = symbols;
    return symbols.map((s) => ({
      symbol: s,
      currency: 'USD',
      regularMarketTime: new Date(),
      regularMarketPrice: 42,
      regularMarketChangePercent: 0.5,
      regularMarketVolume: 1_000_000,
      regularMarketDayHigh: 43,
      regularMarketDayLow: 41,
      regularMarketPreviousClose: 41.5,
    }));
  });
  t.mock.method(yahoo, 'chart', async (symbol) => chartFixture(symbol));
  const user = await makeEliteUser('sectors-batch@test.local');
  const token = (await issueToken(user)).accessToken;
  const server = await startTestApp();
  const port = server.address().port;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/sector-flow`, {
      headers: { Authorization: 'Bearer ' + token },
    });
    assert.strictEqual(res.status, 200);
    const body = await res.json();

    assert.strictEqual(quoteCallCount, 1, 'must call yahooFinance.quote exactly once, not per-symbol');
    assert.strictEqual(quoteCallArgs.length, 15, 'the single call must cover all 15 ETFs');

    assert.strictEqual(body.results.length, 15);
    const xlk = body.results.find((r) => r.symbol === 'XLK');
    assert.strictEqual(xlk.price, 42);
    assert.strictEqual(xlk.volume, 1_000_000);
  } finally {
    server.close();
  }
});

test('GET /api/sector-flow degrades per-symbol via the chart fallback if the batch quote call fails entirely', async (t) => {
  // /api/sector-flow has its own 60s shared-response cache (module-level
  // flowCache in sectors.js). The previous test already populated it, so
  // reusing the same router instance here would just return that test's
  // cached results without exercising these mocks at all — force a fresh
  // module instance (fresh, empty flowCache) instead.
  delete require.cache[require.resolve('../server/routes/sectors')];
  const freshSectorsRouter = require('../server/routes/sectors');

  t.mock.method(yahoo, 'quote', async () => {
    throw new Error('Yahoo batch quote failed');
  });
  t.mock.method(yahoo, 'chart', async (symbol) => chartFixture(symbol));
  const user = await makeEliteUser('sectors-batch-fail@test.local');
  const token = (await issueToken(user)).accessToken;
  const server = await startTestApp(freshSectorsRouter);
  const port = server.address().port;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/sector-flow`, {
      headers: { Authorization: 'Bearer ' + token },
    });
    assert.strictEqual(res.status, 200, 'a failed batch quote must not fail the whole endpoint');
    const body = await res.json();
    assert.strictEqual(body.results.length, 15);
    // Every symbol should have fallen back to the chart-derived "last session" data.
    body.results.forEach((r) => assert.strictEqual(r.lastSession, true));
    assert.strictEqual(body.dataStatus, 'partial', 'historical fallback is not a verified current quote');
  } finally {
    server.close();
  }
});

test('five concurrent sector requests share one batch and fifteen charts', async (t) => {
  delete require.cache[require.resolve('../server/routes/sectors')];
  const router = require('../server/routes/sectors');
  let quoteCalls = 0;
  let chartCalls = 0;
  t.mock.method(yahoo, 'quote', async (symbols) => {
    quoteCalls++;
    await new Promise((resolve) => setTimeout(resolve, 30));
    return symbols.map((symbol) => ({
      symbol,
      currency: 'USD',
      regularMarketTime: new Date(),
      regularMarketPrice: 42,
      regularMarketVolume: 1000000,
      regularMarketChangePercent: 0.5,
      regularMarketDayHigh: 43,
      regularMarketDayLow: 41,
      regularMarketPreviousClose: 41.5,
    }));
  });
  t.mock.method(yahoo, 'chart', async (symbol) => {
    chartCalls++;
    return chartFixture(symbol);
  });
  const user = await makeEliteUser('sector-shared@test.local');
  const token = (await issueToken(user)).accessToken;
  const server = await startTestApp(router);
  try {
    const bodies = await Promise.all(
      Array.from({ length: 5 }, async () => {
        const response = await fetch(`http://127.0.0.1:${server.address().port}/api/sector-flow`, {
          headers: { Authorization: 'Bearer ' + token },
        });
        assert.strictEqual(response.status, 200);
        return response.json();
      })
    );
    assert.strictEqual(quoteCalls, 1);
    assert.strictEqual(chartCalls, 15);
    assert.ok(bodies.every((body) => body.results.length === 15 && body.dataStatus === 'complete'));
    assert.strictEqual(bodies.filter((body) => body.fromCache).length, 4);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('undated sector data is unavailable rather than falsely complete', async (t) => {
  delete require.cache[require.resolve('../server/routes/sectors')];
  const router = require('../server/routes/sectors');
  t.mock.method(yahoo, 'quote', async (symbols) =>
    symbols.map((symbol) => ({ symbol, regularMarketPrice: true, regularMarketVolume: [1000000] }))
  );
  t.mock.method(yahoo, 'chart', async (symbol) => ({
    meta: { symbol, currency: 'USD' },
    quotes: Array.from({ length: 10 }, () => ({ volume: 900000, close: 40 })),
  }));
  const user = await makeEliteUser('sector-undated@test.local');
  const token = (await issueToken(user)).accessToken;
  const server = await startTestApp(router);
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/sector-flow`, {
      headers: { Authorization: 'Bearer ' + token },
    });
    const body = await response.json();
    assert.strictEqual(body.dataStatus, 'unavailable');
    assert.strictEqual(body.dataAsOf, null);
    assert.ok(body.results.every((row) => row.price === null && row.volume === null && row.flow === 'unavailable'));
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('duplicate daily bars and mismatched chart identities do not become verified sector results', async (t) => {
  delete require.cache[require.resolve('../server/routes/sectors')];
  const router = require('../server/routes/sectors');
  t.mock.method(yahoo, 'quote', async () => []);
  t.mock.method(yahoo, 'chart', async (symbol) => {
    const chart = chartFixture(symbol);
    if (symbol === 'XLK') chart.quotes.push({ ...chart.quotes[0] });
    else chart.meta.symbol = 'WRONG';
    return chart;
  });
  const user = await makeEliteUser('sector-wrong-identity@test.local');
  const token = (await issueToken(user)).accessToken;
  const server = await startTestApp(router);
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/sector-flow`, {
      headers: { Authorization: 'Bearer ' + token },
    });
    const body = await response.json();
    assert.strictEqual(body.dataStatus, 'unavailable');
    assert.ok(body.results.every((row) => row.price === null));
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('GET /api/sector-flow marks a total provider outage unavailable instead of returning zeroes', async (t) => {
  delete require.cache[require.resolve('../server/routes/sectors')];
  const freshSectorsRouter = require('../server/routes/sectors');

  t.mock.method(yahoo, 'quote', async () => {
    throw new Error('Yahoo unavailable');
  });
  t.mock.method(yahoo, 'chart', async () => ({ quotes: [] }));
  const user = await makeEliteUser('sectors-total-outage@test.local');
  const token = (await issueToken(user)).accessToken;
  const server = await startTestApp(freshSectorsRouter);
  const port = server.address().port;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/sector-flow`, {
      headers: { Authorization: 'Bearer ' + token },
    });
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.dataStatus, 'unavailable');
    assert.strictEqual(body.results.length, 15);
    assert.ok(body.results.every((row) => row.dataStatus === 'unavailable'));
    assert.strictEqual(body.results[0].price, null);
    assert.strictEqual(body.results[0].change, null);
    assert.strictEqual(body.results[0].flow, 'unavailable');
  } finally {
    server.close();
  }
});

test('a missing historical session remains partial even with a valid current quote', async (t) => {
  delete require.cache[require.resolve('../server/routes/sectors')];
  const router = require('../server/routes/sectors');
  t.mock.method(yahoo, 'quote', async (symbols) =>
    symbols.map((symbol) => ({
      symbol,
      currency: 'USD',
      regularMarketTime: new Date(),
      regularMarketPrice: 42,
      regularMarketVolume: 1000000,
      regularMarketChangePercent: 0.5,
      regularMarketDayHigh: 43,
      regularMarketDayLow: 41,
      regularMarketPreviousClose: 41.5,
    }))
  );
  t.mock.method(yahoo, 'chart', async (symbol) => {
    const chart = chartFixture(symbol);
    chart.quotes.splice(1, 1);
    return chart;
  });
  const user = await makeEliteUser('sector-baseline-gap@test.local');
  const token = (await issueToken(user)).accessToken;
  const server = await startTestApp(router);
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/sector-flow`, {
      headers: { Authorization: 'Bearer ' + token },
    });
    const body = await response.json();
    assert.strictEqual(body.dataStatus, 'partial');
    assert.ok(body.results.every((row) => row.price === 42 && row.dataStatus === 'partial' && !row.lastSession));
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('weekend observations are excluded from the sector volume baseline', async (t) => {
  delete require.cache[require.resolve('../server/routes/sectors')];
  const router = require('../server/routes/sectors');
  t.mock.method(yahoo, 'quote', async () => []);
  t.mock.method(yahoo, 'chart', async (symbol) => {
    const chart = chartFixture(symbol);
    const weekend = new Date(chart.quotes[0].date);
    while (weekend.getUTCDay() !== 0) weekend.setUTCDate(weekend.getUTCDate() - 1);
    chart.quotes.push({ date: weekend, volume: 1000000000, close: 40 });
    return chart;
  });
  const user = await makeEliteUser('sector-weekend@test.local');
  const token = (await issueToken(user)).accessToken;
  const server = await startTestApp(router);
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/sector-flow`, {
      headers: { Authorization: 'Bearer ' + token },
    });
    const body = await response.json();
    assert.strictEqual(body.dataStatus, 'partial');
    assert.ok(body.results.every((row) => row.avgVolume === 900000 && row.lastSession));
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
