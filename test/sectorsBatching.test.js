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

require('./helpers/testEnv');
const { test, before } = require('node:test');
const assert = require('node:assert');
const express = require('express');

const db = require('../server/db');
before(async () => { await db.ready; });

const yahoo = require('../server/services/yahoo');
const { issueToken } = require('../server/services/auth');
const sectorsRouter = require('../server/routes/sectors');

async function makeEliteUser(email) {
  const result = await db.prepare("INSERT INTO users (email, is_verified, tier, is_premium) VALUES (?, 1, 'elite', 1)").run(email);
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
      regularMarketPrice: 42,
      regularMarketChangePercent: 0.5,
      regularMarketVolume: 1_000_000,
      regularMarketDayHigh: 43,
      regularMarketDayLow: 41,
      regularMarketPreviousClose: 41.5,
    }));
  });
  t.mock.method(yahoo, 'chart', async () => ({
    quotes: Array.from({ length: 10 }, (_, i) => ({
      date: new Date(Date.now() - i * 864e5),
      volume: 900_000,
      close: 40 + i,
      high: 41 + i,
      low: 39 + i,
    })),
  }));
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
  t.mock.method(yahoo, 'chart', async () => ({
    quotes: Array.from({ length: 10 }, (_, i) => ({
      date: new Date(Date.now() - i * 864e5),
      volume: 900_000,
      close: 40 + i,
      high: 41 + i,
      low: 39 + i,
    })),
  }));
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
  } finally {
    server.close();
  }
});
