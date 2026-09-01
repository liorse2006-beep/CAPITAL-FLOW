// server/routes/fundamentals.js — a single-ticker lookup the customer
// requests by typing a symbol in, not a universe scan. Premium/Elite gated,
// but also opened up unlimited to a free account still inside its 7-day
// trial (requirePremiumOrTrial) — a past-trial free account is rejected the
// same as before. Also rejects malformed symbols, and reports "no data"
// honestly rather than pretending a delisted/unknown ticker has real numbers.
require('./helpers/testEnv');
const { test, before } = require('node:test');
const assert = require('node:assert');
const express = require('express');

const db = require('../server/db');
before(async () => {
  await db.ready;
});

const { issueToken } = require('../server/services/auth');
const quoteCache = require('../server/services/quoteCache');
const finnhub = require('../server/services/finnhub');
const yahoo = require('../server/services/yahoo');
const fundamentalsRouter = require('../server/routes/fundamentals');

function startTestApp() {
  const app = express();
  app.use(express.json());
  app.use('/api', fundamentalsRouter);
  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve(server));
  });
}

async function makeUser(email, tier, isPremium) {
  const result = await db
    .prepare('INSERT INTO users (email, is_verified, tier, is_premium) VALUES (?, 1, ?, ?)')
    .run(email, tier, isPremium ? 1 : 0);
  const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid);
  return { Authorization: 'Bearer ' + (await issueToken(user)).accessToken };
}

// A free account created 8 days ago — its 7-day trial has elapsed, so it no
// longer gets the trial's unlimited Fundamentals access.
async function makePastTrialFreeUser(email) {
  const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString().replace('T', ' ').slice(0, 19);
  const result = await db
    .prepare("INSERT INTO users (email, is_verified, tier, is_premium, created_at) VALUES (?, 1, 'free', 0, ?)")
    .run(email, eightDaysAgo);
  const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid);
  return { Authorization: 'Bearer ' + (await issueToken(user)).accessToken };
}

test('GET /api/fundamentals requires auth', async () => {
  const server = await startTestApp();
  const port = server.address().port;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/fundamentals?symbol=AAPL`);
    assert.strictEqual(res.status, 401);
  } finally {
    server.close();
  }
});

test('GET /api/fundamentals rejects a past-trial free-tier user — Premium/Elite/in-trial only', async () => {
  const headers = await makePastTrialFreeUser('fund-free-expired@test.local');
  const server = await startTestApp();
  const port = server.address().port;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/fundamentals?symbol=AAPL`, { headers });
    assert.strictEqual(res.status, 403);
    const body = await res.json();
    assert.strictEqual(body.code, 'NOT_PREMIUM');
  } finally {
    server.close();
  }
});

// Uses its own symbol (not AAPL, which other tests in this file already
// exercise) — fundamentalsScanner.js's metricCache/keyStatsCache are
// module-level singletons that persist across every test in this process,
// so reusing a symbol another test already cached would silently return
// that stale cached data instead of ever calling this test's own mocks.
test('GET /api/fundamentals allows a free-tier user still inside their 7-day trial', async (t) => {
  const headers = await makeUser('fund-free-trial@test.local', 'free', false);
  const server = await startTestApp();
  const port = server.address().port;
  t.mock.method(quoteCache, 'getQuotes', async () => {
    const m = new Map();
    m.set('MSFT', {
      symbol: 'MSFT',
      shortName: 'Microsoft Corp.',
      regularMarketPrice: 420.1,
      regularMarketChangePercent: 0.5,
      marketCap: 3.1e12,
    });
    return m;
  });
  t.mock.method(finnhub, 'fetchFinnhubMetric', async () => ({
    peRatio: 35.4,
    debtToEquity: 0.9,
    revenueGrowth5Y: 12.1,
  }));
  t.mock.method(yahoo, 'quoteSummary', async () => ({ defaultKeyStatistics: {}, calendarEvents: {} }));
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/fundamentals?symbol=MSFT`, { headers });
    assert.strictEqual(res.status, 200, 'a brand-new free account is inside its 7-day trial and must be let through');
    const body = await res.json();
    assert.strictEqual(body.result.symbol, 'MSFT');
  } finally {
    server.close();
  }
});

test('GET /api/fundamentals rejects a malformed symbol before touching any data source', async (t) => {
  const headers = await makeUser('fund-badsym@test.local', 'premium', true);
  const server = await startTestApp();
  const port = server.address().port;
  const getQuotesMock = t.mock.method(quoteCache, 'getQuotes', async () => new Map());
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/fundamentals?symbol=<script>alert(1)</script>`, { headers });
    assert.strictEqual(res.status, 400);
    assert.strictEqual(getQuotesMock.mock.callCount(), 0, 'must reject before ever calling out for data');
  } finally {
    server.close();
  }
});

test('GET /api/fundamentals returns a real result for a Premium user looking up a valid ticker', async (t) => {
  const headers = await makeUser('fund-aapl@test.local', 'premium', true);
  const server = await startTestApp();
  const port = server.address().port;
  t.mock.method(quoteCache, 'getQuotes', async () => {
    const m = new Map();
    m.set('AAPL', {
      symbol: 'AAPL',
      shortName: 'Apple Inc.',
      regularMarketPrice: 190.5,
      regularMarketChangePercent: 0.8,
      marketCap: 3e12,
      floatShares: 1.5e10,
      shortPercentOfFloat: 0.006,
    });
    return m;
  });
  t.mock.method(finnhub, 'fetchFinnhubMetric', async () => ({
    peRatio: 31.2,
    debtToEquity: 1.45,
    revenueGrowth5Y: 8.9,
  }));
  t.mock.method(yahoo, 'quoteSummary', async () => ({
    defaultKeyStatistics: { forwardPE: 24.8, pegRatio: 1.6 },
    calendarEvents: { earnings: { earningsDate: ['2026-11-05T00:00:00.000Z'] } },
  }));
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/fundamentals?symbol=aapl`, { headers });
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.result.symbol, 'AAPL', 'lowercase input is normalized to uppercase');
    assert.strictEqual(body.result.peRatio, 31.2);
    assert.strictEqual(body.result.forwardPE, 24.8);
    assert.strictEqual(body.result.pegRatio, 1.6);
    assert.strictEqual(body.result.nextEarningsDate, '2026-11-05');
  } finally {
    server.close();
  }
});

test('GET /api/fundamentals reports "no data" honestly for a ticker with no quote, instead of a fake result', async (t) => {
  const headers = await makeUser('fund-ghost@test.local', 'elite', true);
  const server = await startTestApp();
  const port = server.address().port;
  t.mock.method(quoteCache, 'getQuotes', async () => new Map());
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/fundamentals?symbol=ZZZZZ`, { headers });
    assert.strictEqual(res.status, 404);
    const body = await res.json();
    assert.match(body.error, /ZZZZZ/);
  } finally {
    server.close();
  }
});

test('GET /api/fundamentals reports a provider outage as temporarily unavailable, not as a missing ticker', async (t) => {
  const headers = await makeUser('fund-provider-outage@test.local', 'elite', true);
  const server = await startTestApp();
  const port = server.address().port;
  const map = new Map();
  Object.defineProperties(map, {
    providerFailure: { value: true },
    usedStaleFallback: { value: false },
    staleCount: { value: 0 },
    dataAsOf: { value: null },
  });
  t.mock.method(quoteCache, 'getQuotes', async () => map);
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/fundamentals?symbol=OUTAGE1`, { headers });
    assert.strictEqual(res.status, 503);
    const body = await res.json();
    assert.strictEqual(body.dataStatus, 'unavailable');
    assert.match(body.error, /temporarily unavailable/i);
  } finally {
    server.close();
  }
});
